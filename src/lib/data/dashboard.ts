import type { AppSession } from "@/lib/auth/session";
import { aggregateDashboard } from "@/lib/dashboard-metrics";
import { resolveDateRange } from "@/lib/dates";

export async function loadDashboard(session: AppSession, rangeKey?: string, from?: string, to?: string) {
  const range = resolveDateRange(rangeKey, from, to);
  if ("error" in range) return { error: range.error };
  const start = range.start;
  const [leads, drafts, messages, events, activities, proposals, deals, followups, campaigns, recent] = await Promise.all([
    session.supabase.from("leads").select("id, stage, deal_value, created_at, primary_contact_id, company:companies(name)").eq("workspace_id", session.workspaceId).gte("created_at", start).lte("created_at", range.end),
    session.supabase.from("email_drafts").select("created_at").eq("workspace_id", session.workspaceId).gte("created_at", start).lte("created_at", range.end),
    session.supabase.from("email_messages").select("created_at, direction, status, reply_category").eq("workspace_id", session.workspaceId).gte("created_at", start).lte("created_at", range.end),
    session.supabase.from("email_events").select("occurred_at, event_type").eq("workspace_id", session.workspaceId).gte("occurred_at", start).lte("occurred_at", range.end),
    session.supabase.from("lead_activities").select("created_at, activity_type, summary, metadata").eq("workspace_id", session.workspaceId).gte("created_at", start).lte("created_at", range.end),
    session.supabase.from("proposals").select("created_at, sent_at, status").eq("workspace_id", session.workspaceId),
    session.supabase.from("deals").select("won_at, value, stage").eq("workspace_id", session.workspaceId),
    session.supabase.from("leads").select("id, stage, next_follow_up, company:companies(name)").eq("workspace_id", session.workspaceId).not("next_follow_up", "is", null).order("next_follow_up").limit(6),
    session.supabase.from("campaigns").select("id, name").eq("workspace_id", session.workspaceId).limit(20),
    session.supabase.from("lead_activities").select("id, summary, created_at, activity_type").eq("workspace_id", session.workspaceId).order("created_at", { ascending: false }).limit(8),
  ]);
  const error = [leads, drafts, messages, events, activities, proposals, deals].find((result) => result.error)?.error;
  if (error) return { error: error.message };
  const contactIds = (leads.data ?? []).map((lead) => lead.primary_contact_id).filter(Boolean);
  const { data: contacts } = contactIds.length
    ? await session.supabase.from("contacts").select("id, email").in("id", contactIds)
    : { data: [] };
  const contactable = new Set((contacts ?? []).filter((contact) => contact.email).map((contact) => contact.id));
  const campaignStats = await Promise.all((campaigns.data ?? []).map(async (campaign) => {
    const [{ count: sent }, { count: replies }] = await Promise.all([
      session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("direction", "outbound"),
      session.supabase.from("campaign_leads").select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "replied"),
    ]);
    return { id: campaign.id, name: campaign.name, sent: sent ?? 0, replies: replies ?? 0 };
  }));
  const openLeads = await session.supabase.from("leads").select("stage, deal_value").eq("workspace_id", session.workspaceId).in("stage", ["qualified", "contacted", "replied", "meeting_scheduled", "proposal_sent", "negotiation"]);
  return {
    range,
    model: aggregateDashboard({
      start: range.start,
      end: range.end,
      currency: session.settings.currency,
      leads: (leads.data ?? []).map((lead) => ({ id: lead.id, stage: lead.stage, dealValue: Number(lead.deal_value || 0), createdAt: lead.created_at, contactable: contactable.has(lead.primary_contact_id) })),
      drafts: (drafts.data ?? []).map((draft) => ({ createdAt: String(draft.created_at) })),
      messages: (messages.data ?? []).map((message) => ({ createdAt: String(message.created_at), direction: message.direction === "inbound" ? "inbound" as const : "outbound" as const, status: String(message.status), replyCategory: message.reply_category as string | null })),
      events: (events.data ?? []).map((event) => ({ occurredAt: event.occurred_at, eventType: event.event_type })),
      activities: (activities.data ?? []).map((activity) => ({ createdAt: activity.created_at, activityType: activity.activity_type, summary: activity.summary, metadata: activity.metadata })),
      proposals: (proposals.data ?? []).map((proposal) => ({ createdAt: proposal.created_at, sentAt: proposal.sent_at, status: proposal.status })),
      wonDeals: (deals.data ?? []).filter((deal) => deal.won_at).map((deal) => ({ wonAt: deal.won_at, value: Number(deal.value || 0) })),
      openPipeline: (openLeads.data ?? []).map((lead) => ({ stage: lead.stage, value: Number(lead.deal_value || 0) })),
      followups: (followups.data ?? []).map((lead) => ({ id: lead.id, company: companyName(lead.company), due: lead.next_follow_up, stage: lead.stage })),
      campaigns: campaignStats,
      recentActivities: (recent.data ?? []).map((activity) => ({ id: activity.id, summary: activity.summary, createdAt: activity.created_at, activityType: activity.activity_type })),
    }),
  };
}

function companyName(value: { name?: string } | { name?: string }[] | null) {
  const company = Array.isArray(value) ? value[0] : value;
  return company?.name || "Company";
}
