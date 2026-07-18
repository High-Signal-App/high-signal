import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  classifyStatus,
  fetchWithRetry,
  isRetryable,
  jitterDelay,
  mapWithConcurrency,
} from "../lib/resilience";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyStatus", () => {
  it("classifies 429 as rate_limited", () => {
    expect(classifyStatus(429)).toBe("rate_limited");
  });

  it("classifies 5xx as server_error", () => {
    expect(classifyStatus(500)).toBe("server_error");
    expect(classifyStatus(503)).toBe("server_error");
  });

  it("classifies 4xx (non-429) as client_error", () => {
    expect(classifyStatus(400)).toBe("client_error");
    expect(classifyStatus(404)).toBe("client_error");
  });

  it("classifies 200 as ok", () => {
    expect(classifyStatus(200)).toBe("ok");
  });
});

describe("isRetryable", () => {
  it("retries rate_limited, server_error, timeout, network", () => {
    expect(isRetryable("rate_limited")).toBe(true);
    expect(isRetryable("server_error")).toBe(true);
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("network")).toBe(true);
  });

  it("does not retry ok or client_error", () => {
    expect(isRetryable("ok")).toBe(false);
    expect(isRetryable("client_error")).toBe(false);
  });
});

describe("jitterDelay", () => {
  it("stays within [0, min(cap, base*2^(attempt-1))]", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const d = jitterDelay(attempt, 500, 4000);
      const ceiling = Math.min(4000, 500 * 2 ** (attempt - 1));
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe("classifyError", () => {
  it("classifies AbortError/TimeoutError as timeout", () => {
    const err = new DOMException("aborted", "TimeoutError");
    expect(classifyError(err)).toBe("timeout");
  });

  it("classifies TypeError as network", () => {
    expect(classifyError(new TypeError("fetch failed"))).toBe("network");
  });
});

describe("fetchWithRetry", () => {
  it("returns the response on first success", async () => {
    const run = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const res = await fetchWithRetry(run, { attempts: 2, timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const res = await fetchWithRetry(run, {
      attempts: 2,
      timeoutMs: 1000,
      baseMs: 1,
      capMs: 5,
    });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 and returns last response after exhausting retries", async () => {
    const run = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const res = await fetchWithRetry(run, {
      attempts: 2,
      timeoutMs: 1000,
      baseMs: 1,
      capMs: 5,
    });
    expect(res.status).toBe(503);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400 (terminal client error)", async () => {
    const run = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const res = await fetchWithRetry(run, { attempts: 2, timeoutMs: 1000 });
    expect(res.status).toBe(400);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries on timeout (AbortError) then succeeds", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const res = await fetchWithRetry(run, {
      attempts: 2,
      timeoutMs: 1000,
      baseMs: 1,
      capMs: 5,
    });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not amplify into infinite retry (bounded attempts)", async () => {
    const run = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    await expect(
      fetchWithRetry(run, { attempts: 2, timeoutMs: 100, baseMs: 1, capMs: 5 }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("calls onResult with attempt count and failure class", async () => {
    const onResult = vi.fn();
    const run = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await fetchWithRetry(run, {
      attempts: 2,
      timeoutMs: 1000,
      baseMs: 1,
      capMs: 5,
      onResult,
    });
    expect(onResult).toHaveBeenCalledWith({ attempts: 2, class: "ok", status: 200 });
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in output", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([10, 20, 30, 40, 50]);
  });

  it("caps concurrent in-flight calls at the limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("captures per-item errors without rejecting the batch", async () => {
    const items = [1, 2, 3];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      if (n === 2) throw new Error("bad");
      return n;
    });
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("handles empty input", async () => {
    const results = await mapWithConcurrency([], 4, async (n) => n);
    expect(results).toEqual([]);
  });
});
