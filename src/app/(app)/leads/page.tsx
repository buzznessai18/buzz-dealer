import Link from "next/link";
import { Suspense } from "react";
import { requireReady } from "@/lib/auth/session";
import { PageHeader, PageLoading, EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/card";
import { addNote, researchLead, setLawfulBasis, updateLead } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { LAWFUL_BASIS_OPTIONS, PIPELINE_STAGES } from "@/lib/constants";

export default function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<PageLoading label="Loading leads" />}>
      <Leads searchParams={searchParams} />
    </Suspense>
  );
}

async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const session = await requireReady();
  let query = session.supabase.from("leads").select("id, stage, source, deal_value, created_at, company:companies(name, country, industry, domain)").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(100);
  if (params.stage) query = query.eq("stage", params.stage);
  const { data, error } = await query;
  const leads = (data ?? []).filter((lead) => {
    const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
    const haystack = `${company?.name ?? ""} ${company?.country ?? ""} ${company?.industry ?? ""}`.toLowerCase();
    return !params.q || haystack.includes(params.q.toLowerCase());
  });
  return (
    <div className="space-y-6">
      <PageHeader title="Leads & Companies" description="Companies and people saved in this workspace." />
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={params.q} placeholder="Search" className="max-w-xs" />
        <Select name="stage" defaultValue={params.stage || ""}><option value="">All stages</option>{PIPELINE_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {error ? <p className="text-sm text-red-600">{error.message}</p> : null}
      {leads.length === 0 ? <EmptyState title="No leads yet" body="Run discovery or import a CSV. Empty counts stay at zero until records exist." /> : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground"><tr><th className="px-4 py-3">Company</th><th>Industry</th><th>Country</th><th>Stage</th><th>Source</th></tr></thead>
            <tbody>{leads.map((lead) => {
              const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
              return <tr key={lead.id} className="border-t"><td className="px-4 py-3"><Link className="font-medium text-primary" href={`/leads/${lead.id}`}>{company?.name}</Link><p className="text-xs text-muted-foreground">{company?.domain}</p></td><td>{company?.industry}</td><td>{company?.country}</td><td><Badge>{lead.stage.replaceAll("_", " ")}</Badge></td><td>{lead.source}</td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export async function LeadDetail({ id }: { id: string }) {
  const session = await requireReady();
  const [{ data: lead }, { data: research }, { data: scores }, { data: activities }] = await Promise.all([
    session.supabase.from("leads").select("*, company:companies(*), contact:contacts(*)").eq("id", id).eq("workspace_id", session.workspaceId).single(),
    session.supabase.from("lead_research").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    session.supabase.from("lead_scores").select("*").eq("lead_id", id).order("scored_at", { ascending: false }).limit(1).maybeSingle(),
    session.supabase.from("lead_activities").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!lead) return <p>Lead not found.</p>;
  const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
  const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
  const match = lead.custom_fields?.product_match;
  return (
    <div className="space-y-6">
      <PageHeader title={company?.name || "Lead"} description={[company?.industry, company?.country, company?.website].filter(Boolean).join(" · ")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border bg-white p-5 lg:col-span-2 space-y-3">
          <p className="text-sm">{company?.description || "No description is stored."}</p>
          <p className="text-sm">Contact: {contact?.full_name || "No name"} · {contact?.designation || "No role"} · {contact?.email || "No business email"}</p>
          <p className="text-sm">Score: {scores ? `${scores.score}/100` : "Not scored"}</p>
          <p className="text-sm text-muted-foreground">{scores?.explanation}</p>
          <p className="text-sm">Match: {match?.matched ? `${match.offering?.name} (${match.score})` : match?.reason || "No match saved."}</p>
          <form action={async () => { "use server"; await researchLead(id); }}><Button type="submit">Research company</Button></form>
        </section>
        <form action={async (formData) => { "use server"; await updateLead({ id, stage: String(formData.get("stage")), dealValue: Number(formData.get("dealValue") || 0), probability: Number(formData.get("probability") || 0), nextFollowUp: String(formData.get("followUp") || ""), summary: String(formData.get("summary") || "") }); }} className="space-y-3 rounded-lg border bg-white p-5">
          <Select name="stage" defaultValue={lead.stage}>{PIPELINE_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</Select>
          <Input name="dealValue" type="number" defaultValue={lead.deal_value} aria-label="Deal value" />
          <Input name="probability" type="number" min={0} max={100} defaultValue={lead.probability} aria-label="Probability" />
          <Input name="followUp" type="date" defaultValue={lead.next_follow_up || ""} aria-label="Follow-up date" />
          <Textarea name="summary" defaultValue={lead.summary || ""} />
          <Button type="submit">Save lead</Button>
        </form>
      </div>
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-medium">Research</h2>
        {research ? <div className="mt-3 space-y-2 text-sm"><p>{research.overview}</p><p className="font-medium">Verified facts</p><ul>{(research.facts ?? []).map((fact: { statement: string; source?: string }) => <li key={fact.statement}>{fact.statement} {fact.source ? <span className="text-muted-foreground">({fact.source})</span> : null}</li>)}</ul><p className="font-medium">Hypotheses</p><ul>{(research.hypotheses ?? []).map((item: { statement: string }) => <li key={item.statement}>{item.statement}</li>)}</ul></div> : <p className="mt-2 text-sm text-muted-foreground">No research profile yet.</p>}
      </section>
      <form action={async (formData) => { "use server"; await setLawfulBasis({ leadId: id, basis: String(formData.get("basis")), note: String(formData.get("note")), eligible: formData.get("eligible") === "on" }); }} className="space-y-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">Outreach eligibility</h2>
        <p className="text-sm text-muted-foreground">Public contact details do not by themselves authorize marketing email.</p>
        <Select name="basis" defaultValue={lead.lawful_basis || ""}><option value="">Select a basis</option>{LAWFUL_BASIS_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
        <Textarea name="note" defaultValue={lead.lawful_basis_note || ""} placeholder="Why this recipient may be contacted" />
        <label className="flex gap-2 text-sm"><input name="eligible" type="checkbox" defaultChecked={lead.outreach_eligible} />I verified a lawful basis for this recipient</label>
        <Button type="submit" variant="secondary">Save eligibility</Button>
      </form>
      <form action={async (formData) => { "use server"; await addNote(id, String(formData.get("note") || "")); }} className="space-y-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">Notes and timeline</h2>
        <Textarea name="note" placeholder="Add a note" />
        <Button type="submit" variant="secondary">Add note</Button>
        <div className="space-y-2">{(activities ?? []).map((activity) => <p key={activity.id} className="text-sm"><span className="font-medium">{activity.activity_type}</span> · {activity.summary}</p>)}</div>
      </form>
    </div>
  );
}
