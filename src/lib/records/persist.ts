import type { SupabaseClient } from "@supabase/supabase-js";
import { dedupeKey, normalizeCompanyName, normalizeDomain, sameCompany } from "@/lib/domain";
import type { DiscoveredCompany } from "@/lib/discovery/search";
import { matchOfferings, type Offering } from "@/lib/matching";
import { scoreLead } from "@/lib/scoring";

type ExistingCompany = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  description: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  location: string | null;
  company_size: string | null;
  linkedin_url: string | null;
};

export async function persistDiscovered(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  userId: string;
  companies: DiscoveredCompany[];
  offerings: Offering[];
  targetIndustries: string[];
  targetCountries: string[];
  opportunityType?: string | null;
}) {
  const createdLeadIds: string[] = [];
  let created = 0;
  let updated = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const company of input.companies) {
    const domain = normalizeDomain(company.domain || company.website);
    const key = dedupeKey({ domain, name: company.name, country: company.country });
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const existing = await findCompany(input.supabase, input.workspaceId, { ...company, domain });
      const saved = existing
        ? await updateCompany(input.supabase, existing, { ...company, domain })
        : await insertCompany(input.supabase, input.workspaceId, { ...company, domain });
      if (existing) updated += 1;
      else created += 1;
      const contactId = company.contact?.email
        ? await upsertContact(input.supabase, input.workspaceId, saved.id, company)
        : null;
      const leadId = await ensureLead(input.supabase, input.workspaceId, input.userId, saved.id, contactId, company.source);
      if (leadId.created) createdLeadIds.push(leadId.id);
      const match = matchOfferings(
        { name: saved.name, industry: saved.industry, description: saved.description, country: saved.country },
        input.offerings,
        input.opportunityType,
      );
      const score = scoreLead({
        industry: saved.industry,
        targetIndustries: input.targetIndustries,
        country: saved.country,
        targetCountries: input.targetCountries,
        description: saved.description,
        hasEmail: Boolean(company.contact?.email),
        hasName: Boolean(company.contact?.name),
        matchScore: match.matched ? match.score : 0,
        stage: "discovered",
      });
      await input.supabase.from("lead_scores").insert({
        workspace_id: input.workspaceId,
        lead_id: leadId.id,
        score: score.score,
        breakdown: score.breakdown,
        explanation: score.explanation,
      });
      await input.supabase.from("leads").update({
        custom_fields: { product_match: match },
        summary: match.reason,
      }).eq("id", leadId.id);
      await input.supabase.from("lead_activities").insert({
        workspace_id: input.workspaceId,
        lead_id: leadId.id,
        actor_id: input.userId,
        activity_type: existing ? "company_refreshed" : "lead_discovered",
        summary: existing ? `Updated ${saved.name} from ${company.source}.` : `Discovered ${saved.name} from ${company.source}.`,
        metadata: { source: company.source, source_url: company.sourceUrl ?? null, match_score: match.score },
      });
    } catch (error) {
      errors.push(`${company.name}: ${error instanceof Error ? error.message : "could not be saved"}`);
    }
  }
  return { created, updated, createdLeadIds, errors };
}

async function findCompany(supabase: SupabaseClient, workspaceId: string, company: DiscoveredCompany & { domain: string | null }) {
  if (company.domain) {
    const { data } = await supabase.from("companies").select("*").eq("workspace_id", workspaceId).eq("domain", company.domain).maybeSingle();
    return (data as ExistingCompany | null) ?? null;
  }
  const { data } = await supabase.from("companies").select("*").eq("workspace_id", workspaceId).ilike("name", company.name).limit(20);
  return ((data ?? []) as ExistingCompany[]).find((row) => sameCompany(row, company)) ?? null;
}

async function insertCompany(supabase: SupabaseClient, workspaceId: string, company: DiscoveredCompany & { domain: string | null }) {
  const { data, error } = await supabase.from("companies").insert(companyPayload(workspaceId, company)).select("*").single();
  if (error) throw new Error(error.message);
  return data as ExistingCompany & { description: string | null; industry: string | null; country: string | null };
}

