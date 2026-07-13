import { Hono } from "hono";
import { cors } from "hono/cors";
import { signalsRoute } from "./routes/signals";
import { entitiesRoute } from "./routes/entities";
import { trackRecordRoute } from "./routes/track-record";
import { digestRoute } from "./routes/digest";
import { adminRoute } from "./routes/admin";
import { sectorsRoute } from "./routes/sectors";
import { marketsRoute } from "./routes/markets";
import { communitiesRoute } from "./routes/communities";
import { productsRoute } from "./routes/products";
import { briefRoute, precomputeBriefSnapshots } from "./routes/brief";
import { convergenceRoute } from "./routes/convergence";
import { unmappedRoute } from "./routes/unmapped";
import { enrichRoute } from "./routes/enrich";
import { attentionRoute } from "./routes/attention";
import { claimsRoute } from "./routes/claims";
import { deliveryRoute, runDeliveryWindow } from "./routes/delivery";
import { watchlistsRoute } from "./routes/watchlists";
import { dataRoute } from "./routes/data";
import { d2cRoute } from "./routes/d2c";
import { companyUniverseRoute } from "./routes/company-universe";
import { learningRoute } from "./routes/learning";

type Env = {
  DB: D1Database;
  ENVIRONMENT: string;
  ADMIN_TOKEN?: string;
  MODAL_TRIGGER_URL?: string;
  MODAL_TRIGGER_TOKEN?: string;
  MODAL_SCORE_URL?: string;
  // Plan 0009 — brief email delivery. All optional: the delivery sweep
  // fail-closes to a logged no-op until the operator configures transport
  // (SEND_EMAIL binding + EMAIL_FROM) and applies migration 0010.
  SEND_EMAIL?: { send(message: unknown): Promise<void> };
  EMAIL_FROM?: string;
  API_BASE?: string;
  DELIVERY_UNSUBSCRIBE_SECRET?: string;
};

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*" }));

app.get("/", (c) => c.json({ name: "high-signal-api", env: c.env.ENVIRONMENT }));
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.route("/signals", signalsRoute);
app.route("/entities", entitiesRoute);
app.route("/track-record", trackRecordRoute);
app.route("/digest", digestRoute);
app.route("/admin", adminRoute);
app.route("/sectors", sectorsRoute);
app.route("/markets", marketsRoute);
app.route("/communities", communitiesRoute);
app.route("/products", productsRoute);
app.route("/brief", briefRoute);
app.route("/convergence", convergenceRoute);
app.route("/unmapped", unmappedRoute);
app.route("/enrich", enrichRoute);
app.route("/attention", attentionRoute);
app.route("/claims", claimsRoute);
app.route("/delivery", deliveryRoute);
app.route("/watchlists", watchlistsRoute);
app.route("/data", dataRoute);
app.route("/d2c", d2cRoute);
app.route("/company-universe", companyUniverseRoute);
app.route("/learning", learningRoute);

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });

    // Brief precompute runs on every cron trigger regardless of Modal config.
    // This populates daily_brief_snapshots so /brief/daily does 1 D1 lookup
    // instead of 5-14 sequential queries.
    ctx.waitUntil(
      precomputeBriefSnapshots(env).catch((err) =>
        console.error("[cron] brief precompute failed:", err),
      ),
    );

    // Plan 0009 — brief email delivery sweep. Runs on every 30-min tick so at
    // least one tick lands inside each user's 1-hour local send window. Fail
    // closed and idempotent: a no-op until the operator configures transport
    // (SEND_EMAIL + EMAIL_FROM) and applies migration 0010, and the
    // delivery_log unique index prevents double-sends across ticks.
    ctx.waitUntil(
      runDeliveryWindow(env, {})
        .then((summary) => console.log("[cron] delivery:", JSON.stringify(summary)))
        .catch((err) => console.error("[cron] delivery sweep failed:", err)),
    );

    if (!env.MODAL_TRIGGER_TOKEN) {
      console.log("[cron] MODAL_TRIGGER_TOKEN not set — skipping Modal dispatch");
      return;
    }
    // 06:00 UTC daily — kick ingest + scoring sweep in parallel
    if (env.MODAL_TRIGGER_URL) {
      ctx.waitUntil(
        fetch(env.MODAL_TRIGGER_URL, {
          method: "POST",
          headers: headers(env.MODAL_TRIGGER_TOKEN),
          body: JSON.stringify({ source: "all", days: 1 }),
        }).then((r) => console.log("[cron] ingest status:", r.status)),
      );
    }
    if (env.MODAL_SCORE_URL) {
      ctx.waitUntil(
        fetch(env.MODAL_SCORE_URL, {
          method: "POST",
          headers: headers(env.MODAL_TRIGGER_TOKEN),
          body: JSON.stringify({ scheduled: event.cron }),
        }).then((r) => console.log("[cron] score status:", r.status)),
      );
    }
  },
};
