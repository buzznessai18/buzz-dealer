import type { AppSession } from "@/lib/auth/session";
import { buildOutreach } from "@/lib/outreach";
import { deliverDraft } from "@/lib/records/delivery";
import { researchLeadRecord } from "@/lib/records/research";
import { scoreLead } from "@/lib/scoring";
import { loadOfferings } from "@/lib/records/persist";
import { matchOfferings } from "@/lib/matching";

type Step = { id: string; type: string; enabled?: boolean };
type Log = { id: string; type: string; status: string; message: string; at: string };

export async function runExecution(session: AppSession, executionId: string) {
  const { data: execution, error } = await session.supabase.from("automation_executions").select("*, workflow:automation_workflows(*)").eq("id", executionId).eq("workspace_id", session.workspaceId).single();
  if (error || !execution) throw new Error(error?.message || "Execution not found.");
  if (["succeeded", "cancelled"].includes(execution.status)) return execution;
  const workflow = Array.isArray(execution.workflow) ? execution.workflow[0] : execution.workflow;
  const steps = (workflow.steps ?? []) as Step[];
  const logs = (execution.logs ?? []) as Log[];
  await session.supabase.from("automation_executions").update({ status: "running", attempts: execution.attempts + 1, last_error: null }).eq("id", executionId);

  for (const step of steps) {
    if (logs.some((log) => log.id === step.id && log.status === "succeeded")) continue;
    if (step.enabled === false) {
      logs.push(entry(step, "skipped", "Step is disabled."));
      continue;
    }
    try {
      const result = await runStep(session, step, execution.lead_id);
      logs.push(entry(step, result.status, result.message));
      if (result.status === "waiting") {
        await session.supabase.from("automation_executions").update({ status: "waiting", logs, current_step: steps.indexOf(step) }).eq("id", executionId);
        return;
      }
      if (result.status === "failed") {
        await session.supabase.from("automation_executions").update({ status: "failed", logs, last_error: result.message }).eq("id", executionId);
        return;
      }
    } catch (stepError) {
      const message = stepError instanceof Error ? stepError.message : "Step failed.";
      logs.push(entry(step, "failed", message));
      await session.supabase.from("automation_executions").update({ status: "failed", logs, last_error: message }).eq("id", executionId);
      return;
    }
  }
  await session.supabase.from("automation_executions").update({ status: "succeeded", logs }).eq("id", executionId);
}

