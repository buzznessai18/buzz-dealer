"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { z } from "zod";
import { getSessionState, requireReady, requireWriter, setWorkspaceCookie } from "@/lib/auth/session";
import { SUGGESTED_SERVICES } from "@/lib/constants";
import { normalizeDomain } from "@/lib/domain";
import { discoverCompanies, type DiscoveryQuery } from "@/lib/discovery/search";
import { resolveProvider, saveProviderSecret, publicError } from "@/lib/integrations/credentials";
import { executionKey, buildOutreach, buildMarketingDraft, buildProposal, DEFAULT_WORKFLOW_STEPS } from "@/lib/outreach";
import { loadOfferings, persistDiscovered } from "@/lib/records/persist";
import { deliverDraft, recordReply } from "@/lib/records/delivery";
import { researchLeadRecord } from "@/lib/records/research";
import { categorizeReply } from "@/lib/compliance";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify, linesToList } from "@/lib/utils";
import { runExecution } from "@/lib/workflows/engine";
import { PIPELINE_STAGES } from "@/lib/constants";
import { refreshGmailToken } from "@/lib/email/transport";
import { appUrl, isSupabaseConfigured } from "@/lib/env";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

function fail(error: unknown): ActionResult {
  return { ok: false, error: publicError(error) };
}

export async function signIn(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const parsed = z.object({ email: z.email(), password: z.string().min(8) }).safeParse({ email, password });
  if (!parsed.success) redirect("/login?error=Enter%20a%20valid%20email%20and%20password.");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/overview");
}

export async function signUp(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const parsed = z.object({
    fullName: z.string().min(2),
    company: z.string().min(2),
    email: z.email(),
    password: z.string().min(8),
  }).safeParse({
    fullName: formData.get("fullName"),
    company: formData.get("company"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/signup?error=Check%20your%20name%2C%20company%2C%20email%2C%20and%20password.");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName, company_name: parsed.data.company }, emailRedirectTo: `${appUrl()}/auth/callback` },
  });
  if (error) redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect("/login?error=Account%20created.%20Confirm%20the%20email%20if%20required%2C%20then%20sign%20in.");
  redirect("/onboarding");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createWorkspace(formData: FormData) {
  const state = await getSessionState();
  if (state.status !== "needs-workspace" && state.status !== "ready") redirect("/login");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) redirect("/onboarding?error=Enter%20a%20workspace%20name.");
  const supabase = state.status === "ready" ? state.session.supabase : state.supabase;
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase.rpc("create_workspace", { p_name: name, p_slug: slug });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  await setWorkspaceCookie(String(data));
  redirect("/onboarding");
}

export async function switchWorkspace(formData: FormData) {
  const session = await requireReady();
  const id = String(formData.get("workspaceId") || "");
  if (!session.workspaces.some((workspace) => workspace.id === id)) redirect("/overview");
  await setWorkspaceCookie(id);
  redirect("/overview");
}

const onboardingSchema = z.object({
  companyName: z.string().min(2),
  website: z.string().optional(),
  description: z.string().min(10),
  location: z.string().min(2),
  email: z.email(),
  mailingAddress: z.string().min(5),
  services: z.array(z.string()).min(1),
  countries: z.array(z.string()).min(1),
  industries: z.array(z.string()).min(1),
  customerProfile: z.string().min(10),
  signature: z.string().min(5),
  aiProvider: z.enum(["openai", "anthropic", "gemini"]),
  aiModel: z.string().min(2),
  seedServices: z.boolean(),
});

export async function completeOnboarding(input: z.infer<typeof onboardingSchema>): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Complete every onboarding field before continuing." };
  const state = await getSessionState();
  if (state.status !== "ready") return { ok: false, error: "Create a workspace before finishing onboarding." };
  const session = state.session;
  const { error } = await session.supabase.from("company_profiles").update({
    company_name: parsed.data.companyName,
    website: parsed.data.website || null,
    description: parsed.data.description,
    location: parsed.data.location,
    email: parsed.data.email,
    mailing_address: parsed.data.mailingAddress,
    services: parsed.data.services,
    target_countries: parsed.data.countries,
    target_industries: parsed.data.industries,
    ideal_customer_profile: { summary: parsed.data.customerProfile },
    email_signature: parsed.data.signature,
    ai_provider: parsed.data.aiProvider,
    ai_model: parsed.data.aiModel,
    onboarding_completed: true,
  }).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  if (parsed.data.seedServices) {
    await session.supabase.from("service_catalog").insert(SUGGESTED_SERVICES.filter((item) => parsed.data.services.includes(item[0])).map((item) => ({
      workspace_id: session.workspaceId,
      name: item[0],
      description: item[1],
      category: item[2],
      problem_solved: item[1],
      target_audience: parsed.data.customerProfile,
    })));
  }
  await session.supabase.from("email_templates").insert([
    ["Cold introduction", "cold", "Hello {{contact_name}},", "Hello {{contact_name}},\n\n{{our_company}} helps teams with {{offering}}.\n\n{{fact}}\n\nWould a short conversation be useful?\n\n{{signature}}"],
    ["Follow-up", "follow_up", "Following up — {{company_name}}", "Hello {{contact_name}},\n\nI am following up with {{company_name}}. I can share a relevant example if this is the right area.\n\n{{signature}}"],
    ["Partnership", "partnership", "Partnership idea for {{company_name}}", "Hello {{contact_name}},\n\n{{our_company}} collaborates with teams that deliver software and AI work.\n\n{{signature}}"],
  ].map(([name, category, subject, body]) => ({ workspace_id: session.workspaceId, name, category, subject, body })));
  revalidatePath("/overview");
  redirect("/overview");
}

const catalogSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["product", "service"]),
  name: z.string().min(2),
  description: z.string().min(10),
  category: z.string().min(2),
  industry: z.string().optional(),
  targetAudience: z.string().optional(),
  problemSolved: z.string().min(5),
  features: z.string().optional(),
  benefits: z.string().optional(),
  techStack: z.string().optional(),
  price: z.string().optional(),
  currency: z.string().optional(),
  priceNotes: z.string().optional(),
  demoUrls: z.string().optional(),
  websiteUrl: z.string().optional(),
  portfolioUrls: z.string().optional(),
});

export async function saveOffering(input: z.infer<typeof catalogSchema>): Promise<ActionResult> {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name, description, category, and problem solved are required." };
  const session = await requireWriter();
  const table = parsed.data.kind === "product" ? "products" : "service_catalog";
  const payload = {
    workspace_id: session.workspaceId,
    name: parsed.data.name,
    description: parsed.data.description,
    category: parsed.data.category,
    industry: parsed.data.industry || "",
    target_audience: parsed.data.targetAudience || "",
    problem_solved: parsed.data.problemSolved,
    features: linesToList(parsed.data.features || ""),
    benefits: linesToList(parsed.data.benefits || ""),
    tech_stack: linesToList(parsed.data.techStack || ""),
    pricing: { amount: parsed.data.price ? Number(parsed.data.price) : null, currency: parsed.data.currency || session.settings.currency, notes: parsed.data.priceNotes || "" },
    demo_urls: linesToList(parsed.data.demoUrls || ""),
    website_url: parsed.data.websiteUrl || null,
    portfolio_urls: linesToList(parsed.data.portfolioUrls || ""),
    status: "active",
  };
  const query = parsed.data.id
    ? session.supabase.from(table).update(payload).eq("id", parsed.data.id).eq("workspace_id", session.workspaceId)
    : session.supabase.from(table).insert(payload);
  const { error } = await query;
  if (error) return fail(error);
  revalidatePath("/products");
  return { ok: true, message: parsed.data.id ? "Catalog item updated." : "Catalog item saved." };
}

export async function setOfferingStatus(kind: "product" | "service", id: string, status: "active" | "archived"): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from(kind === "product" ? "products" : "service_catalog").update({ status }).eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  revalidatePath("/products");
  return { ok: true, message: status === "archived" ? "Archived." : "Restored." };
}

export async function deleteOffering(kind: "product" | "service", id: string): Promise<ActionResult> {
  const session = await requireWriter();
  if (!["owner", "admin"].includes(session.role)) return { ok: false, error: "Only an owner or admin can delete catalog items." };
  const { error } = await session.supabase.from(kind === "product" ? "products" : "service_catalog").delete().eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  revalidatePath("/products");
  return { ok: true, message: "Deleted." };
}

export async function runDiscovery(input: DiscoveryQuery): Promise<ActionResult & { notices?: string[]; created?: number; updated?: number }> {
  try {
    const session = await requireWriter();
    const { data: allowed, error: rateError } = await session.supabase.rpc("bump_rate_limit", {
      p_ws: session.workspaceId, p_bucket: "discovery", p_limit: 20, p_window_seconds: 3600,
    });
    if (rateError) return { ok: false, error: rateError.message };
    if (!allowed) return { ok: false, error: "Discovery limit reached for this hour." };
    const [search, maps, apollo, hunter] = await Promise.all([
      resolveProvider(session.admin, session.workspaceId, "google_search"),
      resolveProvider(session.admin, session.workspaceId, "google_maps"),
      resolveProvider(session.admin, session.workspaceId, "apollo"),
      resolveProvider(session.admin, session.workspaceId, "hunter"),
    ]);
    const result = await discoverCompanies({ ...input, limit: Math.min(input.limit || 20, 50) }, {
      search: search.values, maps: maps.values, apollo: apollo.values, hunter: hunter.values,
    });
    const saved = await persistDiscovered({
      supabase: session.supabase,
      workspaceId: session.workspaceId,
      userId: session.userId,
      companies: result.companies,
      offerings: await loadOfferings(session.supabase, session.workspaceId),
      targetIndustries: session.company.target_industries,
      targetCountries: session.company.target_countries,
      opportunityType: input.opportunityTypes?.[0],
    });
    if (input.mode === "opportunity") {
      for (const company of result.companies) {
        const domain = normalizeDomain(company.domain || company.website);
        const { data: row } = domain
          ? await session.supabase.from("companies").select("id, name, description").eq("workspace_id", session.workspaceId).eq("domain", domain).maybeSingle()
          : { data: null };
        if (!row) continue;
        for (const type of input.opportunityTypes ?? []) {
          await session.supabase.from("lead_opportunities").insert({
            workspace_id: session.workspaceId,
            company_id: row.id,
            title: `${type.replaceAll("_", " ")} hypothesis for ${row.name}`,
            opportunity_type: type,
            business_context: row.description || "No public description is stored.",
            potential_problem: "Hypothesis only: the selected opportunity type may be relevant. This is not a verified requirement.",
            recommended_solution: `Discuss a custom ${type.replaceAll("_", " ")} engagement after confirming the need.`,
            proposed_stack: suggestedStack(type),
            complexity: ["saas", "erp", "ai_app"].includes(type) ? "high" : "medium",
            proposal_structure: ["Confirm the current process", "Agree the problem", "Write a bounded first release", "Estimate only after discovery"],
            next_step: "Ask whether this area is an active priority before preparing a commercial proposal.",
            is_hypothesis: true,
            verified: false,
            sources: company.sourceUrl ? [{ url: company.sourceUrl }] : [],
          });
        }
      }
    }
    await enqueueDiscovered(session.supabase, session.workspaceId, session.userId, saved.createdLeadIds);
    revalidatePath("/leads");
    revalidatePath("/overview");
    return { ok: true, message: `Saved ${saved.created} new and ${saved.updated} existing companies.`, notices: [...result.notices, ...saved.errors], created: saved.created, updated: saved.updated };
  } catch (error) {
    return fail(error);
  }
}

