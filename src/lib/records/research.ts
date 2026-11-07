import type { AppSession } from "@/lib/auth/session";
import { generateText, parseJsonObject } from "@/lib/ai/generate";
import { matchOfferings } from "@/lib/matching";
import { scoreLead } from "@/lib/scoring";
import { loadOfferings } from "@/lib/records/persist";

export async function researchLeadRecord(session: AppSession, leadId: string) {
  const { data: lead, error } = await session.supabase
    .from("leads")
    .select("*, company:companies(*), contact:contacts(*)")
    .eq("id", leadId)
    .eq("workspace_id", session.workspaceId)
    .single();
  if (error || !lead) throw new Error(error?.message || "Lead not found.");
  const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
  const contact = Array.isArray(lead.contact) ? lead.contact[0] : lead.contact;
  const suppliedFacts = [
    company?.name ? { statement: `Company name: ${company.name}`, source: "workspace_record" } : null,
    company?.website ? { statement: `Website: ${company.website}`, source: company.website } : null,
    company?.industry ? { statement: `Industry: ${company.industry}`, source: "workspace_record" } : null,
    company?.country || company?.city ? { statement: `Location: ${[company.city, company.country].filter(Boolean).join(", ")}`, source: "workspace_record" } : null,
    company?.description ? { statement: company.description, source: company.metadata?.source_url || "workspace_record" } : null,
    company?.company_size ? { statement: `Reported size: ${company.company_size}`, source: company.source || "workspace_record" } : null,
  ].filter((item): item is { statement: string; source: string } => Boolean(item));
  const allowedSources = new Set(suppliedFacts.map((fact) => fact.source));
  let overview = suppliedFacts.length
    ? `${company.name} is stored with the public details listed in the verified facts.`
    : "There is not enough stored public information to summarize this company.";
  let hypotheses: Array<{ statement: string; why?: string }> = [];
  let challenges: string[] = [];
  let development: string[] = [];
  let automation: string[] = [];
  let aiIdeas: string[] = [];
  let services: string[] = [];
  let titles: string[] = [];
  let angle = "";
  let generator: "rules" | "ai" = "rules";
  let model: string | null = null;
  const offerings = await loadOfferings(session.supabase, session.workspaceId);
  const match = matchOfferings(
    { name: company?.name || "Company", industry: company?.industry, description: company?.description, country: company?.country },
    offerings,
  );

  try {
    const response = await generateText({
      supabase: session.supabase,
      admin: session.admin,
      workspaceId: session.workspaceId,
      userId: session.userId,
      provider: session.company.ai_provider,
      model: session.company.ai_model,
      feature: "research",
      json: true,
      monthlyLimit: session.settings.ai_monthly_token_limit,
      system: "You research companies for a software studio. Return JSON only. Use only the supplied public fields. Put anything not directly supported by those fields into hypotheses. Never invent budgets, current technology stacks, headcount, funding, or requirements. If information is missing, leave the array empty and say so in the overview.",
      prompt: JSON.stringify({
        company,
        verified_facts: suppliedFacts,
        catalog_match: match.matched ? { name: match.offering?.name, reason: match.reason } : null,
      }),
    });
    const parsed = parseJsonObject(response.text);
    overview = String(parsed.overview || overview);
    const modelFacts = arrayOf(parsed.facts).filter((item) => allowedSources.has(String(item.source || "")) || item.source === "workspace_record");
    const moved = arrayOf(parsed.facts).filter((item) => !modelFacts.includes(item)).map((item) => ({
      statement: String(item.statement || ""),
      why: "The model did not tie this statement to a supplied source, so it is stored as a hypothesis.",
    }));
    suppliedFacts.push(...modelFacts.map((item) => ({ statement: String(item.statement), source: String(item.source || "workspace_record") })));
    hypotheses = [...moved, ...arrayOf(parsed.hypotheses).map((item) => ({ statement: String(item.statement || ""), why: String(item.why || "") }))].filter((item) => item.statement);
    challenges = strings(parsed.technical_challenges);
    development = strings(parsed.development_opportunities);
    automation = strings(parsed.automation_opportunities);
    aiIdeas = strings(parsed.ai_opportunities);
    services = strings(parsed.recommended_services);
    titles = strings(parsed.decision_maker_titles);
    angle = String(parsed.outreach_angle || "");
    generator = "ai";
    model = response.model;
  } catch (aiError) {
    hypotheses = [{ statement: aiError instanceof Error ? aiError.message : "AI research is unavailable.", why: "The fact-only profile was saved instead." }];
  }

  const { error: insertError } = await session.supabase.from("lead_research").insert({
    workspace_id: session.workspaceId,
    lead_id: leadId,
    company_id: company.id,
    overview,
    main_offerings: String(company.description || ""),
    industry: company.industry,
    target_audience: "",
    facts: suppliedFacts,
    hypotheses,
    sources: suppliedFacts.map((fact) => ({ url: fact.source, note: fact.statement })),
    technical_challenges: challenges.map((statement) => ({ statement, kind: "hypothesis" })),
    development_opportunities: development.map((statement) => ({ statement, kind: "hypothesis" })),
    automation_opportunities: automation.map((statement) => ({ statement, kind: "hypothesis" })),
    ai_opportunities: aiIdeas.map((statement) => ({ statement, kind: "hypothesis" })),
    recommended_services: services,
    recommended_product_id: match.offering?.kind === "product" ? match.offering.id : null,
    recommended_service_id: match.offering?.kind === "service" ? match.offering.id : null,
    decision_maker_titles: titles,
    outreach_angle: angle,
    product_match: match,
    generator,
    model,
    researched_at: new Date().toISOString(),
  });
  if (insertError) throw new Error(insertError.message);
  const score = scoreLead({
    industry: company.industry,
    targetIndustries: session.company.target_industries,
    country: company.country,
    targetCountries: session.company.target_countries,
    description: company.description,
    hasEmail: Boolean(contact?.email),
    hasName: Boolean(contact?.full_name),
    matchScore: match.matched ? match.score : 0,
    stage: lead.stage,
  });
  await session.supabase.from("lead_scores").insert({
    workspace_id: session.workspaceId,
    lead_id: leadId,
    score: score.score,
    breakdown: score.breakdown,
    explanation: score.explanation,
  });
  if (["new", "discovered"].includes(lead.stage)) {
    await session.supabase.from("leads").update({ stage: "researched", summary: overview }).eq("id", leadId);
  }
  await session.supabase.from("lead_activities").insert({
    workspace_id: session.workspaceId,
    lead_id: leadId,
    actor_id: session.userId,
    activity_type: "research_completed",
    summary: generator === "ai" ? "AI research saved. Hypotheses are labeled separately from verified facts." : "Fact-only research saved because AI was unavailable.",
    metadata: { generator },
  });
  return { generator, overview, match, score };
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : String((item as { statement?: string }).statement || ""))).filter(Boolean);
}
