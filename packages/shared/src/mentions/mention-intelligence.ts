export type MentionSentiment = "positive" | "neutral" | "negative";

export interface CompetitorMention {
  name: string;
  mentioned: boolean;
  position: number | null;
}

export interface MentionAnalysisResult {
  brandMentioned: boolean;
  brandSentiment: MentionSentiment | null;
  brandPosition: number | null;
  competitorsMentioned: CompetitorMention[];
  citations: string[];
  brandCited: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(text);
}

export function analyzeMentionVisibility(input: {
  text: string;
  brandName: string;
  brandAliases?: string[];
  brandUrl?: string | null;
  competitors?: { name: string }[];
}): MentionAnalysisResult {
  const brandTerms = [input.brandName, ...(input.brandAliases ?? [])].filter(Boolean);
  const brandMentioned = brandTerms.some((term) => containsTerm(input.text, term));

  let brandPosition: number | null = null;
  const listItemRegex = /^\s*(\d+)[.)]\s*\**\s*([^\n]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = listItemRegex.exec(input.text)) !== null) {
    const itemText = match[2] ?? "";
    if (brandTerms.some((term) => containsTerm(itemText, term))) {
      brandPosition = Number.parseInt(match[1] ?? "", 10);
      break;
    }
  }

  let brandSentiment: MentionSentiment | null = null;
  if (brandMentioned) {
    const positiveWords = [
      "best",
      "great",
      "excellent",
      "top",
      "leading",
      "popular",
      "powerful",
      "recommended",
      "reliable",
      "preferred",
    ];
    const negativeWords = [
      "worst",
      "bad",
      "poor",
      "lacking",
      "limited",
      "expensive",
      "outdated",
      "difficult",
      "slow",
      "unreliable",
    ];
    const context = input.text
      .split(/[.!?]+/)
      .filter((sentence) => brandTerms.some((term) => containsTerm(sentence, term)))
      .join(" ")
      .toLowerCase();
    const positives = positiveWords.filter((word) => context.includes(word)).length;
    const negatives = negativeWords.filter((word) => context.includes(word)).length;
    brandSentiment = positives > negatives ? "positive" : negatives > positives ? "negative" : "neutral";
  }

  const competitorsMentioned = (input.competitors ?? []).map((competitor) => {
    const mentioned = containsTerm(input.text, competitor.name);
    const escaped = escapeRegExp(competitor.name);
    const listMatch = mentioned
      ? input.text.match(new RegExp(`^\\s*(\\d+)[.)]\\s*\\**\\s*[^\\n]*\\b${escaped}\\b`, "im"))
      : null;
    return {
      name: competitor.name,
      mentioned,
      position: listMatch ? Number.parseInt(listMatch[1] ?? "", 10) : null,
    };
  });

  const citations = [...new Set(input.text.match(/https?:\/\/[^\s)>\]"',]+/g) ?? [])];
  const normalizedBrandUrl = input.brandUrl?.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const brandCited = normalizedBrandUrl
    ? citations.some((url) => url.toLowerCase().includes(normalizedBrandUrl))
    : false;

  return {
    brandMentioned,
    brandSentiment,
    brandPosition,
    competitorsMentioned,
    citations,
    brandCited,
  };
}
