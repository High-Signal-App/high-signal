import {
  annotateLightweightNlp,
  type LightweightNlpAnnotation,
} from "./lightweight-nlp";

export type AnnotationTransport = Pick<typeof globalThis, "fetch">["fetch"];

export interface AnnotationClientOptions {
  /**
   * Retained for backward compatibility with callers that previously pointed
   * at the (now decommissioned) `high-signal-annotation` Python worker. The
   * remote service has been removed; annotation always runs the local
   * `annotateLightweightNlp` classifier. These fields are accepted and ignored.
   */
  endpoint?: string | null;
  fetcher?: AnnotationTransport;
  timeoutMs?: number;
}

function normalizeTexts(texts: string | string[]) {
  const items = Array.isArray(texts) ? texts : [texts];
  return items.map((item) => item.trim()).filter(Boolean);
}

/**
 * Annotate one or more texts with the local semantic-rules classifier.
 *
 * Previously this would fan out to a remote Cloudflare worker (`ANNOTATION`
 * service binding) and fall back to the local classifier on any error. The
 * remote worker only duplicated `annotateLightweightNlp`, so it was
 * decommissioned and this client now always runs the local path.
 */
export async function annotateTexts(
  texts: string | string[],
  _options: AnnotationClientOptions = {},
): Promise<LightweightNlpAnnotation[]> {
  const normalized = normalizeTexts(texts);
  if (!normalized.length) return [];
  return normalized.map(annotateLightweightNlp);
}
