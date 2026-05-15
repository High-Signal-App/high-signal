import { redirect } from "next/navigation";

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * /signals/random — bounces to a random published signal. Useful for
 * share links and "explore" entry points.
 */
export async function GET() {
  try {
    const { signals } = await api.signals();
    if (signals.length === 0) {
      redirect("/signals");
    }
    const pick = signals[Math.floor(Math.random() * signals.length)];
    redirect(`/signals/${pick.slug}`);
  } catch {
    redirect("/signals");
  }
}
