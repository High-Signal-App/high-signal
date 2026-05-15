import { redirect } from "next/navigation";

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** /entities/random — bounces to a random entity from the seed corpus. */
export async function GET() {
  try {
    const { entities } = await api.entities();
    if (entities.length === 0) {
      redirect("/entities");
    }
    const pick = entities[Math.floor(Math.random() * entities.length)];
    redirect(`/entities/${pick.id}`);
  } catch {
    redirect("/entities");
  }
}
