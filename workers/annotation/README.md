# high-signal/annotation worker

Cloudflare Python Worker boundary for cheap source-read annotation.

It is intentionally rule-first:

- `method`: `semantic-rules-v2`
- `model`: `none`
- `llm`: `false`

Use this for latency-sensitive intent, sentiment, domain, pain, buyer-intent,
actionability, audience, requirement-type, decision-stage, opportunity-score,
and quality-gate tagging at the edge. Keep Hugging Face classifiers in batch
ingest or a separate compatible runtime until we verify their package fit under
Python Workers.

## Endpoints

```bash
GET /health
POST /annotate
```

Request:

```json
{ "text": "GitHub CI deploy workflow is broken and blocking review." }
```

Batch request:

```json
{ "texts": ["Looking for pricing alternatives.", "Local rent pressure is hurting shops."] }
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "annotations": [
    {
      "intent": "developer-workflow",
      "sentiment": "negative",
      "urgency": "medium",
      "method": "semantic-rules-v2",
      "model": "none",
      "llm": false,
      "intentScore": 1,
      "sentimentScore": 1,
      "positiveHits": [],
      "negativeHits": ["broken"],
      "intentHits": ["github", "ci", "deploy", "workflow"],
      "signalLayer": "app-complaint",
      "domains": ["developer"],
      "productSignals": ["github", "ci", "deploy", "workflow", "broken"],
      "painScore": 0.33,
      "buyerIntentScore": 0,
      "actionabilityScore": 0.83,
      "productRequirement": true,
      "audience": "developers",
      "requirementType": "fix-bug",
      "decisionStage": "pain-discovery",
      "opportunityScore": 0.71,
      "qualityGate": {
        "status": "strong",
        "score": 71,
        "reasons": ["product-requirement", "pain", "actionable", "domain-tagged", "medium-urgency"]
      }
    }
  ]
}
```

## Local checks

```bash
python -m unittest discover workers/annotation/tests
```

## Cloudflare dev/deploy

Python Workers are beta and use the `python_workers` compatibility flag.

```bash
cd workers/annotation
uv run pywrangler dev
uv run pywrangler deploy
```

This worker is not on the production request path until the web/API app binds
to it explicitly.

## TypeScript consumers

Use `annotateTexts` from `@high-signal/shared` instead of hand-writing service
calls. It validates the response shape and falls back to local `semantic-rules-v2`
annotation if the Worker is unavailable or returns a malformed payload.

```ts
import { annotateTexts } from "@high-signal/shared";

const annotations = await annotateTexts(["Need QuickBooks integration."], {
  endpoint: process.env.HIGH_SIGNAL_ANNOTATION_ENDPOINT,
});
```
