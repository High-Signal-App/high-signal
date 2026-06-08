import { describe, expect, it } from "vitest";
import { canonicalSourceUrl, normalizeSourceDocument, sourceDocumentKey } from "../routes/admin";

describe("source document normalization", () => {
  it("canonicalizes tracking params and fragments", () => {
    expect(canonicalSourceUrl("https://www.example.com/a/?utm_source=x&ref=y&keep=1#section")).toBe(
      "https://example.com/a/?keep=1",
    );
  });

  it("uses source and canonical URL as stable document identity", () => {
    const first = normalizeSourceDocument({
      source: "news:example",
      sourceUrl: "https://www.example.com/a?utm_source=x#one",
      publishedAt: "2026-06-01T00:00:00.000Z",
      rawHash: "event-hash-one",
    });
    const second = normalizeSourceDocument({
      source: "news:example",
      sourceUrl: "https://example.com/a",
      publishedAt: "2026-06-01T00:00:00.000Z",
      rawHash: "event-hash-two",
    });

    expect(first.documentKey).toBe(second.documentKey);
    expect(first.rawHash).not.toBe(second.rawHash);
  });

  it("allows explicit producers to provide document keys", () => {
    const doc = normalizeSourceDocument({
      source: "research-paper",
      sourceUrl: "https://example.com/paper",
      publishedAt: "2026-06-01T00:00:00.000Z",
      rawHash: "event",
      sourceDocument: {
        documentKey: "paper:doi:10.0000/example",
        canonicalUrl: "https://example.com/paper",
        rawHash: "paper-version",
      },
    });

    expect(doc.documentKey).toBe("paper:doi:10.0000/example");
    expect(sourceDocumentKey("research-paper", doc.canonicalUrl)).toBe("research-paper:https://example.com/paper");
  });
});
