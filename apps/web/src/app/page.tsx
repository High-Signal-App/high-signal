import { BriefSections } from "@/components/brief/BriefSections";
import { ProductPicker } from "@/components/brief/ProductPicker";
import { HomeJsonLd } from "@/components/seo/structured-data";
// Auth + ownerId checks intentionally still imported below — the brief route
// still prefers real D1 brand data when an authenticated owner has any.
import { RegionPicker } from "@/components/brief/RegionPicker";
import { HeroHeader, PageShell } from "@/components/system/HighSignalUI";
import { api, type BriefSnapshot } from "@/lib/api";
import { getRequestAuth } from "@/lib/require-auth";
import { findSeedProduct, isRegion, regionLabel, type Region } from "@high-signal/shared";

export const dynamic = "force-dynamic";

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

export default async function HomePage({
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

  let brief: BriefSnapshot = EMPTY_BRIEF;
  try {
    brief = await api.brief({
      region,
      ownerId: ownerId || undefined,
      productId: selectedProduct?.id,
    });
  } catch {
    // worker offline or D1 empty — render the empty brief.
  }

  const spotlightName = brief.perception[0]?.brandName ?? null;
  const heroEyebrow = selectedProduct
    ? `daily brief / ${regionLabel(region).toLowerCase()} / ${selectedProduct.brandName.toLowerCase()}`
    : `daily brief / ${regionLabel(region).toLowerCase()}`;

  return (
    <PageShell>
      <HomeJsonLd />
      <HeroHeader eyebrow={heroEyebrow} title="What changed today">
        High Signal aggregates technology, startup, and finance sources, curates them, and
        synthesizes the day into five sections. Pick any product and any region to see how the
        brief recomposes. Every claim cites at least two sources.
        {selectedProduct ? null : spotlightName ? (
          <>
            {" "}
            <span className="text-[var(--color-muted)]">
              Personal sections currently spotlighting <em>{spotlightName}</em> — switch via the
              product picker.
            </span>
          </>
        ) : null}
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

      <BriefSections brief={brief} />
    </PageShell>
  );
}
