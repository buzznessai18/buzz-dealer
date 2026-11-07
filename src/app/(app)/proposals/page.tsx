import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { createProposal, setProposalStatus } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export default async function ProposalsPage() {
  const session = await requireReady();
  const [{ data: proposals }, { data: leads }, { data: opportunities }] = await Promise.all([
    session.supabase.from("proposals").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }),
    session.supabase.from("leads").select("id, company:companies(name)").eq("workspace_id", session.workspaceId).limit(100),
    session.supabase.from("lead_opportunities").select("id, title").eq("workspace_id", session.workspaceId).limit(100),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Proposals" description="Proposal drafts explain what is verified and what is a hypothesis. They do not invent a project budget." />
      <form action={async (formData) => { "use server"; await createProposal({ title: String(formData.get("title")), leadId: String(formData.get("leadId") || ""), opportunityId: String(formData.get("opportunityId") || "") }); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-2">
        <Input name="title" placeholder="Proposal title" required />
        <Select name="leadId"><option value="">No lead</option>{(leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{(Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name}</option>)}</Select>
        <Select name="opportunityId"><option value="">No opportunity</option>{(opportunities ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select>
        <Button type="submit">Create proposal</Button>
      </form>
      {(proposals ?? []).map((proposal) => <article key={proposal.id} className="rounded-lg border bg-white p-5"><h2 className="font-medium">{proposal.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm">{proposal.body}</p><div className="mt-3 flex gap-2"><form action={async () => { "use server"; await setProposalStatus(proposal.id, "approved"); }}><Button size="sm" variant="secondary">Approve</Button></form><form action={async () => { "use server"; await setProposalStatus(proposal.id, "sent"); }}><Button size="sm">Mark sent</Button></form></div></article>)}
    </div>
  );
}