export async function importCsv(csv: string): Promise<ActionResult & { notices?: string[]; created?: number; updated?: number }> {
  try {
    const session = await requireWriter();
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) return { ok: false, error: parsed.errors[0]?.message || "The CSV could not be parsed." };
    const companies = parsed.data.map((row) => {
      const value = (names: string[]) => {
        const key = Object.keys(row).find((item) => names.includes(item.toLowerCase().trim()));
        return key ? row[key]?.trim() : "";
      };
      const website = value(["website", "url", "domain"]);
      return {
        name: value(["company", "company_name", "name", "organization"]),
        website,
        domain: normalizeDomain(website),
        industry: value(["industry"]),
        country: value(["country"]),
        city: value(["city"]),
        location: value(["location", "address"]),
        description: value(["description", "about"]),
        companySize: value(["company_size", "size", "employees"]),
        linkedinUrl: value(["linkedin", "linkedin_url"]),
        source: "csv",
        contact: {
          name: value(["contact_name", "contact", "full_name"]),
          title: value(["designation", "title", "job_title"]),
          email: value(["email", "business_email"]),
        },
      };
    }).filter((company) => company.name);
    if (!companies.length) return { ok: false, error: "The CSV needs a company name column." };
    const saved = await persistDiscovered({
      supabase: session.supabase,
      workspaceId: session.workspaceId,
      userId: session.userId,
      companies,
      offerings: await loadOfferings(session.supabase, session.workspaceId),
      targetIndustries: session.company.target_industries,
      targetCountries: session.company.target_countries,
    });
    await enqueueDiscovered(session.supabase, session.workspaceId, session.userId, saved.createdLeadIds);
    revalidatePath("/leads");
    return { ok: true, message: `Imported ${saved.created} new and ${saved.updated} existing companies.`, notices: saved.errors, created: saved.created, updated: saved.updated };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLead(input: { id: string; stage?: string; dealValue?: number; probability?: number; nextFollowUp?: string; tags?: string; summary?: string; lostReason?: string }): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const stage = input.stage && PIPELINE_STAGES.some((item) => item.id === input.stage) ? input.stage : undefined;
    const { error } = await session.supabase.from("leads").update({
      stage,
      deal_value: input.dealValue,
      probability: input.probability,
      next_follow_up: input.nextFollowUp || null,
      tags: input.tags ? linesToList(input.tags) : undefined,
      summary: input.summary,
      lost_reason: input.lostReason,
    }).eq("id", input.id).eq("workspace_id", session.workspaceId);
    if (error) return fail(error);
    if (stage) {
      await session.supabase.from("lead_activities").insert({
        workspace_id: session.workspaceId, lead_id: input.id, actor_id: session.userId,
        activity_type: "stage_changed", summary: `Stage set to ${stage.replaceAll("_", " ")}.`, metadata: { to: stage },
      });
      if (stage === "won" || stage === "lost") {
        const deal = {
          workspace_id: session.workspaceId,
          lead_id: input.id,
          name: input.summary || "Deal",
          value: input.dealValue ?? 0,
          currency: session.settings.currency,
          probability: stage === "won" ? 100 : 0,
          stage,
          won_at: stage === "won" ? new Date().toISOString() : null,
          lost_at: stage === "lost" ? new Date().toISOString() : null,
          lost_reason: input.lostReason,
        };
        const { data: existingDeal } = await session.supabase.from("deals").select("id").eq("lead_id", input.id).maybeSingle();
        if (existingDeal?.id) await session.supabase.from("deals").update(deal).eq("id", existingDeal.id);
        else await session.supabase.from("deals").insert(deal);
      }
    }
    revalidatePath("/pipeline");
    revalidatePath(`/leads/${input.id}`);
    return { ok: true, message: "Lead updated." };
  } catch (error) {
    return fail(error);
  }
}

export async function addNote(leadId: string, note: string): Promise<ActionResult> {
  const session = await requireWriter();
  if (note.trim().length < 2) return { ok: false, error: "Write a note first." };
  const { error } = await session.supabase.from("lead_activities").insert({
    workspace_id: session.workspaceId, lead_id: leadId, actor_id: session.userId, activity_type: "note", summary: note.trim(),
  });
  if (error) return fail(error);
  revalidatePath(`/leads/${leadId}`);
  return { ok: true };
}

