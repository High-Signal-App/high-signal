#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  annotateLightweightNlp,
  annotateTexts,
  type LightweightNlpAnnotation,
} from "@high-signal/shared";

const ROOT = resolve(__dirname, "..");
const PYTHON = `
import json
import sys
sys.path.insert(0, ${JSON.stringify(resolve(ROOT, "workers/annotation/src"))})
from annotate import annotate_text
texts = json.loads(sys.stdin.read())
print(json.dumps([annotate_text(text).to_dict() for text in texts]))
`;

const SAMPLES = [
  "Local permit delays and rent pressure are hurting small shops.",
  "Looking for an alternative vendor with clear pricing.",
  "GitHub CI deploy workflow is broken and blocked review.",
  "Revenue guidance improved but margins remain a risk.",
  "Need support for QuickBooks integration in the onboarding flow.",
];

function pythonAnnotations(texts: string[]) {
  const raw = execFileSync("python", ["-c", PYTHON], {
    cwd: ROOT,
    input: JSON.stringify(texts),
    encoding: "utf8",
  });
  return JSON.parse(raw) as LightweightNlpAnnotation[];
}

const tsAnnotations = SAMPLES.map(annotateLightweightNlp);
assert.deepEqual(pythonAnnotations(SAMPLES), tsAnnotations);

async function main() {
  const remoteAnnotations = await annotateTexts(SAMPLES, {
    endpoint: "https://annotation.example/annotate",
    fetcher: async () =>
      new Response(JSON.stringify({ ok: true, count: tsAnnotations.length, annotations: tsAnnotations }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(remoteAnnotations, tsAnnotations);

  const fallbackAnnotations = await annotateTexts(SAMPLES, {
    endpoint: "https://annotation.example/annotate",
    fetcher: async () =>
      new Response(JSON.stringify({ ok: false, error: "temporary failure" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(fallbackAnnotations, tsAnnotations);

  const malformedAnnotations = await annotateTexts(SAMPLES, {
    endpoint: "https://annotation.example/annotate",
    fetcher: async () =>
      new Response(JSON.stringify({ ok: true, count: 1, annotations: [{ intent: "general" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assert.deepEqual(malformedAnnotations, tsAnnotations);

  console.log("annotation-contract.test.ts: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
