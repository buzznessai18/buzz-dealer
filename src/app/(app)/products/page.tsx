import { requireReady } from "@/lib/auth/session";
import { OfferingActions, ProductForm } from "@/components/product-form";
import { EmptyState, PageHeader } from "@/components/ui/feedback";

export default async function ProductsPage() {
  const session = await requireReady();
  const [{ data: products }, { data: services }] = await Promise.all([
    session.supabase.from("products").select("*").eq("workspace_id", session.workspaceId).order("name"),
    session.supabase.from("service_catalog").select("*").eq("workspace_id", session.workspaceId).order("name"),
  ]);
  const items = [
    ...(products ?? []).map((item) => ({ ...item, kind: "product" as const })),
    ...(services ?? []).map((item) => ({ ...item, kind: "service" as const })),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Products & Services" description="Ready-made products and custom development services used for matching and outreach." />
      <ProductForm />
      {items.length === 0 ? <EmptyState title="Catalog is empty" body="Add a product or service. Matching will not force a fit when nothing relevant is saved." /> : (
        <div className="grid gap-4 lg:grid-cols-2">{items.map((item) => (
          <article key={item.id} className="rounded-lg border bg-white p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase text-muted-foreground">{item.kind}</p><h2 className="text-lg font-semibold">{item.name}</h2></div><OfferingActions kind={item.kind} id={item.id} status={item.status} /></div>
            <p className="mt-2 text-sm">{item.description}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.category} · {item.status}</p>
          </article>
        ))}</div>
      )}
    </div>
  );
}