export async function addTask(input: { leadId?: string; title: string; dueAt?: string; notes?: string }): Promise<ActionResult> {
  const session = await requireWriter();
  if (input.title.trim().length < 2) return { ok: false, error: "Enter a task title." };
  const { error } = await session.supabase.from("tasks").insert({
    workspace_id: session.workspaceId, lead_id: input.leadId || null, assignee_id: session.userId,
    title: input.title.trim(), notes: input.notes || null, due_at: input.dueAt || null,
  });
  if (error) return fail(error);
  revalidatePath("/pipeline");
  return { ok: true, message: "Task added." };
}

export async function completeTask(id: string): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("tasks").update({ status: "done" }).eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function setLawfulBasis(input: { leadId: string; basis: string; note: string; eligible: boolean }): Promise<ActionResult> {
  const session = await requireWriter();
  if (input.eligible && input.note.trim().length < 8) return { ok: false, error: "Record why this recipient can lawfully be contacted." };
  const { error } = await session.supabase.from("leads").update({
    lawful_basis: input.basis || null,
    lawful_basis_note: input.note,
    lawful_basis_verified_at: input.eligible ? new Date().toISOString() : null,
    outreach_eligible: input.eligible,
  }).eq("id", input.leadId).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  await session.supabase.from("audit_logs").insert({
    workspace_id: session.workspaceId, actor_id: session.userId, action: "lead.eligibility", entity_type: "lead", entity_id: input.leadId,
    metadata: { eligible: input.eligible, basis: input.basis },
  });
  revalidatePath(`/leads/${input.leadId}`);
  return { ok: true, message: input.eligible ? "Eligibility saved." : "Lead marked ineligible for outreach." };
}

export async function researchLead(leadId: string): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const result = await researchLeadRecord(session, leadId);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/research");
    return { ok: true, message: result.generator === "ai" ? "AI research saved." : `Fact-only research saved. ${result.overview}` };
  } catch (error) {
    return fail(error);
  }
}

export async function convertOpportunity(id: string): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const { data: opportunity, error } = await session.supabase.from("lead_opportunities").select("*").eq("id", id).eq("workspace_id", session.workspaceId).single();
    if (error || !opportunity) return { ok: false, error: "Opportunity not found." };
    let leadId = opportunity.lead_id as string | null;
    if (!leadId && opportunity.company_id) {
      const { data: lead, error: leadError } = await session.supabase.from("leads").insert({
        workspace_id: session.workspaceId, company_id: opportunity.company_id, owner_id: session.userId,
        stage: "discovered", source: "opportunity", title: opportunity.title, summary: opportunity.potential_problem,
      }).select("id").single();
      if (leadError) return fail(leadError);
      leadId = lead.id;
    }
    await session.supabase.from("lead_opportunities").update({ status: "converted", lead_id: leadId }).eq("id", id);
    revalidatePath("/research");
    return { ok: true, id: leadId ?? undefined, message: "Opportunity converted to a lead." };
  } catch (error) {
    return fail(error);
  }
}

export async function createCampaign(formData: FormData): Promise<ActionResult> {
  const session = await requireWriter();
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { ok: false, error: "Name the campaign." };
  const { data, error } = await session.supabase.from("campaigns").insert({
    workspace_id: session.workspaceId,
    name,
    description: String(formData.get("description") || ""),
    channel: formData.get("channel") === "linkedin_draft" ? "linkedin_draft" : "email",
    daily_limit: Number(formData.get("dailyLimit") || 25),
    created_by: session.userId,
  }).select("id").single();
  if (error) return fail(error);
  revalidatePath("/campaigns");
  return { ok: true, id: data.id, message: "Campaign created as a draft." };
}

export async function approveCampaign(id: string, allowAutomated: boolean): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("campaigns").update({
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: session.userId,
    allow_automated_send: allowAutomated,
  }).eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  await session.supabase.from("audit_logs").insert({
    workspace_id: session.workspaceId, actor_id: session.userId, action: "campaign.approved", entity_type: "campaign", entity_id: id,
    metadata: { allow_automated_send: allowAutomated },
  });
  revalidatePath(`/campaigns/${id}`);
  return { ok: true, message: allowAutomated ? "Campaign approved, including automated follow-ups within the limits." : "Campaign approved. Emails still require a manual send." };
}

