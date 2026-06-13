import { requireAdmin } from "@/lib/clerk-admin";
import AdminDeliveryClient from "./AdminDeliveryClient";

export const dynamic = "force-dynamic";

export default async function AdminDeliveryPage() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-medium">Not authorized</h1>
        <p className="mt-2 text-sm text-zinc-400">{admin.body.error}</p>
      </main>
    );
  }
  return <AdminDeliveryClient />;
}
