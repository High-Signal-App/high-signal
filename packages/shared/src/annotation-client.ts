import {
  annotateLightweightNlp,
  type LightweightNlpAnnotation,
} from "./lightweight-nlp";

export type AnnotationServiceResult = {
  ok: true;
  count: number;
  annotations: LightweightNlpAnnotation[];
};

export type AnnotationServiceError = {
  ok: false;
  error: string;
};

export type AnnotationServiceResponse = AnnotationServiceResult | AnnotationServiceError;

export type AnnotationTransport = Pick<typeof globalThis, "fetch">["fetch"];

export interface AnnotationClientOptions {
  endpoint?: string | null;
  fetcher?: AnnotationTransport;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_REMOTE_BATCH = 25;

function normalizeTexts(texts: string | string[]) {
  const items = Array.isArray(texts) ? texts : [texts];
  return items.map((item) => item.trim()).filter(Boolean);
}

function isAnnotation(value: unknown): value is LightweightNlpAnnotation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LightweightNlpAnnotation>;
  return (
    typeof item.intent === "string" &&
    typeof item.sentiment === "string" &&
    typeof item.urgency === "string" &&
    (item.method === "rules-v1" || item.method === "semantic-rules-v2") &&
    item.model === "none" &&
    item.llm === false &&
    typeof item.intentScore === "number" &&
    typeof item.sentimentScore === "number" &&
    Array.isArray(item.positiveHits) &&
    Array.isArray(item.negativeHits) &&
    Array.isArray(item.intentHits) &&
    typeof item.signalLayer === "string" &&
    Array.isArray(item.domains) &&
    Array.isArray(item.productSignals) &&
    typeof item.painScore === "number" &&
    typeof item.buyerIntentScore === "number" &&
    typeof item.actionabilityScore === "number" &&
    typeof item.productRequirement === "boolean" &&
    typeof item.audience === "string" &&
    typeof item.requirementType === "string" &&
    typeof item.decisionStage === "string" &&
    typeof item.opportunityScore === "number" &&
    Boolean(item.qualityGate) &&
    typeof item.qualityGate === "object" &&
    typeof item.qualityGate.status === "string" &&
    typeof item.qualityGate.score === "number" &&
    Array.isArray(item.qualityGate.reasons)
  );
}

function parseServiceResponse(value: unknown): AnnotationServiceResponse {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "annotation service returned a non-object payload" };
  }
  const payload = value as {
    ok?: unknown;
    error?: unknown;
    count?: unknown;
    annotations?: unknown;
  };
  if (payload.ok === false) {
    return {
      ok: false,
      error: typeof payload.error === "string" ? payload.error : "annotation service rejected the request",
    };
  }
  if (payload.ok !== true || !Array.isArray(payload.annotations)) {
    return { ok: false, error: "annotation service returned an invalid payload" };
  }
  const annotations = payload.annotations.filter(isAnnotation);
  if (annotations.length !== payload.annotations.length) {
    return { ok: false, error: "annotation service returned invalid annotations" };
  }
  return {
    ok: true,
    count: typeof payload.count === "number" ? payload.count : annotations.length,
    annotations,
  };
}

async function postJson(
  fetcher: AnnotationTransport,
  endpoint: string,
  texts: string[],
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(texts.length === 1 ? { text: texts[0] } : { texts }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `annotation service returned HTTP ${response.status}` } as const;
    }
    return parseServiceResponse(await response.json());
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

function remoteBatches(texts: string[]) {
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += MAX_REMOTE_BATCH) {
    batches.push(texts.slice(i, i + MAX_REMOTE_BATCH));
  }
  return batches;
}

export async function annotateTexts(
  texts: string | string[],
  options: AnnotationClientOptions = {},
): Promise<LightweightNlpAnnotation[]> {
  const normalized = normalizeTexts(texts);
  if (!normalized.length) return [];

  const endpoint = options.endpoint?.trim();
  if (!endpoint) return normalized.map(annotateLightweightNlp);

  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) return normalized.map(annotateLightweightNlp);

  const annotations: LightweightNlpAnnotation[] = [];
  for (const batch of remoteBatches(normalized)) {
    const response = await postJson(fetcher, endpoint, batch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!response.ok || response.annotations.length !== batch.length) {
      return normalized.map(annotateLightweightNlp);
    }
    annotations.push(...response.annotations);
  }
  return annotations;
}