async function runStep(session: AppSession, step: Step, leadId: string | null): Promise<{ status: "succeeded" | "failed" | "waiting" | "skipped"; message: string }> {
  if (!leadId && step.type !== "notify_member") return { status: "failed", message: "This step needs a lead." };
  if (step.type === "research_company" && leadId) {
    const result = await researchLeadRecord(session, leadId);
    return { status: "succeeded", message: result.generator === "ai" ? "Research profile saved with AI." : "Fact-only research saved." };
  }
  if (step.type === "score_lead" && leadId) {
    const { data: lead } = await session.supabase.from("leads").select("*, company:companies(*), contact:contacts(email, full_name)").eq("id", leadId).single();
    const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
    const contact = Array.isArray(lead?.contact) ? lead.contact[0] : lead?.contact;
    const offerings = await loadOfferings(session.supabase, session.workspaceId);
    const match = matchOfferings({ name: company?.name || "", industry: company?.industry, description: company?.description, country: company?.country }, offerings);
    const score = scoreLead({
      industry: company?.industry,
      targetIndustries: session.company.target_industries,
      country: company?.country,
      targetCountries: session.company.target_countries,
      description: company?.description,
      hasEmail: Boolean(contact?.email),
      hasName: Boolean(contact?.full_name),
      matchScore: match.matched ? match.score : 0,
      stage: lead?.stage,
    });
    await session.supabase.from("lead_scores").insert({ workspace_id: session.workspaceId, lead_id: leadId, score: score.score, breakdown: score.breakdown, explanation: score.explanation });
    return { status: "succeeded", message: `Score saved: ${score.score}/100.` };
  }
  if (step.type === "match_products" && leadId) {
    const { data: lead } = await session.supabase.from("leads").select("company:companies(name, industry, description, country)").eq("id", leadId).single();
    const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
    const match = matchOfferings(company || { name: "Company" }, await loadOfferings(session.supabase, session.workspaceId));
    await session.supabase.from("leads").update({ custom_fields: { product_match: match }, summary: match.reason }).eq("id", leadId);
    return { status: "succeeded", message: match.matched ? `Matched ${match.offering?.name}.` : "No catalog match. Custom development was recommended." };
  }
  if (step.type === "generate_outreach_draft" && leadId) {
    const draft = await createTemplateDraft(session, leadId, null);
    return { status: "succeeded", message: `Draft saved: ${draft.subject}` };
  }
  if (step.type === "notify_member") {
    const { data: lead } = leadId ? await session.supabase.from("leads").select("owner_id, company:companies(name)").eq("id", leadId).maybeSingle() : { data: null };
    const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
    await session.supabase.from("notifications").insert({
      workspace_id: session.workspaceId,
      user_id: lead?.owner_id || session.userId,
      title: "Workflow needs attention",
      body: company?.name ? `${company.name} reached a notification step.` : "A workflow reached a notification step.",
      href: leadId ? `/leads/${leadId}` : "/workflows",
    });
    return { status: "succeeded", message: "Notification created." };
  }
  if (step.type === "wait_for_approval" && leadId) {
    const { data: draft } = await session.supabase.from("email_drafts").select("id, status").eq("lead_id", leadId).neq("status", "discarded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!draft || !["approved", "scheduled", "sent"].includes(draft.status)) return { status: "waiting", message: "Waiting for a person to approve the latest draft." };
    return { status: "succeeded", message: "Draft is approved." };
  }
  if (step.type === "send_approved_email" && leadId) {
    const { data: draft } = await session.supabase.from("email_drafts").select("id, status, campaign_id").eq("lead_id", leadId).in("status", ["approved", "scheduled"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!draft) return { status: "waiting", message: "No approved draft is ready to send." };
    const { data: campaign } = draft.campaign_id ? await session.supabase.from("campaigns").select("allow_automated_send").eq("id", draft.campaign_id).maybeSingle() : { data: null };
    if (!campaign?.allow_automated_send) return { status: "waiting", message: "Automated sending is off. Approve the campaign for automation or send the draft manually." };
    const result = await deliverDraft(session, draft.id, true);
    return result.ok ? { status: "succeeded", message: "Approved email sent." } : { status: "waiting", message: result.error };
  }
  if (step.type === "monitor_response" && leadId) {
    const { count } = await session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("direction", "inbound");
    return { status: "succeeded", message: `${count ?? 0} stored repl${count === 1 ? "y" : "ies"}. Open tracking is not recorded.` };
  }
  if (step.type === "update_crm_status" && leadId) {
    const { count } = await session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("direction", "outbound").eq("status", "sent");
    if (!count) return { status: "skipped", message: "CRM stage was not changed because no email has been sent." };
    await session.supabase.from("leads").update({ stage: "contacted" }).eq("id", leadId).in("stage", ["new", "discovered", "researched", "qualified"]);
    return { status: "succeeded", message: "Lead is Contacted because an email was sent." };
  }
  return { status: "failed", message: `Unknown step ${step.type}.` };
}

async function createTemplateDraft(session: AppSession, leadId: string, campaignId: string | null) {
  const { data: lead } = await session.supabase.from("leads").select("*, company:companies(*), contact:contacts(*)").eq("id", leadId).single();
  const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
  const contact = Array.isArray(lead?.contact) ? lead.contact[0] : lead?.contact;
  const match = lead?.custom_fields?.product_match;
  const email = buildOutreach({
    companyName: company?.name || "the company",
    contactName: contact?.full_name,
    contactRole: contact?.designation,
    ourCompany: session.company.company_name || session.workspaceName,
    ourWebsite: session.company.website,
    signature: session.company.email_signature,
    mailingAddress: session.company.mailing_address,
    offeringName: match?.offering?.name,
    demoUrl: match?.demoUrl,
    verifiedFacts: company?.description ? [company.description] : [],
    angle: match?.pitch,
    purpose: "cold",
    tone: "professional",
  });
  const { data, error } = await session.supabase.from("email_drafts").insert({
    workspace_id: session.workspaceId,
    lead_id: leadId,
    contact_id: contact?.id ?? lead?.primary_contact_id ?? null,
    campaign_id: campaignId,
    subject: email.subject,
    body: email.body,
    purpose: "cold",
    tone: "professional",
    generator: "template",
    personalization: { facts: company?.description ? [company.description] : [] },
  }).select("id, subject").single();
  if (error) throw new Error(error.message);
  return data;
}

function entry(step: Step, status: string, message: string): Log {
  return { id: step.id, type: step.type, status, message, at: new Date().toISOString() };
}

export { createTemplateDraft };
