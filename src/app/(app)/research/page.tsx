import Link from "next/link";
import { requireReady } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/ui/feedback";
import { convertOpportunity } from "@/server/actions";
import { Button } from "@/components/ui/button";

export default async function ResearchPage() {
  const session = await requireReady();
  const [{ data: research }, { data: opportunities }] = await Promise.all([
    session.supabase.from("lead_research").select("id, overview, generator, researched_at, lead_id, company:companies(name)").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(30),
    session.supabase.from("lead_opportunities").select("*").eq("workspace_id", session.workspaceId).eq("status", "open").order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="AI Research" description="Verified facts stay separate from hypotheses. Opportunities do not claim a budget or a confirmed requirement." />
      <section className="space-y-3">
        <h2 className="font-medium">Research profiles</h2>
        {(research ?? []).length === 0 ? <EmptyState title="No research yet" body="Open a lead and run Research company." /> : (research ?? []).map((item) => {
          const company = Array.isArray(item.company) ? item.company[0] : item.company;
          return <article key={item.id} className="rounded-lg border bg-white p-4 text-sm"><Link className="font-medium text-primary" href={`/leads/${item.lead_id}`}>{company?.name}</Link><p className="mt-1">{item.overview}</p><p className="mt-1 text-muted-foreground">{item.generator} · {item.researched_at}</p></article>;
        })}
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Custom project hypotheses</h2>
        {(opportunities ?? []).length === 0 ? <EmptyState title="No opportunities yet" body="Use opportunity search in AI Lead Discovery." /> : (opportunities ?? []).map((item) => (
          <article key={item.id} className="rounded-lg border bg-white p-4 text-sm">
            <h3 className="font-medium">{item.title}</h3>
            <p className="mt-2">{item.business_context}</p>
            <p className="mt-2 text-muted-foreground">{item.potential_problem}</p>
            <p className="mt-2">Suggested solution: {item.recommended_solution}</p>
            <p className="mt-2">Suggested stack: {(item.proposed_stack ?? []).join(", ")}. Complexity: {item.complexity}. This is our delivery estimate, not the prospect’s budget.</p>
            <p className="mt-2">Next step: {item.next_step}</p>
            <form className="mt-3" action={async () => { "use server"; await convertOpportunity(item.id); }}><Button type="submit" variant="secondary">Convert to CRM lead</Button></form>
          </article>
        ))}
      </section>
    </div>
  );
}
