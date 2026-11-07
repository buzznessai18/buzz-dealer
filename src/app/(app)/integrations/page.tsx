import { requireReady } from "@/lib/auth/session";
import { INTEGRATION_CATALOG } from "@/lib/constants";
import { resolveProvider } from "@/lib/integrations/credentials";
import { PageHeader } from "@/components/ui/feedback";
import { saveIntegration, testIntegration } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELDS: Record<string, Array<{ name: string; label: string }>> = {
  openai: [{ name: "apiKey", label: "API key" }],
  anthropic: [{ name: "apiKey", label: "API key" }],
  gemini: [{ name: "apiKey", label: "API key" }],
  google_search: [{ name: "apiKey", label: "API key" }, { name: "cx", label: "Search engine ID" }],
  google_maps: [{ name: "apiKey", label: "API key" }],
  hunter: [{ name: "apiKey", label: "API key" }],
  apollo: [{ name: "apiKey", label: "API key" }],
  resend: [{ name: "apiKey", label: "API key" }, { name: "fromEmail", label: "From email" }],
  gmail: [],
};

export default async function IntegrationsPage() {
  const session = await requireReady();
  const cards = await Promise.all(INTEGRATION_CATALOG.map(async (item) => {
    if (item.id === "linkedin" || item.id === "stripe") return { ...item, configured: false, source: "unavailable", error: null as string | null };
    const resolved = await resolveProvider(session.admin, session.workspaceId, item.id as "openai");
    return { ...item, configured: resolved.configured, source: resolved.source, error: resolved.row?.last_error ?? null, enabled: resolved.row?.enabled !== false };
  }));
  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" description="Secrets are encrypted when a workspace saves them. Full keys are never shown again. Deployment environment keys are shared by every workspace on this server." />
      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <article key={card.id} className="rounded-lg border bg-white p-5">
            <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{card.name}</h2><span className="text-xs text-muted-foreground">{card.configured ? `Configured via ${card.source}` : "Not configured"}</span></div>
            <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
            {card.error ? <p className="mt-2 text-sm text-red-600">{card.error}</p> : null}
            {card.id === "linkedin" || card.id === "stripe" ? <p className="mt-3 text-sm">This connector is visible so its status is clear. No API call is made.</p> : (
              <form action={async (formData) => { "use server"; const values = Object.fromEntries(FIELDS[card.id]?.map((field) => [field.name, String(formData.get(field.name) || "")]) ?? []); await saveIntegration(card.id, values, formData.get("enabled") === "on"); }} className="mt-4 space-y-3">
                {FIELDS[card.id]?.map((field) => <Input key={field.name} name={field.name} type="password" placeholder={field.label} autoComplete="off" aria-label={field.label} />)}
                {card.id === "gmail" ? <a className="inline-block text-sm text-primary" href="/api/integrations/gmail/start">Connect Gmail</a> : null}
                <label className="flex gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked />Enabled</label>
                <div className="flex gap-2"><Button type="submit" variant="secondary">Save</Button></div>
              </form>
            )}
            {card.id !== "linkedin" && card.id !== "stripe" ? <form className="mt-3" action={async () => { "use server"; await testIntegration(card.id); }}><Button type="submit" size="sm">Test connection</Button></form> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
