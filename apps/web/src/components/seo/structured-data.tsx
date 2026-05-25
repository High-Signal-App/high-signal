import {
  buildBreadcrumbJsonLd,
  buildEntityMonthJsonLd,
  buildFaqJsonLd,
  buildHomeJsonLd,
  buildMethodologyJsonLd,
  buildOrganizationJsonLd,
  buildSignalArticleJsonLd,
  buildSignalTypeTaxonomyJsonLd,
  buildTrackRecordDatasetJsonLd,
} from "@/components/seo/json-ld-builders";

/**
 * Schema.org JSON-LD components for GEO (generative-engine optimization).
 *
 * Each component renders a <script type="application/ld+json"> block that
 * AI assistants, Google AI Overviews, and crawlers parse to understand
 * what kind of entity the page is and which facts it commits to.
 *
 * Render these *inside* a server component (page or layout) so they ship
 * in the initial HTML, not via client hydration.
 */

interface LdJsonProps {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}

function LdJson({ data }: LdJsonProps): React.JSX.Element {
  // dangerouslySetInnerHTML is the documented Next.js path for inlining
  // JSON-LD; the payload is trusted server-side (no user content) and
  // <script> escaping isn't needed here.
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/**
 * Site-wide Organization + WebSite JSON-LD. Ship in the root layout so
 * every page carries it. Search engines and AI assistants use these to
 * resolve the publisher across crawls.
 */
export function SiteOrganizationJsonLd(): React.JSX.Element {
  return <LdJson data={buildOrganizationJsonLd()} />;
}

export function HomeJsonLd(): React.JSX.Element {
  return <LdJson data={buildHomeJsonLd()} />;
}

export function TrackRecordDatasetJsonLd(props: {
  liveCount: number;
  backfillCount: number;
}): React.JSX.Element {
  return <LdJson data={buildTrackRecordDatasetJsonLd(props)} />;
}

export function SignalArticleJsonLd(props: {
  headline: string;
  slug: string;
  publishedAt: string;
  bodyMd: string;
  entityName: string;
  evidenceUrls: string[];
  direction: "up" | "down" | "neutral";
  confidence: "low" | "medium" | "high";
  predictedWindowDays: number;
  signalType: string;
}): React.JSX.Element {
  return <LdJson data={buildSignalArticleJsonLd(props)} />;
}

export function FaqJsonLd({
  items,
}: {
  items: Array<{ question: string; answer: string }>;
}): React.JSX.Element {
  return <LdJson data={buildFaqJsonLd(items)} />;
}

export function BreadcrumbJsonLd({
  trail,
}: {
  trail: Array<{ name: string; path: string }>;
}): React.JSX.Element {
  return <LdJson data={buildBreadcrumbJsonLd(trail)} />;
}

export function MethodologyJsonLd({
  steps,
}: {
  steps: Array<{ name: string; text: string }>;
}): React.JSX.Element {
  return <LdJson data={buildMethodologyJsonLd({ steps })} />;
}

export function SignalTypeTaxonomyJsonLd(props: {
  signalType: string;
  family: string;
  totalCount: number;
  hitRate: number | null;
  sampleSize: number;
}): React.JSX.Element {
  return <LdJson data={buildSignalTypeTaxonomyJsonLd(props)} />;
}

export function EntityMonthJsonLd(props: {
  entityName: string;
  entityId: string;
  period: string;
  signalCount: number;
}): React.JSX.Element {
  return <LdJson data={buildEntityMonthJsonLd(props)} />;
}