export async function generateDraft(input: { leadId: string; campaignId?: string; purpose: "cold" | "product" | "custom" | "partnership" | "follow_up" | "linkedin" | "proposal"; tone: string }): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const { data: lead } = await session.supabase.from("leads").select("*, company:companies(*), contact:contacts(*)").eq("id", input.leadId).eq("workspace_id", session.workspaceId).single();
    if (!lead) return { ok: false, error: "Lead not found." };
    const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
    const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
    const { data: research } = await session.supabase.from("lead_research").select("*").eq("lead_id", input.leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const facts = Array.isArray(research?.facts) ? research.facts.map((fact: { statement?: string }) => fact.statement || "").filter(Boolean) : [];
    const template = buildOutreach({
      companyName: company?.name || "the company",
      contactName: contact?.full_name,
      contactRole: contact?.designation,
      ourCompany: session.company.company_name || session.workspaceName,
      ourWebsite: session.company.website,
      signature: session.company.email_signature,
      mailingAddress: session.company.mailing_address,
      offeringName: research?.product_match?.offering?.name,
      demoUrl: research?.product_match?.demoUrl,
      verifiedFacts: facts.slice(0, 3),
      angle: research?.outreach_angle,
      purpose: input.purpose,
      tone: input.tone,
    });
    let subject = template.subject;
    let body = template.body;
    let generator: "template" | "ai" = "template";
    try {
      const { generateText, parseJsonObject } = await import("@/lib/ai/generate");
      const response = await generateText({
        supabase: session.supabase, admin: session.admin, workspaceId: session.workspaceId, userId: session.userId,
        provider: session.company.ai_provider, model: session.company.ai_model, feature: "outreach", json: true,
        monthlyLimit: session.settings.ai_monthly_token_limit,
        system: "Write a JSON object with subject and body. Use only the supplied facts. Do not invent requirements, budgets, or results. Include the unsubscribe instruction and mailing address if provided. Keep the tone requested.",
        prompt: JSON.stringify({ template, facts, tone: input.tone, purpose: input.purpose }),
      });
      const parsed = parseJsonObject(response.text);
      if (typeof parsed.subject === "string" && typeof parsed.body === "string") {
        subject = parsed.subject;
        body = parsed.body;
        generator = "ai";
      }
    } catch {
      generator = "template";
    }
    const { data, error } = await session.supabase.from("email_drafts").insert({
      workspace_id: session.workspaceId, lead_id: input.leadId, contact_id: contact?.id ?? lead.primary_contact_id,
      campaign_id: input.campaignId || null, subject, body, tone: input.tone, purpose: input.purpose, generator,
      personalization: { facts },
    }).select("id").single();
    if (error) return fail(error);
    revalidatePath("/campaigns");
    return { ok: true, id: data.id, message: generator === "ai" ? "AI draft saved. It is not sent." : "Template draft saved because AI was unavailable. It is not sent." };
  } catch (error) {
    return fail(error);
  }
}

export async function updateDraft(id: string, subject: string, body: string, status: "draft" | "approved" | "discarded" | "scheduled", scheduledFor?: string): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("email_drafts").update({
    subject, body, status,
    approved_at: status === "approved" ? new Date().toISOString() : null,
    approved_by: status === "approved" ? session.userId : null,
    scheduled_for: scheduledFor || null,
  }).eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  revalidatePath("/campaigns");
  return { ok: true, message: status === "approved" ? "Draft approved." : "Draft updated." };
}

export async function sendDraft(id: string): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const result = await deliverDraft(session, id, false);
    revalidatePath("/inbox");
    revalidatePath("/campaigns");
    return result.ok ? { ok: true, message: "Email sent." } : result;
  } catch (error) {
    return fail(error);
  }
}

export async function saveTemplate(formData: FormData): Promise<ActionResult> {
  const session = await requireWriter();
  const name = String(formData.get("name") || "");
  const subject = String(formData.get("subject") || "");
  const body = String(formData.get("body") || "");
  if (name.length < 2 || subject.length < 2 || body.length < 10) return { ok: false, error: "Name, subject, and body are required." };
  const { error } = await session.supabase.from("email_templates").insert({
    workspace_id: session.workspaceId, name, subject, body,
    category: String(formData.get("category") || "cold"),
    tone: String(formData.get("tone") || "professional"),
  });
  if (error) return fail(error);
  revalidatePath("/campaigns");
  return { ok: true, message: "Template saved." };
}

export async function saveSequence(input: { name: string; steps: Array<{ delayDays: number; subject: string; body: string }> }): Promise<ActionResult> {
  const session = await requireWriter();
  if (!input.name || input.steps.length === 0) return { ok: false, error: "Add a name and at least one step." };
  const { data, error } = await session.supabase.from("email_sequences").insert({
    workspace_id: session.workspaceId, name: input.name, status: "active",
  }).select("id").single();
  if (error) return fail(error);
  const { error: stepError } = await session.supabase.from("sequence_steps").insert(input.steps.map((step, index) => ({
    workspace_id: session.workspaceId, sequence_id: data.id, position: index + 1, delay_days: step.delayDays, subject: step.subject, body: step.body,
  })));
  if (stepError) return fail(stepError);
  revalidatePath("/campaigns");
  return { ok: true, id: data.id, message: "Sequence saved. Enrollment creates drafts; it does not send them." };
}

export async function enrollLead(sequenceId: string, leadId: string): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("sequence_enrollments").insert({
    workspace_id: session.workspaceId, sequence_id: sequenceId, lead_id: leadId, next_run_at: new Date().toISOString(),
    idempotency_key: `${sequenceId}:${leadId}`,
  });
  if (error) return fail(error);
  return { ok: true, message: "Lead enrolled. The next job run will create the first draft." };
}

export async function logReply(input: { leadId: string; fromEmail: string; subject: string; body: string }): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const category = categorizeReply(`${input.subject}\n${input.body}`);
    await recordReply(session.supabase, {
      workspaceId: session.workspaceId, userId: session.userId, leadId: input.leadId, fromEmail: input.fromEmail,
      subject: input.subject, body: input.body, category: category.category, classifier: "rules",
    });
    revalidatePath("/inbox");
    return { ok: true, message: `Reply saved as ${category.category.replaceAll("_", " ")} using rules.` };
  } catch (error) {
    return fail(error);
  }
}

