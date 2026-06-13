import { api } from "@/lib/api";
import { requireSignedIn } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attributes — Agent Eval" };

export default async function AgentEvalAttributesPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { userId, orgId } = await requireSignedIn();
  const ownerId = orgId ?? userId;
  const { auditId } = await params;
  let attributes: Awaited<ReturnType<typeof api.agentEvalAttributes>>["attributes"] = [];
  try {
    const r = await api.agentEvalAttributes(ownerId, auditId);
    attributes = r.attributes;
  } catch {
    /* empty */
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a
        href="/agent-eval"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
      >
        ← agent eval
      </a>
      <header className="mt-3 border-b border-zinc-800 pb-6">
        <h1 className="text-3xl font-medium tracking-tight">Attributes</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Per-area evidence grid for this audit. Every gap maps to an open evidence task.
        </p>
      </header>

      {attributes.length === 0 ? (
        <div className="mt-10 border border-dashed border-zinc-800 p-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          no attribute scores for this audit yet
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {attributes.map((a) => (
            <li key={a.area} className="border border-zinc-800 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {a.area.replaceAll("_", " ")}
                </span>
                <span
                  className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                    a.status === "strong"
                      ? "border-emerald-500/40 text-emerald-300"
                      : a.status === "clear"
                        ? "border-cyan-500/40 text-cyan-300"
                        : a.status === "weak"
                          ? "border-amber-500/40 text-amber-300"
                          : "border-rose-500/40 text-rose-300"
                  }`}
                >
                  {a.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-300">{a.notes || "no notes"}</p>
              {a.evidenceUrls.length > 0 && (
                <ul className="mt-3 space-y-1 font-mono text-[10px]">
                  {a.evidenceUrls.slice(0, 5).map((u) => (
                    <li key={u}>
                      <a
                        href={u}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-zinc-400 hover:text-zinc-100 hover:underline"
                      >
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {a.taskCount > 0 && (
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-rose-300">
                  {a.taskCount} open task{a.taskCount === 1 ? "" : "s"}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
