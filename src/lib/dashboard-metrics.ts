import { eachDay, inRange } from "@/lib/dates";
import { OPEN_STAGES, PIPELINE_STAGES, POSITIVE_REPLY_CATEGORIES, QUALIFIED_STAGES } from "@/lib/constants";

export type DashboardSource = {
  start: string;
  end: string;
  currency: string;
  leads: Array<{ id: string; stage: string; dealValue: number; createdAt: string; contactable: boolean }>;
  drafts: Array<{ createdAt: string }>;
  messages: Array<{ createdAt: string; direction: "inbound" | "outbound"; status: string; replyCategory?: string | null }>;
  events: Array<{ occurredAt: string; eventType: string }>;
  activities: Array<{ createdAt: string; activityType: string; summary: string; metadata?: { to?: string } | null }>;
  proposals: Array<{ createdAt: string; sentAt?: string | null; status: string }>;
  wonDeals: Array<{ wonAt: string; value: number }>;
  openPipeline: Array<{ stage: string; value: number }>;
  followups: Array<{ id: string; company: string; due: string; stage: string }>;
  campaigns: Array<{ id: string; name: string; sent: number; replies: number }>;
  recentActivities: Array<{ id: string; summary: string; createdAt: string; activityType: string }>;
};

export type DashboardModel = {
  currency: string;
  discovered: number;
  qualified: number;
  contactable: number;
  drafted: number;
  sent: number;
  delivered: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  proposals: number;
  won: number;
  pipelineValue: number;
  leadSeries: Array<{ date: string; leads: number }>;
  outreachSeries: Array<{ date: string; sent: number; delivered: number; replies: number }>;
  funnel: Array<{ stage: string; label: string; count: number }>;
  pipeline: Array<{ stage: string; label: string; count: number; value: number }>;
  followups: DashboardSource["followups"];
  campaigns: DashboardSource["campaigns"];
  activities: DashboardSource["recentActivities"];
  recommendations: Array<{ title: string; detail: string }>;
};

const SENT_STATUSES = new Set(["sent", "delivered", "bounced"]);

export function aggregateDashboard(source: DashboardSource): DashboardModel {
  const { start, end } = source;
  const leads = source.leads.filter((lead) => inRange(lead.createdAt, start, end));
  const drafts = source.drafts.filter((draft) => inRange(draft.createdAt, start, end));
  const outbound = source.messages.filter((message) => message.direction === "outbound" && SENT_STATUSES.has(message.status) && inRange(message.createdAt, start, end));
  const inbound = source.messages.filter((message) => message.direction === "inbound" && inRange(message.createdAt, start, end));
  const delivered = source.events.filter((event) => event.eventType === "delivered" && inRange(event.occurredAt, start, end));
  const meetings = source.activities.filter((activity) => inRange(activity.createdAt, start, end) && activity.metadata?.to === "meeting_scheduled");
  const proposals = source.proposals.filter((proposal) => ["sent", "accepted"].includes(proposal.status) && inRange(proposal.sentAt || proposal.createdAt, start, end));
  const won = source.wonDeals.filter((deal) => inRange(deal.wonAt, start, end));
  const days = eachDay(start, end);

  const leadSeries = days.map((date) => ({ date, leads: leads.filter((lead) => lead.createdAt.slice(0, 10) === date).length }));
  const outreachSeries = days.map((date) => ({
    date,
    sent: outbound.filter((message) => message.createdAt.slice(0, 10) === date).length,
    delivered: delivered.filter((event) => event.occurredAt.slice(0, 10) === date).length,
    replies: inbound.filter((message) => message.createdAt.slice(0, 10) === date).length,
  }));

  const funnel = PIPELINE_STAGES.map((stage) => ({
    stage: stage.id,
    label: stage.label,
    count: leads.filter((lead) => lead.stage === stage.id).length,
  }));
  const pipelineMap = new Map<string, { count: number; value: number }>();
  for (const item of source.openPipeline.filter((row) => OPEN_STAGES.includes(row.stage as never))) {
    const current = pipelineMap.get(item.stage) ?? { count: 0, value: 0 };
    current.count += 1;
    current.value += item.value || 0;
    pipelineMap.set(item.stage, current);
  }
  const pipeline = OPEN_STAGES.map((stage) => ({
    stage,
    label: PIPELINE_STAGES.find((item) => item.id === stage)?.label ?? stage,
    count: pipelineMap.get(stage)?.count ?? 0,
    value: pipelineMap.get(stage)?.value ?? 0,
  }));

  const model: DashboardModel = {
    currency: source.currency,
    discovered: leads.length,
    qualified: leads.filter((lead) => QUALIFIED_STAGES.includes(lead.stage as never)).length,
    contactable: leads.filter((lead) => lead.contactable).length,
    drafted: drafts.length,
    sent: outbound.length,
    delivered: delivered.length,
    replies: inbound.length,
    positiveReplies: inbound.filter((message) => message.replyCategory && POSITIVE_REPLY_CATEGORIES.includes(message.replyCategory as never)).length,
    meetings: meetings.length,
    proposals: proposals.length,
    won: won.length,
    pipelineValue: pipeline.reduce((sum, item) => sum + item.value, 0),
    leadSeries,
    outreachSeries,
    funnel,
    pipeline,
    followups: source.followups,
    campaigns: [...source.campaigns].sort((a, b) => b.replies - a.replies || b.sent - a.sent).slice(0, 5),
    activities: source.recentActivities.slice(0, 8),
    recommendations: [],
  };
  model.recommendations = recommendFromMetrics(model);
  return model;
}

export function recommendFromMetrics(metrics: Pick<DashboardModel, "discovered" | "contactable" | "drafted" | "sent" | "replies" | "positiveReplies" | "meetings" | "proposals" | "pipelineValue" | "won">) {
  const items: Array<{ title: string; detail: string }> = [];
  if (metrics.discovered === 0) {
    items.push({ title: "Start lead discovery", detail: "No leads were created in this period. Run a configured search or import a CSV." });
  }
  if (metrics.discovered > 0 && metrics.contactable === 0) {
    items.push({ title: "Add business contacts", detail: "Leads exist, but none have a stored business email. Connect Hunter or Apollo, or import contacts." });
  }
  if (metrics.drafted > metrics.sent) {
    items.push({ title: "Review unsent drafts", detail: `${metrics.drafted - metrics.sent} more drafts were created than emails sent in this period.` });
  }
  if (metrics.sent > 0 && metrics.replies === 0) {
    items.push({ title: "Check outreach relevance", detail: "Emails were sent and no replies are stored yet. Review the audience, offer, and follow-up timing." });
  }
  if (metrics.positiveReplies > metrics.meetings) {
    items.push({ title: "Convert positive replies", detail: "Positive replies are ahead of booked meetings. Schedule the next conversation from the inbox." });
  }
  if (metrics.pipelineValue > 0 && metrics.proposals === 0) {
    items.push({ title: "Prepare proposals for open pipeline", detail: "Open pipeline value is recorded, and no proposal was marked sent in this period." });
  }
  if (metrics.won === 0 && metrics.proposals > 0) {
    items.push({ title: "Follow proposals", detail: "Proposals were sent in this period and no won deal was recorded." });
  }
  if (items.length === 0) {
    items.push({ title: "Keep the current cadence", detail: "Discovery, contact coverage, and outreach activity are all present in this period." });
  }
  return items.slice(0, 4);
}

export function toCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}
