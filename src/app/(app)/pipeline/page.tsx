import { requireReady } from "@/lib/auth/session";
import { PipelineBoard } from "@/components/pipeline-board";
import { PageHeader } from "@/components/ui/feedback";
import { addTask } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default async function PipelinePage() {
  const session = await requireReady();
  const { data, error } = await session.supabase.from("leads").select("id, stage, deal_value, probability, company:companies(name)").eq("workspace_id", session.workspaceId);
  const leads = (data ?? []).map((lead) => ({ id: lead.id, stage: lead.stage, value: Number(lead.deal_value || 0), probability: lead.probability, company: (Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name || "Company" }));
  return (
    <div className="space-y-6">
      <PageHeader title="Sales Pipeline" description="Drag a card to change its stage. The change is saved immediately." />
      {error ? <p className="text-sm text-red-600">{error.message}</p> : <PipelineBoard leads={leads} />}
      <form action={async (formData) => { "use server"; await addTask({ title: String(formData.get("title") || ""), dueAt: String(formData.get("due") || "") }); }} className="flex flex-wrap gap-2 rounded-lg border bg-white p-4">
        <Input name="title" placeholder="New task" className="max-w-sm" />
        <Input name="due" type="datetime-local" className="max-w-xs" aria-label="Due" />
        <Button type="submit" variant="secondary">Add task</Button>
      </form>
    </div>
  );
}