export async function saveContent(input: { contentType: string; audience?: string; country?: string; industry?: string; objective?: string; productId?: string }): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    let title = "";
    let body = "";
    let generator: "template" | "ai" = "template";
    const offering = input.productId ? (await loadOfferings(session.supabase, session.workspaceId)).find((item) => item.id === input.productId) : null;
    const template = buildMarketingDraft({
      contentType: input.contentType, brand: session.company.company_name || session.workspaceName, offering: offering?.name,
      audience: input.audience, country: input.country, industry: input.industry, voice: session.settings.brand_voice,
      objective: input.objective, language: session.settings.content_language,
    });
    title = template.title;
    body = template.body;
    try {
      const { generateText } = await import("@/lib/ai/generate");
      const response = await generateText({
        supabase: session.supabase, admin: session.admin, workspaceId: session.workspaceId, userId: session.userId,
        provider: session.company.ai_provider, model: session.company.ai_model, feature: "marketing", monthlyLimit: session.settings.ai_monthly_token_limit,
        system: "Write marketing draft text from the supplied company profile only. Do not invent customer results, revenue, or testimonials. Return plain text.",
        prompt: JSON.stringify({ template, company: session.company, offering }),
      });
      body = response.text || body;
      generator = "ai";
    } catch {
      generator = "template";
    }
    const { data, error } = await session.supabase.from("marketing_content").insert({
      workspace_id: session.workspaceId, content_type: input.contentType, title, body, generator, status: "draft",
      metadata: { audience: input.audience, country: input.country, industry: input.industry, objective: input.objective },
    }).select("id").single();
    if (error) return fail(error);
    revalidatePath("/marketing");
    return { ok: true, id: data.id, message: generator === "ai" ? "AI draft saved. Publishing to social networks is not connected." : "Template draft saved. Publishing to social networks is not connected." };
  } catch (error) {
    return fail(error);
  }
}

export async function setContentStatus(id: string, status: "draft" | "approved" | "published"): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("marketing_content").update({
    status, published_at: status === "published" ? new Date().toISOString() : null, external_publish: false,
  }).eq("id", id).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  revalidatePath("/marketing");
  return { ok: true, message: status === "published" ? "Marked published inside GrowthPilot. Nothing was posted to an external network." : "Content updated." };
}

export async function saveCalendarItem(formData: FormData): Promise<ActionResult> {
  const session = await requireWriter();
  const title = String(formData.get("title") || "");
  const date = String(formData.get("date") || "");
  if (!title || !date) return { ok: false, error: "Title and date are required." };
  const { error } = await session.supabase.from("content_calendar").insert({
    workspace_id: session.workspaceId, title, scheduled_for: date, channel: String(formData.get("channel") || "linkedin"),
    notes: String(formData.get("notes") || ""), status: "planned",
  });
  if (error) return fail(error);
  revalidatePath("/calendar");
  return { ok: true, message: "Calendar item added." };
}

export async function createProposal(input: { leadId?: string; opportunityId?: string; title: string }): Promise<ActionResult> {
  const session = await requireWriter();
  const { data: opportunity } = input.opportunityId
    ? await session.supabase.from("lead_opportunities").select("*").eq("id", input.opportunityId).maybeSingle()
    : { data: null };
  const { data: lead } = input.leadId ? await session.supabase.from("leads").select("company:companies(name)").eq("id", input.leadId).maybeSingle() : { data: null };
  const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
  const proposal = buildProposal({
    companyName: company?.name || "the prospect",
    ourCompany: session.company.company_name || session.workspaceName,
    title: input.title,
    context: opportunity?.business_context,
    solution: opportunity?.recommended_solution,
    stack: Array.isArray(opportunity?.proposed_stack) ? opportunity.proposed_stack.map(String) : [],
    complexity: opportunity?.complexity,
    verified: Boolean(opportunity?.verified),
  });
  const { data, error } = await session.supabase.from("proposals").insert({
    workspace_id: session.workspaceId, lead_id: input.leadId || null, opportunity_id: input.opportunityId || null,
    title: input.title, body: proposal.body, structure: proposal.sections,
  }).select("id").single();
  if (error) return fail(error);
  revalidatePath("/proposals");
  return { ok: true, id: data.id, message: "Proposal draft created. No budget was invented." };
}

export async function setProposalStatus(id: string, status: "draft" | "approved" | "sent" | "accepted" | "declined"): Promise<ActionResult> {
  const session = await requireWriter();
  const { data, error } = await session.supabase.from("proposals").update({
    status, sent_at: status === "sent" ? new Date().toISOString() : null,
  }).eq("id", id).eq("workspace_id", session.workspaceId).select("lead_id").single();
  if (error) return fail(error);
  if (status === "sent" && data.lead_id) {
    await session.supabase.from("leads").update({ stage: "proposal_sent" }).eq("id", data.lead_id);
    await session.supabase.from("lead_activities").insert({
      workspace_id: session.workspaceId, lead_id: data.lead_id, actor_id: session.userId,
      activity_type: "stage_changed", summary: "Proposal marked sent.", metadata: { to: "proposal_sent" },
    });
  }
  revalidatePath("/proposals");
  return { ok: true, message: "Proposal updated." };
}

