import {
  BackLink,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildApprovedTaskTeardowns,
  type ApprovedTaskTeardown,
  type PersonalComplaintCluster,
  type PersonalReelBrief,
} from "@high-signal/shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manual Teardowns — High Signal" };

const DATA_ROOT = resolve(process.cwd(), "../../data");

type ComplaintClusterSnapshot = {
  generatedAt: string;
  clusters: PersonalComplaintCluster[];
};

type ReelBriefSnapshot = {
  generatedAt: string;
  reelBriefs: PersonalReelBrief[];
};

async function readJsonl<T>(filename: string): Promise<T[]> {
  try {
    const raw = await readFile(resolve(DATA_ROOT, filename), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function latestByGeneratedAt<T extends { generatedAt: string }>(items: T[]) {
  return items.slice().sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

function taskShortId(taskId: string) {
  return taskId.slice(0, 8);
}

function statusTone(status: ApprovedTaskTeardown["status"]) {
  if (status === "ready-for-manual-output") return "text-[var(--color-accent)]";
  if (status === "needs-source-check") return "text-amber-300";
  return "text-red-300";
}

function modeLabel(mode: ApprovedTaskTeardown["mode"]) {
  return mode.replaceAll("-", " ");
}

function TeardownPanel({ item }: { item: ApprovedTaskTeardown }) {
  return (
    <Panel eyebrow={`${taskShortId(item.taskId)} / ${modeLabel(item.mode)}`} title={item.title}>
      <div className={`mt-4 font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone(item.status)}`}>
        {item.status.replaceAll("-", " ")}
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">{item.humanTension}</p>
      <MetricGrid
        items={[
          { label: "cluster", value: item.clusterTitle },
          { label: "confidence", value: item.confidence },
          { label: "repeats", value: item.repeatedSignalCount.toString() },
          { label: "sources", value: item.sourceCount.toString() },
        ]}
      />

      <div className="mt-6 border-y border-[var(--color-line)] py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
          validation artifact
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.validationArtifact}</p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            teardown questions
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
            {item.teardownQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            sample evidence
          </div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
            {item.sampleTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
            {item.sampleTitles.length === 0 ? <li>No sample titles in latest snapshot.</li> : null}
          </ul>
        </div>
      </div>

      <div className="mt-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
          next manual output
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.nextManualOutput}</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {item.evidenceUrls.map((url) => (
          <a
            className="border border-[var(--color-line)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href={url}
            key={url}
          >
            source
          </a>
        ))}
        {item.evidenceUrls.length === 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-300">
            missing sources
          </span>
        ) : null}
      </div>

      <p className="mt-5 font-mono text-[10px] uppercase leading-5 tracking-[0.18em] text-[var(--color-muted)]">
        {item.claimBoundary}
      </p>
    </Panel>
  );
}

export default async function TeardownsPage() {
  const [clusterSnapshots, reelSnapshots] = await Promise.all([
    readJsonl<ComplaintClusterSnapshot>("personal-complaint-clusters.jsonl"),
    readJsonl<ReelBriefSnapshot>("personal-reel-briefs.jsonl"),
  ]);
  const latestClusters = latestByGeneratedAt(clusterSnapshots);
  const latestReels = latestByGeneratedAt(reelSnapshots);
  const generatedAt = latestClusters?.generatedAt ?? latestReels?.generatedAt ?? null;
  const teardowns = buildApprovedTaskTeardowns({
    clusters: latestClusters?.clusters ?? [],
    reelBriefs: latestReels?.reelBriefs ?? [],
    generatedAt,
  });
  const ready = teardowns.filter((item) => item.status === "ready-for-manual-output").length;
  const evidenceLinks = new Set(teardowns.flatMap((item) => item.evidenceUrls)).size;

  return (
    <PageShell max="max-w-5xl">
      <BackLink />
      <SectionHeader eyebrow="approved tasks" title="Manual Teardowns">
        Source-linked product slices for the three approved High Signal tasks. This page keeps the
        next output manual and narrow: one teardown, one validation artifact, or one owned-product
        audit before new tooling.
      </SectionHeader>

      <StatGrid
        items={[
          { label: "approved tasks", value: teardowns.length.toString(), sub: "only the requested IDs" },
          { label: "ready outputs", value: `${ready}/${teardowns.length}`, sub: "high-confidence evidence" },
          { label: "source links", value: evidenceLinks.toString(), sub: "latest snapshots" },
          { label: "snapshot", value: generatedAt?.slice(0, 10) ?? "none", sub: "complaints + reels" },
        ]}
      />

      <section className="mt-10 grid gap-6">
        {teardowns.map((item) => (
          <TeardownPanel item={item} key={item.taskId} />
        ))}
      </section>
    </PageShell>
  );
}
