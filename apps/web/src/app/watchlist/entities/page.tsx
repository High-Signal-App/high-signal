import { requireSignedIn } from "@/lib/require-auth";
import EntityWatchlistClient from "./EntityWatchlistClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watched entities — High Signal" };

export default async function EntityWatchlistPage() {
  await requireSignedIn();
  return <EntityWatchlistClient />;
}