export async function saveWorkflow(input: { id?: string; name: string; trigger: string; enabled: boolean; steps: Array<{ id: string; type: string; enabled: boolean }> }): Promise<ActionResult> {
  const session = await requireWriter();
  const payload = { workspace_id: session.workspaceId, name: input.name, trigger: input.trigger, enabled: input.enabled, steps: input.steps };
  const { error } = input.id
    ? await session.supabase.from("automation_workflows").update(payload).eq("id", input.id).eq("workspace_id", session.workspaceId)
    : await session.supabase.from("automation_workflows").insert(payload);
  if (error) return fail(error);
  revalidatePath("/workflows");
  return { ok: true, message: "Workflow saved." };
}

export async function runWorkflow(workflowId: string, leadId: string): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    const key = executionKey(workflowId, leadId, `manual:${Date.now()}`);
    const { data, error } = await session.supabase.from("automation_executions").insert({
      workspace_id: session.workspaceId, workflow_id: workflowId, lead_id: leadId, idempotency_key: key,
    }).select("id").single();
    if (error) return fail(error);
    await runExecution(session, data.id);
    revalidatePath("/workflows");
    return { ok: true, message: "Workflow run recorded. Check the execution log for any step that is waiting." };
  } catch (error) {
    return fail(error);
  }
}

export async function saveIntegration(provider: string, values: Record<string, string>, enabled: boolean): Promise<ActionResult> {
  try {
    const session = await requireWriter();
    if (!["owner", "admin"].includes(session.role)) return { ok: false, error: "Only an owner or admin can change integrations." };
    if (provider === "linkedin" || provider === "stripe") {
      return { ok: false, error: provider === "linkedin" ? "No approved LinkedIn API is connected in this version. Drafts stay inside GrowthPilot." : "Stripe billing is not implemented in this version." };
    }
    const admin = createAdminClient();
    if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is required to store integration secrets." };
    const cleaned = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
    if (Object.keys(cleaned).length) await saveProviderSecret(admin, session.workspaceId, provider, cleaned);
    const last4 = Object.values(cleaned)[0]?.slice(-4);
    const { error } = await session.supabase.from("integrations").upsert({
      workspace_id: session.workspaceId, provider, enabled, status: enabled ? "connected" : "disabled",
      public_config: last4 ? { last4 } : {},
    }, { onConflict: "workspace_id,provider" });
    if (error) return fail(error);
    revalidatePath("/integrations");
    return { ok: true, message: "Integration settings saved. The full secret is not shown again." };
  } catch (error) {
    return fail(error);
  }
}

