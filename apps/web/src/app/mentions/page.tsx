import {
  BackLink,
  CommandButton,
  FeedList,
  Field,
  MetricGrid,
  PageShell,
  Panel,
  SectionHeader,
  StatGrid,
} from "@/components/system/HighSignalUI";
import { api } from "@/lib/api";
import { analyzeMentionVisibility, type AIPlatform } from "@high-signal/shared";
import { requireSignedIn } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mention Intelligence — High Signal" };

const PLATFORM_OPTIONS: AIPlatform[] = ["openai", "anthropic", "google", "perplexity", "custom"];

async function createConfig(formData: FormData) {
  "use server";
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const brandName = `${formData.get("brandName") ?? ""}`.trim();
  const brandUrl = `${formData.get("brandUrl") ?? ""}`.trim() || null;
  const aliasesRaw = `${formData.get("brandAliases") ?? ""}`.trim();
  const brandAliases = aliasesRaw
    ? aliasesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const competitorsRaw = `${formData.get("competitors") ?? ""}`.trim();
  const competitors = competitorsRaw
    .split("\n")
    .map((line) => {
      const [name, url] = line.split(",").map((s) => s.trim());
      return name ? { name, url: url || undefined } : null;
    })
    .filter((c): c is { name: string; url: string | undefined } => Boolean(c));
  const platforms = formData.getAll("platforms").map((v) => String(v)) as AIPlatform[];
  if (!brandName) return;
  await api.createMentionConfig(ownerId, {
    brandName,
    brandUrl,
    brandAliases,
    competitors,
    platforms: platforms.length ? platforms : ["openai"],
    badgeEnabled: formData.get("badgeEnabled") === "on",
  });
  revalidatePath("/mentions");
}

async function deleteConfig(formData: FormData) {
  "use server";
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const id = `${formData.get("configId") ?? ""}`.trim();
  if (!id) return;
  await api.deleteMentionConfig(ownerId, id);
  revalidatePath("/mentions");
}

async function addPrompt(formData: FormData) {
  "use server";
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const configId = `${formData.get("configId") ?? ""}`.trim();
  const promptText = `${formData.get("promptText") ?? ""}`.trim();
  const category = `${formData.get("category") ?? ""}`.trim() || null;
  if (!configId || !promptText) return;
  await api.createMentionPrompt(ownerId, configId, { promptText, category });
  revalidatePath("/mentions");
}

async function runCheck(formData: FormData) {
  "use server";
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const configId = `${formData.get("configId") ?? ""}`.trim();
  if (!configId) return;
  await api.runMentionCheck(ownerId, configId);
  revalidatePath("/mentions");
}

const SAMPLE_TEXT =
  "1. High Signal is a reliable way to track market and community signals. 2. Brandwatch is broader for social listening. See https://highsignal.ai for the product.";

