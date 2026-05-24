import Link from "next/link";
import type { SignalRow } from "@/lib/api";
import { signalHeadline, signalSummary } from "@/lib/signal-format";
import { pricedInContext, pricedInTone } from "@/lib/price-context";
import { DirectionPill } from "../atoms/DirectionPill";
import { ConfidenceBadge } from "../atoms/ConfidenceBadge";

export function SignalCard({ s }: { s: SignalRow }) {
  const headline = signalHeadline(s.bodyMd, s.slug);
  const summary = signalSummary(s.bodyMd, s.slug);
  const price = pricedInContext(s.primaryEntityId, s.direction);
  return (
    <Link
      href={`/signals/${s.slug}`}
      className="group block border-b border-zinc-800 px-1 py-7 transition-colors hover:bg-white/[0.02] sm:px-3"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <span>{new Date(s.publishedAt).toISOString().slice(0, 10)}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-[var(--color-accent)]">{s.primaryEntityId}</span>
          <span className="text-zinc-700">·</span>
          {s.contentCategory && (
            <>
              <span>{s.contentCategory.replaceAll("-", " ")}</span>
              <span className="text-zinc-700">·</span>
            </>
          )}
          <span>{s.signalType.replaceAll("_", " ")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {price.status !== "unknown" ? (
            <span
              className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${pricedInTone(price.status)}`}
              title={price.reason}
            >
              {price.label}
            </span>
          ) : null}
          <ConfidenceBadge confidence={s.confidence} />
          <DirectionPill direction={s.direction} />
        </div>
      </div>
      <h3 className="mt-4 max-w-3xl text-xl font-medium leading-snug tracking-tight text-zinc-100 group-hover:text-white">
        {headline}
      </h3>
      {summary && <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{summary}</p>}
      {s.spilloverEntityIds.length > 0 && (
        <div className="mt-4 flex flex-wrap items-baseline gap-1.5 font-mono text-[10px] text-zinc-500">
          <span className="uppercase tracking-[0.18em]">spillover</span>
          {s.spilloverEntityIds.slice(0, 8).map((eid) => (
            <span key={eid} className="border border-zinc-800 px-1.5 py-0.5 text-zinc-400">
              {eid}
            </span>
          ))}
          {s.spilloverEntityIds.length > 8 && (
            <span className="text-zinc-600">+{s.spilloverEntityIds.length - 8}</span>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        <span>
          window <span className="nums text-zinc-300">{s.predictedWindowDays}d</span>
        </span>
        <span>
          evidence <span className="nums text-zinc-300">{s.evidenceUrls.length}</span>
        </span>
        {typeof s.qualityScore === "number" && (
          <span>
            quality <span className="nums text-zinc-300">{s.qualityScore}</span>
          </span>
        )}
        {price.price ? (
          <span title={price.reason}>
            {price.price.ticker}{" "}
            <span className="nums text-zinc-300">
              ${price.price.currentPrice.toFixed(2)}
            </span>{" "}
            / 45d{" "}
            <span className="nums text-zinc-300">
              {price.price.move45d === null
                ? "n/a"
                : `${price.price.move45d >= 0 ? "+" : ""}${price.price.move45d.toFixed(0)}%`}
            </span>
          </span>
        ) : null}
        {s.sourceClasses?.length ? <span>{s.sourceClasses.join(" / ")}</span> : null}
      </div>
    </Link>
  );
}
