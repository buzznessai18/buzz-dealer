import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { addMember, purgeData, updateSettings } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";

export default async function SettingsPage() {
  const session = await requireReady();
  const [{ data: members }, { data: usage }] = await Promise.all([
    session.supabase.from("workspace_members").select("id, role, user:profiles(full_name, email)").eq("workspace_id", session.workspaceId),
    session.supabase.from("ai_usage_logs").select("input_tokens, output_tokens, estimated_cost").eq("workspace_id", session.workspaceId),
  ]);
  const tokens = (usage ?? []).reduce((sum, row) => sum + Number(row.input_tokens || 0) + Number(row.output_tokens || 0), 0);
  const compliance = session.settings.compliance;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company profile, compliance gates, members, and AI limits." />
      <form action={async (formData) => { "use server"; await updateSettings(formData); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-2">
        <Input name="companyName" defaultValue={session.company.company_name} aria-label="Company name" />
        <Input name="website" defaultValue={session.company.website || ""} aria-label="Website" />
        <Input name="email" defaultValue={session.company.email || ""} aria-label="Email" />
        <Input name="location" defaultValue={session.company.location || ""} aria-label="Location" />
        <Textarea name="description" className="md:col-span-2" defaultValue={session.company.description || ""} />
        <Textarea name="mailingAddress" className="md:col-span-2" defaultValue={session.company.mailing_address || ""} />
        <Textarea name="signature" className="md:col-span-2" defaultValue={session.company.email_signature || ""} />
        <Input name="countries" defaultValue={session.company.target_countries.join(", ")} aria-label="Target countries" />
        <Input name="industries" defaultValue={session.company.target_industries.join(", ")} aria-label="Target industries" />
        <Input name="allowedCountries" defaultValue={(compliance.allowed_countries ?? []).join(", ")} aria-label="Allowed outreach countries" />
        <Select name="aiProvider" defaultValue={session.company.ai_provider}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></Select>
        <Input name="aiModel" defaultValue={session.company.ai_model} aria-label="AI model" />
        <Input name="currency" defaultValue={session.settings.currency} aria-label="Currency" />
        <Input name="brandVoice" defaultValue={session.settings.brand_voice} aria-label="Brand voice" />
        <Input name="language" defaultValue={session.settings.content_language} aria-label="Language" />
        <Input name="dailyLimit" type="number" defaultValue={session.settings.daily_send_limit} aria-label="Daily send limit" />
        <Input name="minHours" type="number" defaultValue={session.settings.min_hours_between_emails} aria-label="Minimum hours between emails" />
        <Input name="tokenLimit" type="number" defaultValue={session.settings.ai_monthly_token_limit} aria-label="Monthly AI token limit" />
        <Input name="retentionDays" type="number" defaultValue={session.settings.data_retention_days} aria-label="Retention days" />
        <label className="flex gap-2 text-sm"><input name="requireApproval" type="checkbox" defaultChecked={session.settings.require_manual_approval} />Require manual approval</label>
        <label className="flex gap-2 text-sm"><input name="dpdp" type="checkbox" defaultChecked={compliance.dpdp_acknowledged} />I will follow India’s DPDP Act and will not treat public data as consent.</label>
        <label className="flex gap-2 text-sm"><input name="gdpr" type="checkbox" defaultChecked={compliance.gdpr_acknowledged} />I will record a lawful basis before emailing people in the EU or UK.</label>
        <label className="flex gap-2 text-sm"><input name="canSpam" type="checkbox" defaultChecked={compliance.can_spam_acknowledged} />I will include a physical address and a working unsubscribe path.</label>
        <label className="flex gap-2 text-sm"><input name="trai" type="checkbox" defaultChecked={compliance.trai_acknowledged} />I understand this app does not send promotional SMS and email still needs a lawful basis.</label>
        <Button type="submit">Save settings</Button>
      </form>
      <section className="rounded-lg border bg-white p-5 text-sm">
        <h2 className="font-medium">AI usage</h2>
        <p className="mt-2">{tokens.toLocaleString()} tokens recorded against a limit of {session.settings.ai_monthly_token_limit.toLocaleString()}.</p>
      </section>
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-medium">Members</h2>
        {(members ?? []).map((member) => { const user = Array.isArray(member.user) ? member.user[0] : member.user; return <p key={member.id} className="mt-2 text-sm">{user?.full_name || user?.email} · {member.role}</p>; })}
        <form action={async (formData) => { "use server"; await addMember(String(formData.get("email") || ""), String(formData.get("role") || "member") as "member"); }} className="mt-4 flex flex-wrap gap-2">
          <Input name="email" type="email" placeholder="Existing user email" className="max-w-xs" />
          <Select name="role"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></Select>
          <Button type="submit" variant="secondary">Add member</Button>
        </form>
      </section>
      <form action={async () => { "use server"; await purgeData(); }} className="rounded-lg border bg-white p-5">
        <h2 className="font-medium">Data retention</h2>
        <p className="mt-2 text-sm text-muted-foreground">Owners can delete old activity, email events, AI logs, read notifications, and finished workflow runs. Leads, sent messages, suppression, and audit logs stay.</p>
        <Button className="mt-3" variant="destructive" type="submit">Purge expired operational data</Button>
      </form>
    </div>
  );
}
