import Link from "next/link";
import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { approveCampaign, createCampaign, generateDraft, saveSequence, saveTemplate, sendDraft, updateDraft } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";

export default async function CampaignsPage() {
  const session = await requireReady();
  const [{ data: campaigns }, { data: templates }, { data: sequences }, { data: leads }, { data: drafts }] = await Promise.all([
    session.supabase.from("campaigns").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }),
    session.supabase.from("email_templates").select("*").eq("workspace_id", session.workspaceId).eq("is_archived", false),
    session.supabase.from("email_sequences").select("*, sequence_steps(*)").eq("workspace_id", session.workspaceId),
    session.supabase.from("leads").select("id, company:companies(name)").eq("workspace_id", session.workspaceId).limit(100),
    session.supabase.from("email_drafts").select("id, subject, body, status, generator, purpose").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Outreach Campaigns" description="Drafts stay unsent until a person approves them and a connected email account passes the compliance checks." />
      <form action={async (formData) => { "use server"; await createCampaign(formData); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-2">
        <Input name="name" placeholder="Campaign name" required />
        <Select name="channel"><option value="email">Email</option><option value="linkedin_draft">LinkedIn draft only</option></Select>
        <Textarea name="description" className="md:col-span-2" placeholder="Description" />
        <Input name="dailyLimit" type="number" defaultValue={25} aria-label="Daily limit" />
        <Button type="submit">Create campaign</Button>
      </form>
      <div className="grid gap-3">{(campaigns ?? []).map((campaign) => <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="rounded-lg border bg-white p-4 text-sm"><span className="font-medium">{campaign.name}</span> · {campaign.status} · limit {campaign.daily_limit}</Link>)}</div>
      <form action={async (formData) => { "use server"; await generateDraft({ leadId: String(formData.get("leadId")), purpose: String(formData.get("purpose")) as "cold", tone: String(formData.get("tone") || "professional") }); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-4">
        <Select name="leadId">{(leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{(Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name}</option>)}</Select>
        <Select name="purpose"><option value="cold">Cold email</option><option value="product">Product email</option><option value="custom">Custom development</option><option value="partnership">Partnership</option><option value="follow_up">Follow-up</option><option value="linkedin">LinkedIn draft</option><option value="proposal">Proposal email</option></Select>
        <Select name="tone"><option>professional</option><option>warm</option><option>direct</option><option>consultative</option></Select>
        <Button type="submit">Generate draft</Button>
      </form>
      <div className="space-y-3">{(drafts ?? []).map((draft) => (
        <article key={draft.id} className="rounded-lg border bg-white p-4 text-sm">
          <p className="font-medium">{draft.subject}</p>
          <p className="mt-2 whitespace-pre-wrap">{draft.body}</p>
          <p className="mt-2 text-muted-foreground">{draft.purpose} · {draft.status} · {draft.generator}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={async () => { "use server"; await updateDraft(draft.id, draft.subject, draft.body, "approved"); }}><Button size="sm" type="submit">Approve</Button></form>
            <form action={async () => { "use server"; await sendDraft(draft.id); }}><Button size="sm" variant="secondary" type="submit">Send</Button></form>
            <form action={async () => { "use server"; await updateDraft(draft.id, draft.subject, draft.body, "discarded"); }}><Button size="sm" variant="destructive" type="submit">Discard</Button></form>
          </div>
        </article>
      ))}</div>
      <form action={async (formData) => { "use server"; await saveTemplate(formData); }} className="grid gap-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">Template</h2>
        <Input name="name" placeholder="Template name" />
        <Input name="subject" placeholder="Subject" />
        <Textarea name="body" placeholder="Body. Use {{contact_name}}, {{company_name}}, {{offering}}, {{signature}}" />
        <Button type="submit" variant="secondary">Save template</Button>
      </form>
      <div className="rounded-lg border bg-white p-5 text-sm">{(templates ?? []).map((template) => <p key={template.id}>{template.name} · {template.subject}</p>)}</div>
      <form action={async (formData) => { "use server"; await saveSequence({ name: String(formData.get("name")), steps: [1, 2, 3, 4].map((position) => ({ delayDays: Number(formData.get(`delay${position}`) || 0), subject: String(formData.get(`subject${position}`) || ""), body: String(formData.get(`body${position}`) || "") })).filter((step) => step.subject && step.body) }); }} className="space-y-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">Sequence</h2>
        <Input name="name" placeholder="Sequence name" />
        {[1, 2, 3, 4].map((position) => <div key={position} className="grid gap-2 md:grid-cols-[100px_1fr]"><Input name={`delay${position}`} type="number" placeholder="Delay days" defaultValue={position === 1 ? 0 : position * 3} /><div><Input name={`subject${position}`} placeholder={`Step ${position} subject`} /><Textarea name={`body${position}`} placeholder={`Step ${position} body`} /></div></div>)}
        <Button type="submit" variant="secondary">Save sequence</Button>
        <div className="text-sm text-muted-foreground">{(sequences ?? []).map((sequence) => <p key={sequence.id}>{sequence.name} · {sequence.status} · {(sequence.sequence_steps ?? []).length} steps</p>)}</div>
      </form>
    </div>
  );
}

export async function CampaignDetail({ id }: { id: string }) {
  const session = await requireReady();
  const [{ data: campaign }, { data: drafts }] = await Promise.all([
    session.supabase.from("campaigns").select("*").eq("id", id).eq("workspace_id", session.workspaceId).single(),
    session.supabase.from("email_drafts").select("*").eq("campaign_id", id).order("created_at", { ascending: false }),
  ]);
  if (!campaign) return <p>Campaign not found.</p>;
  return (
    <div className="space-y-4">
      <PageHeader title={campaign.name} description={`${campaign.status}. Automated sending is ${campaign.allow_automated_send ? "on" : "off"}.`} />
      <form action={async () => { "use server"; await approveCampaign(id, false); }}><Button type="submit">Approve for manual sending</Button></form>
      <form action={async () => { "use server"; await approveCampaign(id, true); }}><Button type="submit" variant="secondary">Approve automated follow-ups</Button></form>
      {(drafts ?? []).map((draft) => (
        <article key={draft.id} className="rounded-lg border bg-white p-4 text-sm">
          <p className="font-medium">{draft.subject}</p>
          <p className="mt-2 whitespace-pre-wrap">{draft.body}</p>
          <p className="mt-2 text-muted-foreground">{draft.status} · {draft.generator}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={async () => { "use server"; await updateDraft(draft.id, draft.subject, draft.body, "approved"); }}><Button size="sm" type="submit">Approve</Button></form>
            <form action={async () => { "use server"; await sendDraft(draft.id); }}><Button size="sm" variant="secondary" type="submit">Send</Button></form>
            <form action={async () => { "use server"; await updateDraft(draft.id, draft.subject, draft.body, "discarded"); }}><Button size="sm" variant="destructive" type="submit">Discard</Button></form>
          </div>
        </article>
      ))}
    </div>
  );
}
