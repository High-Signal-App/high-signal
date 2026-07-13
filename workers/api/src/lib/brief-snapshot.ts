import type { BriefSnapshot } from "@high-signal/shared";

export interface BriefSnapshotEnv {
  API_BASE?: string;
}

/** Fetch the canonical daily brief through the same route used by the web
 * surface. Callers fail closed when API_BASE is unavailable; they never invent
 * a transport-specific replacement payload. */
export async function fetchBriefSnapshot(
  env: BriefSnapshotEnv,
  region: string,
  connectedBrandId: string | null,
  ownerId?: string,
): Promise<BriefSnapshot | null> {
  if (!env.API_BASE) return null;
  const url = `${env.API_BASE}/brief/daily?region=${encodeURIComponent(region)}${
    connectedBrandId ? `&product=${encodeURIComponent(connectedBrandId)}` : ""
  }${ownerId ? `&owner=${encodeURIComponent(ownerId)}` : ""}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as BriefSnapshot;
  } catch {
    return null;
  }
}
