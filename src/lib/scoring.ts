import { clamp } from "@/lib/utils";
import { QUALIFIED_STAGES, type LeadStage } from "@/lib/constants";

const BUYING_PHRASES = [
  "request for proposal",
  "rfp",
  "looking for a development partner",
  "seeking a software",
  "hiring a developer",
  "need a new website",
  "replacing our crm",
  "system modernization",
];

export type ScoreInput = {
  industry?: string | null;
  targetIndustries?: string[];
  country?: string | null;
  targetCountries?: string[];
  description?: string | null;
  hasEmail: boolean;
  hasName: boolean;
  matchScore?: number | null;
  stage?: string | null;
  replyCategory?: string | null;
};

export type ScoreFactor = { id: string; label: string; points: number; max: number; detail: string };

export type ScoreResult = { score: number; breakdown: ScoreFactor[]; explanation: string };

function includesLoose(values: string[] | undefined, candidate?: string | null) {
  if (!candidate || !values?.length) return false;
  const needle = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === needle || needle.includes(value.toLowerCase()) || value.toLowerCase().includes(needle));
}

export function scoreLead(input: ScoreInput): ScoreResult {
  const factors: ScoreFactor[] = [];
  const industry = input.industry?.trim();
  if (!input.targetIndustries?.length) {
    factors.push({ id: "industry", label: "Industry relevance", points: industry ? 10 : 0, max: 25, detail: industry ? "No target industries are configured, so only a partial score is applied." : "Industry is missing and no target industries are configured." });
  } else if (includesLoose(input.targetIndustries, industry)) {
    factors.push({ id: "industry", label: "Industry relevance", points: 25, max: 25, detail: `${industry} matches a target industry.` });
  } else if (industry) {
    factors.push({ id: "industry", label: "Industry relevance", points: 6, max: 25, detail: `${industry} does not match the configured target industries.` });
  } else {
    factors.push({ id: "industry", label: "Industry relevance", points: 0, max: 25, detail: "Industry was not stored, so relevance cannot be scored." });
  }

  if (!input.targetCountries?.length) {
    factors.push({ id: "geography", label: "Company fit", points: input.country ? 8 : 4, max: 15, detail: input.country ? "No target countries are configured. Country is recorded, with a partial fit score." : "Country and target countries are both missing." });
  } else if (includesLoose(input.targetCountries, input.country)) {
    factors.push({ id: "geography", label: "Company fit", points: 15, max: 15, detail: `${input.country} is a target country.` });
  } else {
    factors.push({ id: "geography", label: "Company fit", points: 0, max: 15, detail: input.country ? `${input.country} is outside the target countries.` : "Country was not stored." });
  }

  const description = input.description?.toLowerCase() ?? "";
  const foundPhrases = BUYING_PHRASES.filter((phrase) => description.includes(phrase));
  factors.push({
    id: "signals",
    label: "Buying signals",
    points: Math.min(10, foundPhrases.length * 5),
    max: 10,
    detail: foundPhrases.length ? `Explicit public phrases found: ${foundPhrases.join(", ")}.` : "No explicit public buying signal was found in the stored description.",
  });

  const matchPoints = input.matchScore == null ? 0 : clamp(Math.round(input.matchScore * 0.25), 0, 25);
  factors.push({
    id: "product",
    label: "Product or service fit",
    points: matchPoints,
    max: 25,
    detail: input.matchScore == null ? "No catalog match has been saved yet." : `Catalog match score is ${input.matchScore} out of 100.`,
  });

  const contactPoints = (input.hasEmail ? 15 : 0) + (input.hasName ? 5 : 0);
  factors.push({
    id: "contact",
    label: "Contact availability",
    points: contactPoints,
    max: 20,
    detail: [input.hasEmail ? "A business email is stored." : "No business email is stored.", input.hasName ? "A contact name is stored." : "No contact name is stored."].join(" "),
  });

  let engagement = 0;
  let engagementDetail = "No reply or meeting is recorded.";
  if (input.stage === "meeting_scheduled" || input.stage === "proposal_sent" || input.stage === "negotiation" || input.stage === "won") {
    engagement = 15;
    engagementDetail = "The lead has reached a meeting or later stage.";
  } else if (input.replyCategory && ["interested", "meeting_request", "pricing", "needs_info"].includes(input.replyCategory)) {
    engagement = 12;
    engagementDetail = `Latest reply category is ${input.replyCategory.replaceAll("_", " ")}.`;
  } else if (input.stage === "replied" || input.replyCategory) {
    engagement = 8;
    engagementDetail = "A reply has been recorded.";
  } else if (input.stage === "contacted") {
    engagement = 3;
    engagementDetail = "The lead has been contacted and has no recorded reply.";
  }
  factors.push({ id: "engagement", label: "Engagement", points: engagement, max: 15, detail: engagementDetail });

  const score = clamp(factors.reduce((sum, factor) => sum + factor.points, 0), 0, 100);
  const qualified = input.stage ? QUALIFIED_STAGES.includes(input.stage as LeadStage) : false;
  const explanation = [
    `Score ${score} of 100.`,
    ...factors.map((factor) => `${factor.label}: ${factor.points}/${factor.max}. ${factor.detail}`),
    qualified ? "The current stage is qualified or later." : "Stage alone does not increase the score beyond the factors above.",
  ].join(" ");

  return { score, breakdown: factors, explanation };
}
