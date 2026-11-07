import Link from "next/link";
import { Suspense } from "react";
import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";

export default function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Searching…</p>}>
      <Search searchParams={searchParams} />
    </Suspense>
  );
}

async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const session = await requireReady();
  const term = `%${q}%`;
  const [{ data: companies }, { data: products }, { data: services }] = q ? await Promise.all([
    session.supabase.from("companies").select("id, name, domain").eq("workspace_id", session.workspaceId).ilike("name", term).limit(20),
    session.supabase.from("products").select("id, name").eq("workspace_id", session.workspaceId).ilike("name", term).limit(20),
    session.supabase.from("service_catalog").select("id, name").eq("workspace_id", session.workspaceId).ilike("name", term).limit(20),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  return (
    <div className="space-y-4">
      <PageHeader title="Search" description={q ? `Results for “${q}”.` : "Type a query in the top bar."} />
      {(companies ?? []).map((company) => <p key={company.id} className="text-sm"><Link className="text-primary" href="/leads">{company.name}</Link> · {company.domain}</p>)}
      {(products ?? []).map((product) => <p key={product.id} className="text-sm"><Link className="text-primary" href="/products">{product.name}</Link> · product</p>)}
      {(services ?? []).map((service) => <p key={service.id} className="text-sm"><Link className="text-primary" href="/products">{service.name}</Link> · service</p>)}
    </div>
  );
}
