import { afterEach, describe, expect, it, vi } from "vitest";
import { executePromptsWithAI } from "../lib/agent-evaluation-execution";
import type { AgentEvaluationInput, AgentPromptResult } from "@high-signal/shared";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function makePrompt(overrides: Partial<AgentPromptResult> = {}): AgentPromptResult {
  return {
    promptKey: "test-key",
    promptText: "What is the best brand?",
    surface: "chat",
    responseText: "",
    brandMentioned: false,
    brandRecommended: false,
    competitorsMentioned: [],
    citations: [],
    ...overrides,
  };
}

const baseInput: AgentEvaluationInput = {
  ownerId: "owner-1",
  brandName: "Acme",
  brandUrl: "https://acme.com",
  buyerMission: "build widgets",
  competitors: [{ name: "Beta", url: "https://beta.com" }],
};

describe("executePromptsWithAI resilience", () => {
  it("returns original prompts when no AI config is set", async () => {
    const prompts = [makePrompt()];
    const out = await executePromptsWithAI({
      env: {},
      audit: baseInput,
      prompts,
    });
    expect(out).toBe(prompts);
  });

  it("analyzes successful responses", async () => {
    const prompts = [makePrompt({ promptKey: "p1" }), makePrompt({ promptKey: "p2" })];
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Acme is the best brand. See https://acme.com" } }],
        }),
        { status: 200 },
      ),
    );
    const out = await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.brandMentioned).toBe(true);
    expect(out[0]!.brandRecommended).toBe(true);
    expect(out[0]!.citations).toContain("https://acme.com");
  });

  it("returns original prompt on non-200 (fallback)", async () => {
    const prompts = [makePrompt({ promptKey: "p1" })];
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    const out = await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(prompts[0]);
  });

  it("returns original prompt on fetch exception (fallback)", async () => {
    const prompts = [makePrompt({ promptKey: "p1" })];
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network down"));
    const out = await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(prompts[0]);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const prompts = [makePrompt({ promptKey: "p1" })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Acme is great" } }],
          }),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock;
    const out = await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.brandMentioned).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not amplify into infinite retry (bounded attempts)", async () => {
    const prompts = [makePrompt({ promptKey: "p1" })];
    const fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    globalThis.fetch = fetchMock;
    const out = await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(out).toHaveLength(1);
    // 2 attempts = one retry, not infinite
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps concurrency at 4 for large prompt lists", async () => {
    const prompts = Array.from({ length: 10 }, (_, i) => makePrompt({ promptKey: `p${i}` }));
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Acme" } }] }),
        { status: 200 },
      );
    });
    await executePromptsWithAI({
      env: { HIGH_SIGNAL_AI_API_KEY: "test-key" },
      audit: baseInput,
      prompts,
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });
});
