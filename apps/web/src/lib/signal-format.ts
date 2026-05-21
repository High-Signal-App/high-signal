import type { SignalRow } from "@/lib/api";

const BACKFILL_MARKER = "> _backfill_";
const MAX_HEADLINE = 120;
const MAX_SUMMARY = 280;

export function isBackfillSignal(signal: Pick<SignalRow, "bodyMd">) {
  return signal.bodyMd.trimStart().startsWith(BACKFILL_MARKER);
}

function stripMarkdown(value: string) {
  return value
    .replace(/^>\s*/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[_*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSentence(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const sentenceEnd = value.slice(0, maxChars).search(/[.!?]\s+[A-Z0-9]/);
  if (sentenceEnd >= 48) return value.slice(0, sentenceEnd + 1);
  return `${value.slice(0, maxChars).replace(/\s+\S*$/, "")}...`;
}

export function signalHeadline(bodyMd: string | undefined, slug: string) {
  const lines = (bodyMd ?? "")
    .split("\n")
    .map(stripMarkdown)
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().includes("backfill"));
  const first = lines[0] ?? slug.replaceAll("-", " ");
  return trimSentence(first, MAX_HEADLINE);
}

export function signalSummary(bodyMd: string | undefined, slug: string, maxChars = MAX_SUMMARY) {
  const headline = signalHeadline(bodyMd, slug);
  const lines = (bodyMd ?? "")
    .split("\n")
    .map(stripMarkdown)
    .filter(Boolean)
    .filter((line) => line !== headline)
    .filter((line) => !line.toLowerCase().includes("backfill"));
  const text = lines.join(" ");
  if (!text) return "";
  return trimSentence(text, maxChars);
}
