import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSession } from "@/lib/auth/session";
import { runExecution } from "@/lib/workflows/engine";
import { buildOutreach } from "@/lib/outreach";
import { addDays } from "@/lib/dates";

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, { status: 500 });
  const { data: executions } = await admin.from("automation_executions").select("id, workspace_id").in("status", ["pending", "failed", "waiting"]).lt("attempts", 3).limit(10);
  const results: string[] = [];
  for (const execution of executions ?? []) {
    const session = await sessionForJob(admin, execution.workspace_id);
    if (!session) continue;
    await runExecution(session, execution.id);
    results.push(execution.id);
  }
  const drafts = await createDueSequenceDrafts(admin);
  return Response.json({ ok: true, executions: results.length, drafts });
}

async function sessionForJob(admin: NonNullable<ReturnType<typeof createAdminClient>>, workspaceId: string): Promise<AppSession | null> {
  const [{ data: member }, { data: company }, { data: settings }, { data: workspace }] = await Promise.all([
    admin.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId).eq("role", "owner").maybeSingle(),
    admin.from("company_profiles").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("company_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("workspaces").select("name, slug, is_demo").eq("id", workspaceId).maybeSingle(),
  ]);
  if (!member || !company || !settings || !workspace) return null;
  return {
    supabase: admin,
    admin,
    userId: member.user_id,
    email: null,
    fullName: "Scheduled job",
    workspaceId,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    isDemo: workspace.is_demo,
    role: "owner",
    workspaces: [],
    company,
    settings,
  };
}

async function createDueSequenceDrafts(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const { data: enrollments } = await admin.from("sequence_enrollments").select("*").eq("status", "active").lte("next_run_at", new Date().toISOString()).limit(20);
  let created = 0;
  for (const enrollment of enrollments ?? []) {
    const { data: steps } = await admin.from("sequence_steps").select("*").eq("sequence_id", enrollment.sequence_id).eq("enabled", true).order("position");
    const next = (steps ?? []).find((step) => step.position > enrollment.current_step);
    if (!next) {
      await admin.from("sequence_enrollments").update({ status: "completed" }).eq("id", enrollment.id);
      continue;
    }
    const { data: existing } = await admin.from("email_drafts").select("id").eq("sequence_step_id", next.id).eq("lead_id", enrollment.lead_id).neq("status", "discarded").maybeSingle();
    if (existing) {
      await admin.from("sequence_enrollments").update({ status: "waiting", waiting_draft_id: existing.id }).eq("id", enrollment.id);
      continue;
    }
    const { data: lead } = await admin.from("leads").select("primary_contact_id, company:companies(name)").eq("id", enrollment.lead_id).maybeSingle();
    const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
    const email = buildOutreach({ companyName: company?.name || "the company", ourCompany: "GrowthPilot workspace", purpose: next.position === 1 ? "cold" : "follow_up", tone: "professional", verifiedFacts: [] });
    const { error } = await admin.from("email_drafts").insert({
      workspace_id: enrollment.workspace_id,
      lead_id: enrollment.lead_id,
      contact_id: enrollment.contact_id || lead?.primary_contact_id || null,
      sequence_enrollment_id: enrollment.id,
      sequence_step_id: next.id,
      subject: next.subject || email.subject,
      body: next.body || email.body,
      purpose: "follow_up",
      generator: "template",
      status: "draft",
    });
    if (!error) {
      created += 1;
      await admin.from("sequence_enrollments").update({ status: "waiting", current_step: next.position, next_run_at: addDays(new Date(), next.delay_days).toISOString() }).eq("id", enrollment.id);
    }
  }
  return created;
}
