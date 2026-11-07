export type OutreachContext = {
  companyName: string;
  contactName?: string | null;
  contactRole?: string | null;
  ourCompany: string;
  ourWebsite?: string | null;
  signature?: string | null;
  mailingAddress?: string | null;
  offeringName?: string | null;
  demoUrl?: string | null;
  portfolioUrl?: string | null;
  verifiedFacts?: string[];
  angle?: string | null;
  purpose: "cold" | "product" | "custom" | "partnership" | "follow_up" | "linkedin" | "proposal";
  tone: string;
  unsubscribeUrl?: string | null;
};

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function buildOutreach(context: OutreachContext) {
  const name = context.contactName?.trim() || "there";
  const role = context.contactRole ? ` as ${context.contactRole}` : "";
  const facts = (context.verifiedFacts ?? []).filter(Boolean).slice(0, 3);
  const factLine = facts.length ? `From public information: ${facts.join(" ")}` : "We do not yet have verified details about a specific requirement at your company.";
  const offer = context.offeringName || "custom software development";
  const proof = context.demoUrl || context.portfolioUrl;
  const proofLine = proof ? `Relevant link: ${proof}` : "I can share a relevant example once we confirm the right area.";
  const tone = context.tone || "professional";
  const subjects: Record<OutreachContext["purpose"], string> = {
    cold: `${offer} for ${context.companyName}`,
    product: `${context.offeringName || offer} — ${context.companyName}`,
    custom: `Custom development idea for ${context.companyName}`,
    partnership: `Partnership idea for ${context.companyName}`,
    follow_up: `Following up, ${context.companyName}`,
    linkedin: `Hello from ${context.ourCompany}`,
    proposal: `Proposal outline for ${context.companyName}`,
  };
  const opening = context.purpose === "follow_up"
    ? `Hello ${name}, I am following up on my earlier note to ${context.companyName}.`
    : `Hello ${name}${role}, I am writing from ${context.ourCompany}.`;
  const value = context.purpose === "partnership"
    ? `${context.ourCompany} partners with teams that want to deliver software, AI, or automation work.`
    : `${context.ourCompany} helps companies with ${offer}.`;
  const hypothesis = context.angle
    ? `Suggested angle, not a verified requirement: ${context.angle}`
    : "This note does not assume a budget, technology stack, or active project.";
  const cta = context.purpose === "linkedin"
    ? "If this is relevant, I would be glad to connect."
    : "Would a short conversation next week be useful, or should I send this to someone else on the team?";
  const footer = [
    context.signature || `${context.ourCompany}${context.ourWebsite ? `\n${context.ourWebsite}` : ""}`,
    context.mailingAddress || "",
    context.unsubscribeUrl ? `Unsubscribe: ${context.unsubscribeUrl}` : "",
  ].filter(Boolean);

  const body = [opening, "", factLine, "", value, proofLine, hypothesis, "", cta, "", ...footer].join("\n");
  return {
    subject: subjects[context.purpose],
    body,
    opening,
    value,
    proofLine,
    cta,
    tone,
    generator: "template" as const,
  };
}

export function buildMarketingDraft(input: {
  contentType: string;
  brand: string;
  offering?: string | null;
  audience?: string | null;
  country?: string | null;
  industry?: string | null;
  voice?: string | null;
  objective?: string | null;
  language?: string | null;
}) {
  const offering = input.offering || input.brand;
  const audience = input.audience || "business decision makers";
  const place = [input.industry, input.country].filter(Boolean).join(" in ");
  const title = `${offering}: ${input.objective || "a practical software partnership"}`;
  const body = [
    `${input.brand} helps ${audience}${place ? ` working in ${place}` : ""} with ${offering}.`,
    "",
    `Voice: ${input.voice || "professional"}. Language: ${input.language || "en"}.`,
    input.objective ? `Objective: ${input.objective}.` : "",
    "",
    "This draft was built from the workspace profile and catalog. It does not claim customer results that are not stored as case studies.",
    "",
    `Format: ${input.contentType.replaceAll("_", " ")}.`,
  ].filter(Boolean).join("\n");
  return { title, body, generator: "template" as const };
}

export function buildProposal(input: {
  companyName: string;
  ourCompany: string;
  title: string;
  context?: string | null;
  solution?: string | null;
  stack?: string[];
  complexity?: string | null;
  verified: boolean;
}) {
  const sections = [
    "Understanding",
    "Proposed approach",
    "Suggested technology stack",
    "Scope boundaries",
    "Collaboration and next step",
  ];
  const body = [
    `# ${input.title}`,
    "",
    `Prepared by ${input.ourCompany} for ${input.companyName}.`,
    "",
    input.verified
      ? "The business context below is marked verified by a workspace member."
      : "The business context below is a hypothesis. It is not a confirmed client requirement, budget, or technology decision.",
    "",
    "## Understanding",
    input.context || "Public information is limited. Confirm the current process before proposing scope.",
    "",
    "## Proposed approach",
    input.solution || "Start with a discovery workshop and a written scope before implementation.",
    "",
    "## Suggested technology stack",
    (input.stack?.length ? input.stack : ["To be selected after discovery"]).map((item) => `- ${item}`).join("\n"),
    "",
    "This stack is our suggested implementation approach. It is not a claim about the prospect's current systems.",
    "",
    "## Complexity",
    `Internal delivery complexity: ${input.complexity || "medium"}. No project budget is stated.`,
    "",
    "## Next step",
    "Review this outline, confirm the problem with the prospect, and only then turn it into a commercial proposal.",
  ].join("\n");
  return { body, sections };
}

export function executionKey(workflowId: string, leadId: string, trigger: string) {
  return `${workflowId}:${leadId}:${trigger}`;
}

export const DEFAULT_WORKFLOW_STEPS = [
  { id: "research", type: "research_company", enabled: true },
  { id: "score", type: "score_lead", enabled: true },
  { id: "match", type: "match_products", enabled: true },
  { id: "draft", type: "generate_outreach_draft", enabled: true },
  { id: "notify", type: "notify_member", enabled: true },
  { id: "approve", type: "wait_for_approval", enabled: true },
  { id: "send", type: "send_approved_email", enabled: false },
  { id: "monitor", type: "monitor_response", enabled: true },
  { id: "crm", type: "update_crm_status", enabled: true },
];
