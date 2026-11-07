import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/auth/session";
import { aggregateDashboard } from "@/lib/dashboard-metrics";
import { resolveDateRange } from "@/lib/dates";

export async function loadDashboard(session: AppSession, rangeKey?: string, from?: string, to?: string) {
  const fetched = await fetchDashboard(session.supabase, session.workspaceId, rangeKey, from, to);
  if ("error" in fetched) return fetched;
  return { range: fetched.range, model: aggregateDashboard({ ...fetched.input, currency: session.settings.currency }) };
}

export async function fetchDashboard(supabase: SupabaseClient, workspaceId: string, rangeKey?: string, from?: string, to?: string) {
  const range = resolveDateRange(rangeKey, from, to);
  if ("error" in range) return { error: range.error };
  const start = range.start;
  const [leads, drafts, messages, events, activities, proposals, deals, followups, campaigns, recent, openLeads, outbound, replies] = await Promise.all([
    supabase.from("leads").select("id, stage, deal_value, created_at, company:companies(name), primary_contact:contacts!leads_primary_contact_id_fkey(email)").eq("workspace_id", workspaceId).gte("created_at", start).lte("created_at", range.end),
    supabase.from("email_drafts").select("created_at").eq("workspace_id", workspaceId).gte("created_at", start).lte("created_at", range.end),
    supabase.from("email_messages").select("created_at, direction, status, reply_category").eq("workspace_id", workspaceId).gte("created_at", start).lte("created_at", range.end),
    supabase.from("email_events").select("occurred_at, event_type").eq("workspace_id", workspaceId).gte("occurred_at", start).lte("occurred_at", range.end),
    supabase.from("lead_activities").select("created_at, activity_type, summary, metadata").eq("workspace_id", workspaceId).gte("created_at", start).lte("created_at", range.end),
    supabase.from("proposals").select("created_at, sent_at, status").eq("workspace_id", workspaceId),
    supabase.from("deals").select("won_at, value, stage").eq("workspace_id", workspaceId),
    supabase.from("leads").select("id, stage, next_follow_up, company:companies(name)").eq("workspace_id", workspaceId).not("next_follow_up", "is", null).order("next_follow_up").limit(6),
    supabase.from("campaigns").select("id, name").eq("workspace_id", workspaceId).limit(20),
    supabase.from("lead_activities").select("id, summary, created_at, activity_type").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(8),
    supabase.from("leads").select("stage, deal_value").eq("workspace_id", workspaceId).in("stage", ["qualified", "contacted", "replied", "meeting_scheduled", "proposal_sent", "negotiation"]),
    supabase.from("email_messages").select("campaign_id").eq("workspace_id", workspaceId).eq("direction", "outbound").not("campaign_id", "is", null),
    supabase.from("campaign_leads").select("campaign_id").eq("workspace_id", workspaceId).eq("status", "replied"),
  ]);
  const error = [leads, drafts, messages, events, activities, proposals, deals, openLeads, outbound, replies].find((result) => result.error)?.error;
  if (error) return { error: error.message };
  const sentByCampaign = countBy(outbound.data ?? [], "campaign_id");
  const repliesByCampaign = countBy(replies.data ?? [], "campaign_id");
  return {
    range,
    input: {
      start: range.start,
      end: range.end,
      leads: (leads.data ?? []).map((lead) => ({ id: lead.id, stage: lead.stage, dealValue: Number(lead.deal_value || 0), createdAt: lead.created_at, contactable: Boolean(emailOf(lead.primary_contact)) })),
      drafts: (drafts.data ?? []).map((draft) => ({ createdAt: String(draft.created_at) })),
      messages: (messages.data ?? []).map((message) => ({ createdAt: String(message.created_at), direction: message.direction === "inbound" ? "inbound" as const : "outbound" as const, status: String(message.status), replyCategory: message.reply_category as string | null })),
      events: (events.data ?? []).map((event) => ({ occurredAt: event.occurred_at, eventType: event.event_type })),
      activities: (activities.data ?? []).map((activity) => ({ createdAt: activity.created_at, activityType: activity.activity_type, summary: activity.summary, metadata: activity.metadata })),
      proposals: (proposals.data ?? []).map((proposal) => ({ createdAt: proposal.created_at, sentAt: proposal.sent_at, status: proposal.status })),
      wonDeals: (deals.data ?? []).filter((deal) => deal.won_at).map((deal) => ({ wonAt: deal.won_at, value: Number(deal.value || 0) })),
      openPipeline: (openLeads.data ?? []).map((lead) => ({ stage: lead.stage, value: Number(lead.deal_value || 0) })),
      followups: (followups.data ?? []).map((lead) => ({ id: lead.id, company: companyName(lead.company), due: lead.next_follow_up, stage: lead.stage })),
      campaigns: (campaigns.data ?? []).map((campaign) => ({ id: campaign.id, name: campaign.name, sent: sentByCampaign.get(campaign.id) ?? 0, replies: repliesByCampaign.get(campaign.id) ?? 0 })),
      recentActivities: (recent.data ?? []).map((activity) => ({ id: activity.id, summary: activity.summary, createdAt: activity.created_at, activityType: activity.activity_type })),
    },
  };
}

function companyName(value: { name?: string } | { name?: string }[] | null) {
  const company = Array.isArray(value) ? value[0] : value;
  return company?.name || "Company";
}

function emailOf(value: { email?: string | null } | { email?: string | null }[] | null) {
  const contact = Array.isArray(value) ? value[0] : value;
  return contact?.email || "";
}

function countBy(rows: Array<{ campaign_id?: string | null }>, key: "campaign_id") {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
