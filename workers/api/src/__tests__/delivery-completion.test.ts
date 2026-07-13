import { afterEach, describe, expect, it, vi } from "vitest";
import {
  briefSnapshotToCompactDigest,
  canRetryDelivery,
  createRssToken,
  type BriefSnapshot,
} from "@high-signal/shared";
import { renderPrivateAtom, renderPrivateRss } from "../routes/digest";
import { runDeliveryWindow } from "../routes/delivery";
import app from "../index";

const fetcher = app as unknown as {
  fetch(request: Request, env?: Record<string, unknown>): Promise<Response>;
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const snapshot: BriefSnapshot = {
  generatedAt: "2026-07-13T10:00:00.000Z",
  region: "global",
  hasBrand: false,
  stocks: [
    {
      entityId: "entity-a",
      entityName: "Acme & Co",
      ticker: "ACME",
      country: "US",
      signalType: "adoption",
      signalFamily: "ai-adoption",
      direction: "up",
      confidence: "high",
      predictedWindowDays: 30,
      headline: "Adoption <accelerates>",
      signalSlug: "acme-adoption",
      publishedAt: "2026-07-13T09:00:00.000Z",
      evidenceUrls: [{ url: "https://example.com/evidence?a=1&b=2" }],
      hitRate: 0.75,
      hitRateSample: 8,
      hitRateBand: "direct",
    },
  ],
  ideas: [],
  trends: [],
  perception: [],
  improvements: [],
};

describe("brief delivery completion contracts", () => {
  it("keeps compact digest and manual retry behind the Clerk proxy identity", async () => {
    const env = { DB: {} as D1Database, ENVIRONMENT: "test" };
    const digest = await fetcher.fetch(new Request("http://test/delivery/digest"), env);
    const retry = await fetcher.fetch(
      new Request("http://test/delivery/retry/log-1", { method: "POST" }),
      env,
    );
    expect(digest.status).toBe(401);
    expect(retry.status).toBe(401);
  });

  it("rejects malformed private feed tokens before querying D1", async () => {
    const prepare = () => {
      throw new Error("D1 must not be queried for malformed tokens");
    };
    const response = await fetcher.fetch(
      new Request("http://test/digest/rss?token=not-a-token"),
      { DB: { prepare } as unknown as D1Database, ENVIRONMENT: "test" },
    );
    expect(response.status).toBe(401);
  });

  it("resolves a valid private token to the owner's canonical daily brief", async () => {
    const token = "a".repeat(64);
    const statement = {
      bind: vi.fn().mockReturnThis(),
      raw: vi.fn(async () => [["user-1", "global", null]]),
    };
    const database = { prepare: vi.fn(() => statement) };
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("/brief/daily?region=global");
      expect(url).toContain("owner=user-1");
      return Response.json(snapshot);
    });

    const response = await fetcher.fetch(
      new Request(`http://test/digest/rss?token=${token}`),
      {
        DB: database as unknown as D1Database,
        API_BASE: "https://api.test",
        ENVIRONMENT: "test",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("Acme &amp; Co");
  });

  it("claims and sends an owner-scoped failed delivery exactly once", async () => {
    const send = vi.fn(async () => undefined);
    const runs: string[] = [];
    const database = {
      prepare: vi.fn((sql: string) => {
        const statement = {
          bind: vi.fn().mockReturnThis(),
          raw: vi.fn(async () => {
            if (sql.includes('from "delivery_log"')) {
              return [[
                "log-1",
                "user-1",
                "email",
                "2026-07-13",
                "failed",
                "transport_500",
                null,
                3,
                null,
                null,
                1_752_384_000,
              ]];
            }
            if (sql.includes('from "delivery_preferences"')) {
              return [[
                "user-1",
                "email",
                1,
                "reader@example.com",
                "global",
                "UTC",
                "07:00",
                null,
                null,
                1_752_384_000,
              ]];
            }
            return [];
          }),
          run: vi.fn(async () => {
            runs.push(sql);
            return { success: true, meta: { changes: 1 } };
          }),
        };
        return statement;
      }),
    };
    globalThis.fetch = vi.fn(async () => Response.json(snapshot));

    const response = await fetcher.fetch(
      new Request("http://test/delivery/retry/log-1", {
        method: "POST",
        headers: { "X-Clerk-User-Id": "user-1" },
      }),
      {
        DB: database as unknown as D1Database,
        API_BASE: "https://api.test",
        EMAIL_FROM: "brief@highsignal.app",
        SEND_EMAIL: { send },
        ENVIRONMENT: "test",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "sent", attempt: 4 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(2);
  });

  it("does not send when another retry request already claimed the row", async () => {
    const send = vi.fn(async () => undefined);
    const database = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn().mockReturnThis(),
        raw: vi.fn(async () =>
          sql.includes('from "delivery_log"')
            ? [["log-1", "user-1", "email", "2026-07-13", "failed", "transport_500", null, 3, null, null, 1_752_384_000]]
            : [["user-1", "email", 1, "reader@example.com", "global", "UTC", "07:00", null, null, 1_752_384_000]]
        ),
        run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
      })),
    };
    globalThis.fetch = vi.fn(async () => Response.json(snapshot));
    const response = await fetcher.fetch(
      new Request("http://test/delivery/retry/log-1", {
        method: "POST",
        headers: { "X-Clerk-User-Id": "user-1" },
      }),
      {
        DB: database as unknown as D1Database,
        API_BASE: "https://api.test",
        EMAIL_FROM: "brief@highsignal.app",
        SEND_EMAIL: { send },
        ENVIRONMENT: "test",
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "retry_already_claimed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("cron does not call the provider before persisted retry eligibility", async () => {
    const now = new Date();
    const windowStart = `${String(now.getUTCHours()).padStart(2, "0")}:${String(
      now.getUTCMinutes(),
    ).padStart(2, "0")}`;
    const nextAttemptSeconds = Math.floor((Date.now() + 60 * 60_000) / 1_000);
    const database = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn().mockReturnThis(),
        raw: vi.fn(async () => {
          if (sql.includes('from "delivery_preferences"')) {
            return [[
              "user-1",
              "email",
              1,
              "reader@example.com",
              "global",
              "UTC",
              windowStart,
              null,
              null,
              Math.floor(Date.now() / 1_000),
            ]];
          }
          if (sql.includes('from "delivery_log"')) {
            return [["log-1", "failed", 1, nextAttemptSeconds]];
          }
          return [];
        }),
      })),
    };
    const send = vi.fn(async () => undefined);
    globalThis.fetch = vi.fn(async () => Response.json(snapshot));

    const summary = await runDeliveryWindow({
      DB: database as unknown as D1Database,
      API_BASE: "https://api.test",
      EMAIL_FROM: "brief@highsignal.app",
      SEND_EMAIL: { send },
    });
    expect(summary["skipped"]).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("only treats failed email rows as manually retryable", () => {
    expect(canRetryDelivery({ channel: "email", status: "failed", attempt: 3 })).toBe(true);
    expect(canRetryDelivery({ channel: "email", status: "sent", attempt: 3 })).toBe(false);
    expect(canRetryDelivery({ channel: "rss", status: "failed", attempt: 1 })).toBe(false);
  });

  it("issues independent 256-bit opaque RSS credentials", () => {
    const first = createRssToken();
    const second = createRssToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it("renders valid escaped private RSS and Atom from the compact daily brief", () => {
    const digest = briefSnapshotToCompactDigest(snapshot);
    const rss = renderPrivateRss(digest);
    const atom = renderPrivateAtom(digest);

    expect(rss).toContain('<rss version="2.0">');
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(rss).toContain("Acme &amp; Co");
    expect(atom).toContain("Adoption &lt;accelerates&gt;");
    expect(rss).toContain("https://example.com/evidence?a=1&amp;b=2");
    expect(atom).toContain("01 / stocks watching for a boom");
    expect(rss).not.toContain("userId");
  });
});
