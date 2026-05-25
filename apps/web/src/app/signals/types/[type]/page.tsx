import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  BackLink,
  FeedList,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import {
  BreadcrumbJsonLd,
  SignalTypeTaxonomyJsonLd,
} from "@/components/seo/structured-data";
import { api, type SignalRow } from "@/lib/api";
import { signalHeadline } from "@/lib/signal-format";
import { familyForSignalType, familyLabel } from "@high-signal/shared";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const { type } = await params;
  const family = familyForSignalType(type);
  const human = type.replaceAll("_", " ");
  return {
    title: `${human} signals`,
    description: `Every High Signal call tagged ${human}. Family: ${familyLabel(family)}. Hit-rate, recent examples, and citation policy on one page.`,
    alternates: { canonical: `${SITE_URL}/signals/types/${type}` },
  };
}

export default async function SignalTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!/^[a-z][a-z0-9_]*$/i.test(type)) notFound();

  let signals: SignalRow[] = [];
  let buckets: { signalType: string; total: number; hit: number; miss: number; push: number; hitRate: number | null }[] = [];

  try {
    const data = await api.signals({ type, limit: 500 });
    signals = data.signals;
  } catch {
    /* api offline */
  }
  try {
    const { buckets: cohortBuckets } = await api.trackRecord();
    buckets = cohortBuckets;
  } catch {
    /* api offline */
  }

  if (signals.length === 0 && !buckets.find((b) => b.signalType === type)) {
    notFound();
  }

  const family = familyForSignalType(type);
  const bucket = buckets.find((b) => b.signalType === type);
  const hitRate = bucket?.hitRate ?? null;
  const sample = bucket ? bucket.hit + bucket.miss : 0;

  // Family aggregate (for cold-start cases where this type has no scored runs yet).
  const familyTypes = buckets.filter((b) => familyForSignalType(b.signalType) === family);
  const familyHits = familyTypes.reduce((sum, b) => sum + b.hit, 0);
  const familyMisses = familyTypes.reduce((sum, b) => sum + b.miss, 0);
  const familyHitRate = familyHits + familyMisses > 0 ? familyHits / (familyHits + familyMisses) : null;

  const human = type.replaceAll("_", " ");

  return (
    <PageShell>
      <BackLink href="/signals/types">back to types</BackLink>
      <BreadcrumbJsonLd
        trail={[
          { name: "Home", path: "/" },
          { name: "Signals", path: "/signals" },
          { name: "Types", path: "/signals/types" },
          { name: human, path: `/signals/types/${type}` },
        ]}
      />
      <SignalTypeTaxonomyJsonLd
        signalType={type}
        family={family}
        totalCount={signals.length}
        hitRate={hitRate}
        sampleSize={sample}
      />

      <SectionHeader eyebrow={`signal type · ${familyLabel(family)}`} title={human}>
        Every published <strong>{human}</strong> signal with its public hit-rate inline. Belongs to
        the {familyLabel(family)} family, which means fresh {human} calls borrow confidence from
        sibling types in the family until they earn their own sample.
      </SectionHeader>

      <StatGrid
        items={[
          {
            label: "all-time signals",
            value: signals.length.toString(),
            sub: "published only",
          },
          {
            label: "direct hit-rate",
            value: hitRate != null ? `${Math.round(hitRate * 100)}%` : "—",
            sub:
              sample > 0
                ? `${sample} scored predictions`
                : "no scored predictions yet",
          },
          {
            label: "family hit-rate",
            value: familyHitRate != null ? `${Math.round(familyHitRate * 100)}%` : "—",
            sub: `${familyHits + familyMisses} across ${familyLabel(family)}`,
          },
          {
            label: "family",
            value: familyLabel(family),
            sub: "see signal-families.ts for mapping",
          },
        ]}
      />

      <Panel eyebrow="definition" title={`What is a ${human} signal?`}>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
          A {human} signal is any High-Signal-published call tagged{" "}
          <code className="text-[var(--color-fg)]">{type}</code> by the ingest pipeline. The exact
          extraction rules live in <code className="text-[var(--color-fg)]">python/ingest</code>
          {" "}and the family rollup in{" "}
          <a className="text-[var(--color-accent)] hover:underline" href="/methodology">
            /methodology
          </a>
          . Every published instance carries ≥ 2 independent sources per the cite-or-kill rule.
        </p>
      </Panel>

      <FeedList
        eyebrow={`every published ${human} signal`}
        empty={`No ${human} signals have been published yet.`}
        items={signals.slice(0, 50).map((s) => ({
          href: `/signals/${s.slug}`,
          kicker: `${new Date(s.publishedAt).toISOString().slice(0, 10)} · ${s.primaryEntityId} · ${s.direction} · ${s.confidence}`,
          title: signalHeadline(s.bodyMd, s.slug),
          body: null,
        }))}
      />
    </PageShell>
  );
}
