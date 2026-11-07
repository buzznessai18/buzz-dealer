import assert from "node:assert/strict";
import { normalizeDomain, normalizeCompanyName, dedupeKey, sameCompany } from "../src/lib/domain";
import { scoreLead } from "../src/lib/scoring";
import { matchOfferings } from "../src/lib/matching";
import { evaluateSend, categorizeReply, shouldStopSequence } from "../src/lib/compliance";
import { aggregateDashboard, recommendFromMetrics, toCsv } from "../src/lib/dashboard-metrics";
import { resolveDateRange, addDays } from "../src/lib/dates";
import { buildOutreach, renderTemplate, executionKey } from "../src/lib/outreach";

assert.equal(normalizeDomain("https://www.Example.com/path"), "example.com");
assert.equal(normalizeDomain("not a domain"), null);
assert.equal(normalizeCompanyName("Acme Private Limited"), "acme");
assert.equal(dedupeKey({ domain: "acme.com", name: "Acme Pvt Ltd", country: "India" }), "domain:acme.com");
assert.equal(sameCompany({ domain: null, name: "Acme Pvt Ltd", country: "India" }, { name: "Acme Private Limited", country: "India" }), true);

const score = scoreLead({ industry: "Healthcare", targetIndustries: ["Healthcare"], country: "India", targetCountries: ["India"], description: "We published an RFP for a patient portal.", hasEmail: true, hasName: true, matchScore: 80, stage: "replied", replyCategory: "interested" });
assert.ok(score.score > 70);
assert.ok(score.explanation.includes("Healthcare"));
assert.ok(score.breakdown.every((factor) => factor.points <= factor.max));

const match = matchOfferings(
  { name: "North Clinic", industry: "Healthcare", description: "Looking for a patient portal and crm" },
  [{ id: "1", kind: "product", name: "Clinic CRM", description: "crm for clinics", category: "CRM", industry: "Healthcare", problemSolved: "patient follow-up", features: ["crm", "portal"], demoUrls: ["https://demo.example"], status: "active" }],
);
assert.equal(match.matched, true);
assert.equal(match.demoUrl, "https://demo.example");
const noMatch = matchOfferings({ name: "Cafe", industry: "Food", description: "We sell coffee." }, [{ id: "2", kind: "service", name: "ERP", description: "manufacturing erp", category: "ERP", problemSolved: "inventory", status: "active" }]);
assert.equal(noMatch.matched, false);
assert.equal(noMatch.customRecommended, true);

const blocked = evaluateSend({ eligible: false, requireLawfulBasis: true, suppressed: false, unsubscribed: false, duplicate: false, campaignApproved: true, draftApproved: true, requireManualApproval: true, automated: false, allowAutomatedSend: false, dailyCount: 0, dailyLimit: 10, minHours: 48, hasRecipient: true, hasSender: true, acknowledgements: { dpdp: true, gdpr: true, canSpam: true, trai: true } });
assert.equal(blocked.ok, false);
assert.ok(blocked.reasons.some((reason) => reason.includes("lawful")));
const allowed = evaluateSend({ eligible: true, lawfulBasis: "consent", requireLawfulBasis: true, suppressed: false, unsubscribed: false, duplicate: false, campaignApproved: true, draftApproved: true, requireManualApproval: true, automated: false, allowAutomatedSend: false, dailyCount: 0, dailyLimit: 10, minHours: 0, hasRecipient: true, hasSender: true, acknowledgements: { dpdp: true, gdpr: true, canSpam: true, trai: true } });
assert.equal(allowed.ok, true);

assert.equal(categorizeReply("Please unsubscribe me").category, "unsubscribe");
assert.equal(categorizeReply("Can we schedule a call next week?").category, "meeting_request");
assert.equal(shouldStopSequence({ stopOnReply: true, stopOnUnsubscribe: true, stopOnNotInterested: true, replied: true, unsubscribed: false, notInterested: false, lost: false }), "A reply was received.");

const range = resolveDateRange("7d", undefined, undefined, new Date("2026-11-07T00:00:00.000Z"));
assert.equal("error" in range, false);
const dashboard = aggregateDashboard({
  start: "2026-11-01T00:00:00.000Z",
  end: "2026-11-07T00:00:00.000Z",
  currency: "INR",
  leads: [{ id: "l1", stage: "qualified", dealValue: 1000, createdAt: "2026-11-02T00:00:00.000Z", contactable: true }],
  drafts: [{ createdAt: "2026-11-02T00:00:00.000Z" }],
  messages: [{ createdAt: "2026-11-03T00:00:00.000Z", direction: "outbound", status: "sent", replyCategory: null }],
  events: [],
  activities: [],
  proposals: [],
  wonDeals: [],
  openPipeline: [{ stage: "qualified", value: 1000 }],
  followups: [],
  campaigns: [],
  recentActivities: [],
});
assert.equal(dashboard.discovered, 1);
assert.equal(dashboard.sent, 1);
assert.equal(dashboard.delivered, 0);
assert.equal(dashboard.pipelineValue, 1000);
assert.ok(recommendFromMetrics({ ...dashboard, drafted: 2, sent: 0 }).some((item) => item.title.includes("drafts") || item.title.includes("Drafts") || item.detail.includes("draft")));

assert.equal(renderTemplate("Hello {{contact_name}}", { contact_name: "Asha" }), "Hello Asha");
assert.equal(renderTemplate("Hello {{missing}}", {}), "Hello ");
const outreach = buildOutreach({ companyName: "North", ourCompany: "Studio", purpose: "cold", tone: "professional", verifiedFacts: [] });
assert.match(outreach.body, /do not yet have verified details/i);
assert.equal(executionKey("w", "l", "lead.discovered"), "w:l:lead.discovered");
assert.ok(addDays(new Date("2026-11-01T00:00:00.000Z"), 4).toISOString().startsWith("2026-11-05"));
assert.ok(toCsv([{ company: "A, B", count: 1 }]).includes('"A, B"'));

console.log("Core checks passed.");
