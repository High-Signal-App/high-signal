import { BriefSections } from "@/components/brief/BriefSections";
import { ProductPicker } from "@/components/brief/ProductPicker";
import { RegionPicker } from "@/components/brief/RegionPicker";
import { HeroHeader, PageShell } from "@/components/system/HighSignalUI";
import { api, type BriefSnapshot } from "@/lib/api";
import { getRequestAuth } from "@/lib/require-auth";
import { findSeedProduct, isRegion, regionLabel, type Region } from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Daily Brief — High Signal" };

const EMPTY_BRIEF: BriefSnapshot = {
  generatedAt: new Date().toISOString(),
  region: "global",
  hasBrand: false,
  stocks: [],
  ideas: [],
  trends: [],
  perception: [],
  improvements: [],
};

function ConvergenceCallout({
  convergence,
}: {
  convergence: Awaited<ReturnType<typeof api.convergence>> | null;
}) {
  // Show at most 5 top entities. Hide the section entirely if nothing converged.
  const rows = (convergence?.rows ?? []).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 border border-[var(--color-line)] bg-zinc-950/40 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Watching closely
        </h2>
        <a
          href="/convergence"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
        >
          all →
        </a>
      </header>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Hit by ≥3 distinct sources in the last 24h — pre-news convergence.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {rows.map((row) => (
          <li
            key={row.entityId}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-zinc-900 pt-1.5 first:border-0 first:pt-0"
          >
            <a
              href={`/entities/${encodeURIComponent(row.entityId)}`}
              className="font-mono text-zinc-100 hover:text-[var(--color-accent)]"
            >
              {row.ticker ?? row.entityId}
            </a>
            {row.name ? <span className="text-zinc-400">{row.name}</span> : null}
            <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              {row.sourceCount} src · {row.eventCount} ev
              {row.marketQuote && row.marketQuote.probChange != null ? (
                <span
                  className={`ml-2 ${
                    row.marketQuote.probChange > 0.02
                      ? "text-emerald-300"
                      : row.marketQuote.probChange < -0.02
                        ? "text-red-300"
                        : ""
                  }`}
                >
                  {row.marketQuote.probChange >= 0 ? "+" : ""}
                  {(row.marketQuote.probChange * 100).toFixed(0)}pp
                </span>
              ) : null}
            </span>
            <div className="basis-full pl-0">
              <span className="font-mono text-[10px] text-zinc-600">
                {row.sources.slice(0, 6).join(" · ")}
                {row.sources.length > 6 ? ` · +${row.sources.length - 6}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function BriefPage({
  searchParams,
}: {
  searchParams?: Promise<{ region?: string; product?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const rawRegion = (params.region ?? "global").toLowerCase().trim();
  const region: Region = isRegion(rawRegion) ? rawRegion : "global";
  const productParam = (params.product ?? "").trim();
  const selectedProduct = productParam ? findSeedProduct(productParam) : null;
  const activeProductId = selectedProduct ? selectedProduct.id : "spotlight";

  const auth = await getRequestAuth();
  const userId = (auth && "userId" in auth && auth.userId) || null;
  const ownerId = (auth && "orgId" in auth && auth.orgId) || userId || "";

  // Brief + convergence load in parallel; convergence failure doesn't block the brief.
  let brief: BriefSnapshot = EMPTY_BRIEF;
  let convergence: Awaited<ReturnType<typeof api.convergence>> | null = null;
  const [briefRes, convergenceRes] = await Promise.allSettled([
    api.brief({
      region,
      ownerId: ownerId || undefined,
      productId: selectedProduct?.id,
    }),
    api.convergence(24, 3),
  ]);
  if (briefRes.status === "fulfilled") brief = briefRes.value;
  if (convergenceRes.status === "fulfilled") convergence = convergenceRes.value;

  return (
    <PageShell>
      <HeroHeader
        eyebrow={`daily brief / ${regionLabel(region).toLowerCase()}${
          selectedProduct ? ` / ${selectedProduct.brandName.toLowerCase()}` : ""
        }`}
        title="What changed today"
      >
        Synthesized from the lenses below. Five sections — three on the world, two on whichever
        product you've picked. Every claim cites at least one source.
      </HeroHeader>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--color-line)] py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <RegionPicker active={region} />
          <ProductPicker active={activeProductId} />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          generated {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC
        </div>
      </div>

      <ConvergenceCallout convergence={convergence} />

      <BriefSections brief={brief} />
    </PageShell>
  );
}