export default async function MentionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ config?: string; previewBrand?: string; previewText?: string }>;
}) {
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const params = (await searchParams) ?? {};

  const dashboardResult = await Promise.allSettled([api.productDashboard(ownerId)]);
  const dashboard = dashboardResult[0].status === "fulfilled" ? dashboardResult[0].value : null;

  const configs = dashboard?.mentions.configs ?? [];
  const activeConfigId = params.config ?? configs[0]?.id ?? "";
  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? configs[0] ?? null;
  const [promptsResult, checksResult] = activeConfig
    ? await Promise.allSettled([
        api.mentionConfigPrompts(ownerId, activeConfig.id),
        api.mentionConfigChecks(ownerId, activeConfig.id),
      ])
    : [];
  const promptsForConfig =
    activeConfig && promptsResult?.status === "fulfilled" ? promptsResult.value.prompts : [];
  const checksForConfig =
    activeConfig && checksResult?.status === "fulfilled" ? checksResult.value.checks : [];
  const recentChecks = dashboard?.mentions.recentChecks ?? [];

  const previewBrand = (params.previewBrand ?? activeConfig?.brandName ?? "High Signal").trim();
  const previewText = (params.previewText ?? SAMPLE_TEXT).trim();
  const previewAnalysis = analyzeMentionVisibility({
    text: previewText,
    brandName: previewBrand,
    brandUrl: activeConfig?.brandUrl ?? null,
    competitors: activeConfig?.competitors.map((c) => ({ name: c.name })) ?? [
      { name: "Brandwatch" },
    ],
  });

  return (
    <PageShell>
      <BackLink />
      <SectionHeader eyebrow="company signal layer" title="Mention Intelligence">
        Brand and competitor visibility across AI assistants. Configure prompts, run checks, and
        score citations + sentiment from real LLM responses.
      </SectionHeader>

      <StatGrid
        items={[
          { label: "brand configs", value: configs.length.toString(), sub: "tracked products" },
          { label: "prompts", value: promptsForConfig.length.toString(), sub: "active config" },
          {
            label: "latest mention rate",
            value: recentChecks[0]?.brandMentionRate != null
              ? `${Math.round((recentChecks[0]?.brandMentionRate ?? 0) * 100)}%`
              : "—",
            sub: recentChecks[0]
              ? `check ${recentChecks[0].createdAt.slice(0, 10)}`
              : "no checks yet",
          },
        ]}
      />

      {configs.length === 0 ? (
        <Panel eyebrow="get started" title="Add your first brand">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Configure a brand once. Add prompts that buyers would actually ask an AI assistant.
            Schedule or run checks on demand to see what answers ChatGPT, Claude, Perplexity, and
            Gemini are returning — with citations, positions, and competitors named.
          </p>
        </Panel>
      ) : null}

      <section className="mt-10 grid gap-8 md:grid-cols-[1.05fr_0.95fr]">
        <Panel eyebrow="new brand config">
          <form action={createConfig}>
            <Field label="Brand name" name="brandName" defaultValue="High Signal" />
            <Field label="Brand URL" name="brandUrl" defaultValue="https://highsignal.ai" />
            <Field
              label="Aliases (comma separated)"
              name="brandAliases"
              defaultValue="HighSignal, High-Signal"
            />
            <Field
              label="Competitors (one per line, optional ,url)"
              name="competitors"
              defaultValue={"Brandwatch\nAlphaSense\nExploding Topics"}
              multiline
            />
            <div className="mt-5 space-y-2 text-sm text-[var(--color-muted)]">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em]">platforms</div>
              <div className="flex flex-wrap gap-3">
                {PLATFORM_OPTIONS.map((platform) => (
                  <label key={platform} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="platforms"
                      value={platform}
                      defaultChecked={platform === "openai"}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    {platform}
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  name="badgeEnabled"
                  className="size-4 accent-[var(--color-accent)]"
                />
                enable public visibility badge
              </label>
            </div>
            <CommandButton>create config</CommandButton>
          </form>
        </Panel>

        <Panel eyebrow="brand configs">
          {configs.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--color-muted)]">No brand configs yet.</p>
          ) : (
            <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {configs.map((config) => (
                <div
                  key={config.id}
                  className={`grid gap-3 py-4 md:grid-cols-[1.2fr_auto] ${
                    config.id === activeConfig?.id ? "" : "opacity-80"
                  }`}
                >
                  <div>
                    <a
                      className="font-medium hover:text-[var(--color-accent)]"
                      href={`/mentions?config=${encodeURIComponent(config.id)}`}
                    >
                      {config.brandName}
                    </a>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {config.platforms.join(" / ") || "no platforms"} ·{" "}
                      {config.competitors.length} competitors
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <form action={runCheck}>
                      <input type="hidden" name="configId" value={config.id} />
                      <button
                        className="border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                        type="submit"
                      >
                        run check
                      </button>
                    </form>
                    <form action={deleteConfig}>
                      <input type="hidden" name="configId" value={config.id} />
                      <button
                        className="border border-[var(--color-line)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] hover:border-rose-400 hover:text-rose-400"
                        type="submit"
                      >
                        delete
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      {activeConfig ? (
        <section className="mt-10 grid gap-8 md:grid-cols-[1fr_1fr]">
          <Panel eyebrow={`prompts / ${activeConfig.brandName}`}>
            <form action={addPrompt}>
              <input type="hidden" name="configId" value={activeConfig.id} />
              <Field label="Prompt" name="promptText" defaultValue="best tools for AI signal tracking" multiline />
              <Field label="Category" name="category" defaultValue="discovery" />
              <CommandButton>add prompt</CommandButton>
            </form>
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              {promptsForConfig.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">
                  No prompts yet. Add one above; you need ≥ 1 to run a check.
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  {promptsForConfig.slice(0, 10).map((prompt) => (
                    <li key={prompt.id} className="border border-[var(--color-line)] p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                        {prompt.category ?? "uncategorized"}
                      </div>
                      <p className="mt-2 leading-6 text-[var(--color-fg)]">{prompt.promptText}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel eyebrow={`recent checks / ${activeConfig.brandName}`}>
            {checksForConfig.length === 0 ? (
              <p className="mt-5 text-sm text-[var(--color-muted)]">No checks yet for this brand.</p>
            ) : (
              <div className="mt-5 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
                {checksForConfig.map((check) => (
                  <div key={check.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                        {check.createdAt.slice(0, 16).replace("T", " ")} / {check.status}
                      </div>
                      <p className="mt-2 leading-6 text-[var(--color-fg)]">
                        {check.summary ?? `${check.completedQueries}/${check.totalQueries} queries`}
                      </p>
                    </div>
                    <div
                      className={`font-mono text-sm ${
                        check.brandMentionRate != null && check.brandMentionRate >= 0.5
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-muted)]"
                      }`}
                    >
                      {check.brandMentionRate != null
                        ? `${Math.round(check.brandMentionRate * 100)}%`
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>
      ) : null}

      <section className="mt-10">
        <Panel eyebrow="preview analyzer" title="One-shot visibility check">
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
            Paste an AI response text below to see how the local NLP analyzer detects brand
            mentions, sentiment, position, and competitor presence. Useful before running a full
            check.
          </p>
          <form className="mt-6 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <Field label="Brand" name="previewBrand" defaultValue={previewBrand} />
              <Field label="Model response" name="previewText" defaultValue={previewText} multiline />
              <CommandButton>analyze</CommandButton>
            </div>
            <MetricGrid
              items={[
                { label: "mentioned", value: previewAnalysis.brandMentioned ? "yes" : "no" },
                { label: "sentiment", value: previewAnalysis.brandSentiment ?? "none" },
                { label: "position", value: previewAnalysis.brandPosition?.toString() ?? "—" },
                { label: "brand cited", value: previewAnalysis.brandCited ? "yes" : "no" },
              ]}
            />
          </form>
        </Panel>
      </section>

      <FeedList
        eyebrow="check history"
        empty="No checks across configs yet."
        items={recentChecks.map((check) => ({
          href: `/mentions?config=${encodeURIComponent(check.configId)}`,
          kicker: `${check.createdAt.slice(0, 16).replace("T", " ")} / ${check.status}`,
          title:
            check.summary ??
            `${check.completedQueries}/${check.totalQueries} queries · ${
              check.brandMentionRate != null ? `${Math.round(check.brandMentionRate * 100)}%` : "—"
            }`,
          body: null,
        }))}
      />
    </PageShell>
  );
}
