import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { logReply } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";

export default async function InboxPage() {
  const session = await requireReady();
  const [{ data: messages }, { data: leads }] = await Promise.all([
    session.supabase.from("email_messages").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(100),
    session.supabase.from("leads").select("id, company:companies(name)").eq("workspace_id", session.workspaceId).limit(100),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Email Inbox" description="Shows stored messages. Open tracking is not claimed. Replies can be logged manually or by a connected provider." />
      <form action={async (formData) => { "use server"; await logReply({ leadId: String(formData.get("leadId")), fromEmail: String(formData.get("from") || ""), subject: String(formData.get("subject") || ""), body: String(formData.get("body") || "") }); }} className="grid gap-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">Log a reply</h2>
        <Select name="leadId">{(leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{(Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name}</option>)}</Select>
        <Input name="from" type="email" placeholder="From email" required />
        <Input name="subject" placeholder="Subject" required />
        <Textarea name="body" placeholder="Reply text" required />
        <Button type="submit">Categorize and save</Button>
      </form>
      <div className="space-y-3">{(messages ?? []).map((message) => <article key={message.id} className="rounded-lg border bg-white p-4 text-sm"><p className="font-medium">{message.direction}: {message.subject}</p><p className="text-muted-foreground">{message.from_email} → {message.to_email} · {message.status} {message.reply_category ? `· ${message.reply_category} (${message.reply_classifier})` : ""}</p><p className="mt-2 whitespace-pre-wrap">{message.body_text}</p></article>)}</div>
    </div>
  );
}
