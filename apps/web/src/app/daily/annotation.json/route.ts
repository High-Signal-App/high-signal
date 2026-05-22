import { annotateDailyTexts, DAILY_INTELLIGENCE_LAYER, dailyAnnotationRuntime } from "@/lib/daily-intelligence";

export const dynamic = "force-dynamic";

const SAMPLE_TEXTS = [
  {
    label: "regional complaint",
    text: "Local permit delays and rent pressure are hurting small shops; owners need a dashboard for city constraints.",
  },
  {
    label: "developer workflow",
    text: "GitHub CI deploy workflow is broken and blocking code review; teams need clearer traces and fixes.",
  },
  {
    label: "buyer evaluation",
    text: "Looking for a cheaper Shopify returns automation tool with clear pricing and QuickBooks integration.",
  },
  {
    label: "market watch",
    text: "AI chip demand, export restrictions, capex guidance, and data center power constraints are moving semiconductor stocks.",
  },
];

export async function GET() {
  const runtime = await dailyAnnotationRuntime();
  const annotations = await annotateDailyTexts(SAMPLE_TEXTS.map((sample) => sample.text));
  return new Response(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      runtime,
      intelligenceLayer: DAILY_INTELLIGENCE_LAYER,
      implementation: {
        currentMethod: DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.method,
        classifierVersion: "semantic-rules-v2.1",
        currentModel: "none",
        llm: false,
        activeExecutionPath: runtime.activePath,
        cloudflarePythonWorker:
          runtime.activePath === "cloudflare-service-binding" || runtime.activePath === "public-http-endpoint",
        huggingFace: {
          currentUse: false,
          status: "optional-batch-not-enabled",
          note:
            "The live daily path uses deterministic semantic rules in TypeScript or the matching Cloudflare Python Worker. Hugging Face classifiers can be added later as an optional batch enrichment, but no HF model is currently installed in the edge path.",
        },
      },
      capabilities: DAILY_INTELLIGENCE_LAYER.broadReadAnnotation.fields,
      samples: SAMPLE_TEXTS.map((sample, index) => ({
        ...sample,
        annotation: annotations[index],
      })),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
