import { OPPORTUNITY_TYPES } from "@/lib/constants";

const STOPWORDS = new Set("a an the and or for with from into our your their this that are is be to of in on by at as it we you they them your".split(" "));

export type Offering = {
  id: string;
  kind: "product" | "service";
  name: string;
  description?: string | null;
  category?: string | null;
  industry?: string | null;
  problemSolved?: string | null;
  features?: string[];
  benefits?: string[];
  targetAudience?: string | null;
  demoUrls?: string[];
  pricing?: { amount?: number | null; currency?: string | null; notes?: string | null } | null;
  status?: string | null;
};

export type MatchResult = {
  matched: boolean;
  customRecommended: boolean;
  score: number;
  offering: Offering | null;
  reason: string;
  fit: "none" | "low" | "medium" | "high";
  pitch: string;
  demoUrl: string | null;
  catalogPrice: string | null;
  sharedTerms: string[];
};

function tokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function offeringText(offering: Offering) {
  return [
    offering.name,
    offering.description,
    offering.category,
    offering.industry,
    offering.problemSolved,
    offering.targetAudience,
    ...(offering.features ?? []),
    ...(offering.benefits ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

const OPPORTUNITY_TERMS: Record<string, string[]> = {
  website: ["website", "web", "marketing"],
  ecommerce: ["ecommerce", "commerce", "store", "shop"],
  saas: ["saas", "platform", "subscription"],
  android: ["android", "mobile"],
  ios: ["ios", "iphone", "mobile"],
  webapp: ["web", "application", "portal"],
  ai_app: ["ai", "chatbot", "generative", "agent"],
  automation: ["automation", "workflow", "process"],
  crm: ["crm", "customer"],
  erp: ["erp", "operations"],
  api: ["api", "integration"],
  custom_software: ["custom", "software", "development"],
};

export function matchOfferings(
  company: { name: string; industry?: string | null; description?: string | null; country?: string | null },
  offerings: Offering[],
  opportunityType?: string | null,
): MatchResult {
  const active = offerings.filter((offering) => offering.status !== "archived");
  const companyTokens = new Set(tokens([company.industry, company.description, opportunityType].filter(Boolean).join(" ")));
  const opportunityTerms = opportunityType ? OPPORTUNITY_TERMS[opportunityType] ?? tokens(opportunityType) : [];

  let best: { offering: Offering; score: number; shared: string[] } | null = null;
  for (const offering of active) {
    const offeringTokens = [...new Set(tokens(offeringText(offering)))];
    const shared = offeringTokens.filter((token) => companyTokens.has(token));
    const opportunityHits = opportunityTerms.filter((term) => offeringTokens.includes(term));
    const industryMatch = Boolean(
      company.industry && offering.industry && company.industry.toLowerCase() === offering.industry.toLowerCase(),
    );
    const score = Math.min(100, shared.length * 18 + (industryMatch ? 20 : 0) + Math.min(30, opportunityHits.length * 15));
    if (!best || score > best.score) best = { offering, score, shared: [...new Set([...shared, ...opportunityHits])] };
  }

  const label = OPPORTUNITY_TYPES.find((item) => item.id === opportunityType)?.label;
  if (!best || best.score < 35) {
    return {
      matched: false,
      customRecommended: true,
      score: best?.score ?? 0,
      offering: null,
      reason: best
        ? `The closest catalog item, ${best.offering.name}, only shares ${best.shared.length ? best.shared.slice(0, 6).join(", ") : "no meaningful terms"} and stays below the match threshold.`
        : "The catalog has no active products or services to compare.",
      fit: "none",
      pitch: label
        ? `${company.name} can be approached for a custom ${label.toLowerCase()} engagement. This is a hypothesis based on the selected opportunity type, not a verified requirement.`
        : `${company.name} does not have a relevant catalog match. A custom development conversation is more appropriate than forcing a product pitch.`,
      demoUrl: null,
      catalogPrice: null,
      sharedTerms: best?.shared.slice(0, 8) ?? [],
    };
  }

  const price = best.offering.pricing?.amount;
  const fit = best.score >= 70 ? "high" : best.score >= 50 ? "medium" : "low";
  return {
    matched: true,
    customRecommended: false,
    score: best.score,
    offering: best.offering,
    reason: `Matched ${best.offering.name} because the stored company profile shares these terms: ${best.shared.slice(0, 8).join(", ") || best.offering.category || "catalog category"}.`,
    fit,
    pitch: `${company.name} is a catalog fit for ${best.offering.name}. The pitch should stay limited to the published offer and the shared terms above.`,
    demoUrl: best.offering.demoUrls?.[0] ?? null,
    catalogPrice: price ? `${best.offering.pricing?.currency || "INR"} ${price}` : best.offering.pricing?.notes || null,
    sharedTerms: best.shared.slice(0, 8),
  };
}