async function updateCompany(supabase: SupabaseClient, existing: ExistingCompany, company: DiscoveredCompany & { domain: string | null }) {
  const patch = {
    website: existing.website || company.website || null,
    industry: existing.industry || company.industry || null,
    country: existing.country || company.country || null,
    city: existing.city || company.city || null,
    location: existing.location || company.location || null,
    description: existing.description || company.description || null,
    company_size: existing.company_size || company.companySize || null,
    linkedin_url: existing.linkedin_url || company.linkedinUrl || null,
    public_contact: company.phone ? { phone: company.phone, source: company.source } : undefined,
  };
  const { data, error } = await supabase.from("companies").update(patch).eq("id", existing.id).select("*").single();
  if (error) throw new Error(error.message);
  return data as ExistingCompany;
}

function companyPayload(workspaceId: string, company: DiscoveredCompany & { domain: string | null }) {
  return {
    workspace_id: workspaceId,
    name: company.name.trim(),
    website: company.website ?? null,
    domain: company.domain,
    industry: company.industry ?? null,
    country: company.country ?? null,
    city: company.city ?? null,
    location: company.location ?? null,
    description: company.description ?? null,
    company_size: company.companySize ?? null,
    linkedin_url: company.linkedinUrl ?? null,
    public_contact: company.phone ? { phone: company.phone, source: company.source } : {},
    source: company.source,
    metadata: { source_url: company.sourceUrl ?? null, normalized_name: normalizeCompanyName(company.name) },
  };
}

async function upsertContact(supabase: SupabaseClient, workspaceId: string, companyId: string, company: DiscoveredCompany) {
  const email = company.contact?.email?.toLowerCase();
  if (!email) return null;
  const { data: existing } = await supabase.from("contacts").select("id").eq("workspace_id", workspaceId).ilike("email", email).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await supabase.from("contacts").insert({
    workspace_id: workspaceId,
    company_id: companyId,
    full_name: company.contact?.name || null,
    designation: company.contact?.title || null,
    email,
    source: company.source,
    is_primary: true,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function ensureLead(supabase: SupabaseClient, workspaceId: string, userId: string, companyId: string, contactId: string | null, source: string) {
  const { data: existing } = await supabase
    .from("leads")
    .select("id, stage")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .in("stage", ["new", "discovered", "researched", "qualified", "contacted", "replied", "meeting_scheduled", "proposal_sent", "negotiation"])
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    if (contactId) await supabase.from("leads").update({ primary_contact_id: contactId }).eq("id", existing.id);
    return { id: existing.id as string, created: false };
  }
  const { data, error } = await supabase.from("leads").insert({
    workspace_id: workspaceId,
    company_id: companyId,
    primary_contact_id: contactId,
    stage: "discovered",
    owner_id: userId,
    source,
    probability: 10,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, created: true };
}

export async function loadOfferings(supabase: SupabaseClient, workspaceId: string): Promise<Offering[]> {
  const [{ data: products }, { data: services }] = await Promise.all([
    supabase.from("products").select("*").eq("workspace_id", workspaceId).eq("status", "active"),
    supabase.from("service_catalog").select("*").eq("workspace_id", workspaceId).eq("status", "active"),
  ]);
  return [
    ...((products ?? []) as Array<Record<string, unknown>>).map((row) => toOffering(row, "product")),
    ...((services ?? []) as Array<Record<string, unknown>>).map((row) => toOffering(row, "service")),
  ];
}

function toOffering(row: Record<string, unknown>, kind: "product" | "service"): Offering {
  return {
    id: String(row.id),
    kind,
    name: String(row.name),
    description: String(row.description ?? ""),
    category: String(row.category ?? ""),
    industry: String(row.industry ?? ""),
    problemSolved: String(row.problem_solved ?? ""),
    features: Array.isArray(row.features) ? row.features.map(String) : [],
    benefits: Array.isArray(row.benefits) ? row.benefits.map(String) : [],
    targetAudience: String(row.target_audience ?? ""),
    demoUrls: Array.isArray(row.demo_urls) ? row.demo_urls.map(String) : [],
    pricing: (row.pricing as Offering["pricing"]) ?? null,
    status: String(row.status ?? "active"),
  };
}
