import { requireReady } from "@/lib/auth/session";
import { WORKFLOW_STEP_TYPES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/feedback";
import { defaultWorkflow, runWorkflow, saveWorkflow } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export default async function WorkflowsPage() {
  const session = await requireReady();
  const [{ data: workflows }, { data: executions }, { data: leads }] = await Promise.all([
    session.supabase.from("automation_workflows").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }),
    session.supabase.from("automation_executions").select("*").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(20),
    session.supabase.from("leads").select("id, company:companies(name)").eq("workspace_id", session.workspaceId).limit(100),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Automation Workflows" description="Steps can be turned off. Email is not sent unless the send step is enabled and the campaign allows automation." />
      <form action={async () => { "use server"; await defaultWorkflow(); }}><Button type="submit">Create lead-to-outreach workflow</Button></form>
      {(workflows ?? []).map((workflow) => (
        <article key={workflow.id} className="rounded-lg border bg-white p-5">
          <h2 className="font-medium">{workflow.name}</h2>
          <p className="text-sm text-muted-foreground">{workflow.trigger} · {workflow.enabled ? "enabled" : "disabled"}</p>
          <ol className="mt-3 space-y-2 text-sm">{(workflow.steps ?? []).map((step: { id: string; type: string; enabled: boolean }, index: number) => <li key={step.id}>{index + 1}. {WORKFLOW_STEP_TYPES.find((item) => item.id === step.type)?.label || step.type} · {step.enabled ? "on" : "off"}</li>)}</ol>
          <form className="mt-4 flex flex-wrap gap-2" action={async (formData) => { "use server"; await runWorkflow(workflow.id, String(formData.get("leadId"))); }}>
            <Select name="leadId">{(leads ?? []).map((lead) => <option key={lead.id} value={lead.id}>{(Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name}</option>)}</Select>
            <Button type="submit" variant="secondary">Run for lead</Button>
          </form>
          <form className="mt-3" action={async () => { "use server"; await saveWorkflow({ id: workflow.id, name: workflow.name, trigger: workflow.trigger, enabled: !workflow.enabled, steps: workflow.steps }); }}><Button type="submit" size="sm">{workflow.enabled ? "Disable" : "Enable"}</Button></form>
        </article>
      ))}
      <form action={async (formData) => { "use server"; await saveWorkflow({ name: String(formData.get("name")), trigger: "lead.discovered", enabled: false, steps: WORKFLOW_STEP_TYPES.map((step) => ({ id: step.id, type: step.id, enabled: formData.get(step.id) === "on" })) }); }} className="space-y-3 rounded-lg border bg-white p-5">
        <h2 className="font-medium">New workflow</h2>
        <Input name="name" placeholder="Name" required />
        {WORKFLOW_STEP_TYPES.map((step) => <label key={step.id} className="flex gap-2 text-sm"><input name={step.id} type="checkbox" defaultChecked />{step.label}<span className="text-muted-foreground">{step.description}</span></label>)}
        <Button type="submit">Save workflow</Button>
      </form>
      <section><h2 className="font-medium">Execution log</h2>{(executions ?? []).map((execution) => <pre key={execution.id} className="mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">{execution.status} · attempts {execution.attempts}{"\n"}{JSON.stringify(execution.logs, null, 2)}</pre>)}</section>
    </div>
  );
}