export async function testIntegration(provider: string): Promise<ActionResult> {
  try {
    const session = await requireReady();
    if (provider === "linkedin") return { ok: false, error: "LinkedIn publishing and messaging are not available without an approved partner API." };
    if (provider === "stripe") return { ok: false, error: "Stripe is reserved for a future release and was not called." };
    const resolved = await resolveProvider(session.admin, session.workspaceId, provider as "openai");
    if (!resolved.configured) return { ok: false, error: `Missing configuration: ${resolved.missing.join(", ") || "credentials"}` };
    let message = "Connection succeeded.";
    if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${resolved.values.apiKey}` } });
      if (!response.ok) return { ok: false, error: "OpenAI rejected the key." };
    } else if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": resolved.values.apiKey, "anthropic-version": "2023-06-01" } });
      if (!response.ok) return { ok: false, error: "Anthropic rejected the key." };
    } else if (provider === "gemini") {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${resolved.values.apiKey}`);
      if (!response.ok) return { ok: false, error: "Gemini rejected the key." };
    } else if (provider === "google_search") {
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", resolved.values.apiKey);
      url.searchParams.set("cx", resolved.values.cx);
      url.searchParams.set("q", "software");
      url.searchParams.set("num", "1");
      const response = await fetch(url);
      if (!response.ok) return { ok: false, error: "Google Search rejected the key or search engine ID." };
    } else if (provider === "google_maps") {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Goog-Api-Key": resolved.values.apiKey, "X-Goog-FieldMask": "places.displayName" },
        body: JSON.stringify({ textQuery: "software company", pageSize: 1 }),
      });
      if (!response.ok) return { ok: false, error: "Google Maps rejected the key. This test sends one small Places request." };
      message = "Places API accepted the key. The test used one small search request.";
    } else if (provider === "hunter") {
      const response = await fetch(`https://api.hunter.io/v2/account?api_key=${resolved.values.apiKey}`);
      if (!response.ok) return { ok: false, error: "Hunter.io rejected the key." };
    } else if (provider === "apollo") {
      const response = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": resolved.values.apiKey },
        body: JSON.stringify({ q_organization_name: "Apollo", page: 1, per_page: 1 }),
      });
      if (!response.ok) return { ok: false, error: "Apollo.io rejected the key." };
      message = "Apollo accepted the key. The test requested one company result.";
    } else if (provider === "resend") {
      const response = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${resolved.values.apiKey}` } });
      if (!response.ok) return { ok: false, error: "Resend rejected the key." };
    } else if (provider === "gmail") {
      if (!resolved.values.refreshToken) return { ok: false, error: "Gmail OAuth is not finished. Use Connect Gmail first." };
      await refreshGmailToken({ clientId: resolved.values.clientId, clientSecret: resolved.values.clientSecret, refreshToken: resolved.values.refreshToken });
    }
    await session.supabase.from("integrations").upsert({
      workspace_id: session.workspaceId, provider, status: "connected", enabled: true, last_tested_at: new Date().toISOString(), last_error: null,
    }, { onConflict: "workspace_id,provider" });
    revalidatePath("/integrations");
    return { ok: true, message };
  } catch (error) {
    return fail(error);
  }
}

export async function updateSettings(formData: FormData): Promise<ActionResult> {
  const session = await requireWriter();
  const { error } = await session.supabase.from("company_settings").update({
    currency: String(formData.get("currency") || session.settings.currency),
    brand_voice: String(formData.get("brandVoice") || session.settings.brand_voice),
    content_language: String(formData.get("language") || session.settings.content_language),
    daily_send_limit: Number(formData.get("dailyLimit") || session.settings.daily_send_limit),
    min_hours_between_emails: Number(formData.get("minHours") || session.settings.min_hours_between_emails),
    require_manual_approval: formData.get("requireApproval") === "on",
    ai_monthly_token_limit: Number(formData.get("tokenLimit") || session.settings.ai_monthly_token_limit),
    data_retention_days: Number(formData.get("retentionDays") || session.settings.data_retention_days),
    compliance: {
      ...session.settings.compliance,
      require_lawful_basis: true,
      allowed_countries: linesToList(String(formData.get("allowedCountries") || "")),
      include_physical_address: true,
      include_unsubscribe: true,
      dpdp_acknowledged: formData.get("dpdp") === "on",
      gdpr_acknowledged: formData.get("gdpr") === "on",
      can_spam_acknowledged: formData.get("canSpam") === "on",
      trai_acknowledged: formData.get("trai") === "on",
    },
  }).eq("workspace_id", session.workspaceId);
  if (error) return fail(error);
  await session.supabase.from("company_profiles").update({
    company_name: String(formData.get("companyName") || session.company.company_name),
    website: String(formData.get("website") || ""),
    description: String(formData.get("description") || ""),
    location: String(formData.get("location") || ""),
    mailing_address: String(formData.get("mailingAddress") || ""),
    email: String(formData.get("email") || ""),
    email_signature: String(formData.get("signature") || ""),
    ai_provider: String(formData.get("aiProvider") || session.company.ai_provider),
    ai_model: String(formData.get("aiModel") || session.company.ai_model),
    target_countries: linesToList(String(formData.get("countries") || "")),
    target_industries: linesToList(String(formData.get("industries") || "")),
  }).eq("workspace_id", session.workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: "Settings saved." };
}

export async function addMember(email: string, role: "admin" | "member" | "viewer"): Promise<ActionResult> {
  const session = await requireWriter();
  if (!["owner", "admin"].includes(session.role)) return { ok: false, error: "Only an owner or admin can add members." };
  const { data: profile } = await session.supabase.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (!profile) return { ok: false, error: "That person needs a GrowthPilot account before they can be added." };
  const { error } = await session.supabase.from("workspace_members").insert({ workspace_id: session.workspaceId, user_id: profile.id, role });
  if (error) return fail(error);
  revalidatePath("/settings");
  return { ok: true, message: "Member added." };
}

export async function purgeData(): Promise<ActionResult> {
  const session = await requireWriter();
  const { data, error } = await session.supabase.rpc("purge_expired_workspace_data", { p_ws: session.workspaceId });
  if (error) return fail(error);
  return { ok: true, message: `Purge completed: ${JSON.stringify(data)}` };
}

export async function defaultWorkflow(): Promise<ActionResult> {
  return saveWorkflow({ name: "Lead to outreach", trigger: "lead.discovered", enabled: false, steps: DEFAULT_WORKFLOW_STEPS });
}

async function enqueueDiscovered(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, userId: string, leadIds: string[]) {
  const { data: workflows } = await supabase.from("automation_workflows").select("id").eq("workspace_id", workspaceId).eq("enabled", true).eq("trigger", "lead.discovered");
  for (const leadId of leadIds) {
    for (const workflow of workflows ?? []) {
      await supabase.from("automation_executions").insert({
        workspace_id: workspaceId, workflow_id: workflow.id, lead_id: leadId, idempotency_key: executionKey(workflow.id, leadId, "lead.discovered"),
      });
    }
  }
  if (userId && leadIds.length) {
    await supabase.from("notifications").insert({
      workspace_id: workspaceId, user_id: userId, title: "Leads discovered",
      body: `${leadIds.length} new lead${leadIds.length === 1 ? "" : "s"} saved.`, href: "/leads",
    });
  }
}

function suggestedStack(type: string) {
  const stacks: Record<string, string[]> = {
    website: ["Next.js", "TypeScript", "Tailwind CSS"],
    ecommerce: ["Next.js", "PostgreSQL", "Stripe"],
    saas: ["Next.js", "PostgreSQL", "Supabase"],
    android: ["Kotlin", "Jetpack Compose"],
    ios: ["Swift", "SwiftUI"],
    webapp: ["Next.js", "TypeScript", "PostgreSQL"],
    ai_app: ["Next.js", "TypeScript", "OpenAI API"],
    automation: ["TypeScript", "PostgreSQL", "queue workers"],
    crm: ["Next.js", "PostgreSQL"],
    erp: ["Next.js", "PostgreSQL"],
    api: ["TypeScript", "PostgreSQL"],
    custom_software: ["TypeScript", "PostgreSQL"],
  };
  return stacks[type] ?? ["To be chosen after discovery"];
}
