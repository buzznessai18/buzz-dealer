import { requireReady } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/feedback";
import { saveCalendarItem, saveContent, setContentStatus } from "@/server/actions";
import { CONTENT_TYPES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export default async function MarketingPage() {
  const session = await requireReady();
  const [{ data: content }, { data: products }] = await Promise.all([
    session.supabase.from("marketing_content").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }),
    session.supabase.from("products").select("id, name").eq("workspace_id", session.workspaceId),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="AI Marketing Studio" description="Drafts stay in GrowthPilot. Marking an item published does not post it to LinkedIn, Instagram, or Facebook." />
      <form action={async (formData) => { "use server"; await saveContent({ contentType: String(formData.get("type")), audience: String(formData.get("audience") || ""), country: String(formData.get("country") || ""), industry: String(formData.get("industry") || ""), objective: String(formData.get("objective") || ""), productId: String(formData.get("productId") || "") }); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-2">
        <Select name="type">{CONTENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</Select>
        <Select name="productId"><option value="">Company brand</option>{(products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select>
        <Input name="audience" placeholder="Audience" />
        <Input name="country" placeholder="Country" />
        <Input name="industry" placeholder="Industry" />
        <Input name="objective" placeholder="Objective" />
        <Button type="submit">Generate draft</Button>
      </form>
      <div className="space-y-3">{(content ?? []).map((item) => <article key={item.id} className="rounded-lg border bg-white p-4"><h2 className="font-medium">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p><p className="mt-2 text-xs text-muted-foreground">{item.content_type} · {item.status} · {item.generator}</p><div className="mt-3 flex gap-2"><form action={async () => { "use server"; await setContentStatus(item.id, "approved"); }}><Button size="sm" variant="secondary">Approve</Button></form><form action={async () => { "use server"; await setContentStatus(item.id, "published"); }}><Button size="sm">Mark published internally</Button></form></div></article>)}</div>
    </div>
  );
}

export async function CalendarPageContent() {
  const session = await requireReady();
  const { data } = await session.supabase.from("content_calendar").select("*").eq("workspace_id", session.workspaceId).order("scheduled_for");
  return (
    <div className="space-y-6">
      <PageHeader title="Content Calendar" description="Plan drafts. External social publishing remains unavailable until an approved integration exists." />
      <form action={async (formData) => { "use server"; await saveCalendarItem(formData); }} className="grid gap-3 rounded-lg border bg-white p-5 md:grid-cols-4">
        <Input name="title" placeholder="Title" required />
        <Input name="date" type="date" required aria-label="Date" />
        <Select name="channel"><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="blog">Blog</option><option value="email">Email</option></Select>
        <Button type="submit">Add</Button>
      </form>
      <div className="space-y-2">{(data ?? []).map((item) => <p key={item.id} className="rounded-lg border bg-white p-4 text-sm">{item.scheduled_for} · {item.channel} · {item.title} · {item.status}</p>)}</div>
    </div>
  );
}
