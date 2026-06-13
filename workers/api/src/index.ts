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
import { briefRoute } from "./routes/brief";
import { convergenceRoute } from "./routes/convergence";
import { unmappedRoute } from "./routes/unmapped";
import { enrichRoute } from "./routes/enrich";
import { attentionRoute } from "./routes/attention";
import { claimsRoute } from "./routes/claims";
import { deliveryRoute } from "./routes/delivery";
import { watchlistsRoute } from "./routes/watchlists";

type Env = {
  DB: D1Database;
  ENVIRONMENT: string;
  ADMIN_TOKEN?: string;
  MODAL_TRIGGER_URL?: string;
  MODAL_TRIGGER_TOKEN?: string;
  MODAL_SCORE_URL?: string;
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

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    if (!env.MODAL_TRIGGER_TOKEN) {
      console.log("[cron] MODAL_TRIGGER_TOKEN not set — skipping all dispatch");
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
