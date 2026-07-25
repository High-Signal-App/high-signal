import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeMentionResponse } from "@high-signal/shared";
import {
  executeHighSignalVisibility,
  resolveHighSignalVisibilityProviders,
} from "../lib/ai-visibility-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("High Signal AI visibility package adapter", () => {
  it("preserves the frozen MentionPilot analysis contract through the package", () => {
    const result = analyzeMentionResponse({
      text: [
        "1. Competitor Cloud is reliable.",
        "2. High Signal is a recommended monitoring product.",
        "Read more at https://highsignal.test/case-study.",
      ].join("\n"),
      brandName: "High Signal",
      brandAliases: ["HighSignal"],
      brandUrl: "https://highsignal.test",
      competitors: [{ name: "Competitor Cloud" }],
    });

    expect(result).toMatchObject({
      brandMentioned: true,
      brandRecommended: true,
      brandSentiment: "positive",
      brandPosition: 2,
      brandCited: true,
      provenance: "deterministic-fallback",
    });
    expect(result.competitorsMentioned[0]).toEqual({
      name: "Competitor Cloud",
      mentioned: true,
      position: 1,
    });
  });

  it("maps High Signal provider configuration without exposing D1 or customer data", () => {
    const providers = resolveHighSignalVisibilityProviders(
      {
        OPENAI_API_KEY: "openai",
        PERPLEXITY_API_KEY: "perplexity",
      },
      {
        brandName: "High Signal",
        brandAliases: [],
        brandUrl: null,
        competitors: [],
      },
    );

    expect(providers.map((provider) => provider.id)).toEqual(["chatgpt", "perplexity"]);
    expect(providers.every((provider) => typeof provider.execute === "function")).toBe(true);
  });

  it("executes through the package and labels judge fallback provenance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          model: "mock-model",
          choices: [
            {
              message: {
                content:
                  "High Signal is a recommended monitoring product. https://highsignal.test/proof",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: "not valid judge json" } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const run = await executeHighSignalVisibility({
      env: {
        HIGH_SIGNAL_AI_API_KEY: "configured",
        HIGH_SIGNAL_AI_ENDPOINT_URL: "https://provider.example/v1/chat/completions",
        HIGH_SIGNAL_AI_MODEL: "mock-model",
      },
      config: {
        brandName: "High Signal",
        brandAliases: ["HighSignal"],
        brandUrl: "https://highsignal.test",
        competitors: [{ name: "Competitor Cloud" }],
      },
      prompts: [
        {
          id: "category",
          promptText: "What is the best monitoring product?",
          persona: "developer",
        },
      ],
    });

    expect(run.coverage).toMatchObject({ configured: 1, completed: 1, failed: 0 });
    expect(run.attempts[0]).toMatchObject({
      providerId: "custom",
      model: "mock-model",
      persona: "developer",
      analysis: {
        brandMentioned: true,
        brandRecommended: true,
        brandCited: true,
        provenance: "deterministic-fallback",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
