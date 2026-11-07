import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/auth/session";
import { evaluateSend } from "@/lib/compliance";
import { refreshGmailToken, sendWithGmail, sendWithResend, unsubscribeToken, unsubscribeUrl } from "@/lib/email/transport";
import { resolveProvider } from "@/lib/integrations/credentials";
import { PIPELINE_STAGES } from "@/lib/constants";

export async function deliverDraft(session: AppSession, draftId: string, automated = false) {
  const { data: draft, error } = await session.supabase.from("email_drafts").select("*").eq("id", draftId).eq("workspace_id", session.workspaceId).single();
  if (error || !draft) return { ok: false as const, error: error?.message || "Draft not found." };
  const { data: lead } = await session.supabase.from("leads").select("*, company:companies(name, country)").eq("id", draft.lead_id).single();
  const { data: contact } = draft.contact_id
    ? await session.supabase.from("contacts").select("*").eq("id", draft.contact_id).maybeSingle()
    : await session.supabase.from("contacts").select("*").eq("id", lead?.primary_contact_id ?? "").maybeSingle();
  const email = String(contact?.email || "").toLowerCase();
  const campaign = draft.campaign_id
    ? (await session.supabase.from("campaigns").select("*").eq("id", draft.campaign_id).maybeSingle()).data
    : null;
  const [{ count: suppressed }, { count: duplicate }, { data: lastMessage }, { count: dailyCount }] = await Promise.all([
    session.supabase.from("suppression_list").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspaceId).eq("email", email),
    draft.sequence_step_id
      ? session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("lead_id", draft.lead_id).eq("sequence_step_id", draft.sequence_step_id).in("status", ["queued", "scheduled", "sent", "delivered"])
      : draft.campaign_id
        ? session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("lead_id", draft.lead_id).eq("campaign_id", draft.campaign_id).is("sequence_step_id", null).in("status", ["queued", "scheduled", "sent", "delivered"])
        : Promise.resolve({ count: 0 }),
    session.supabase.from("email_messages").select("sent_at").eq("workspace_id", session.workspaceId).eq("to_email", email).eq("direction", "outbound").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    session.supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspaceId).eq("direction", "outbound").gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).in("status", ["queued", "sent", "delivered"]),
  ]);
  const sender = await resolveSender(session);
  const company = Array.isArray(lead?.company) ? lead.company[0] : lead?.company;
  const check = evaluateSend({
    eligible: Boolean(lead?.outreach_eligible),
    lawfulBasis: lead?.lawful_basis,
    requireLawfulBasis: session.settings.compliance.require_lawful_basis !== false,
    suppressed: (suppressed ?? 0) > 0,
    unsubscribed: Boolean(contact?.unsubscribed_at),
    duplicate: (duplicate ?? 0) > 0,
    campaignApproved: campaign ? ["approved", "scheduled", "sending"].includes(campaign.status) : !automated,
    draftApproved: draft.status === "approved" || draft.status === "scheduled",
    requireManualApproval: session.settings.require_manual_approval,
    automated,
    allowAutomatedSend: Boolean(campaign?.allow_automated_send),
    dailyCount: dailyCount ?? 0,
    dailyLimit: Math.min(session.settings.daily_send_limit, campaign?.daily_limit ?? session.settings.daily_send_limit),
    lastSentAt: lastMessage?.sent_at ?? null,
    minHours: session.settings.min_hours_between_emails,
    country: company?.country ?? null,
    allowedCountries: session.settings.compliance.allowed_countries ?? [],
    hasRecipient: Boolean(email),
    hasSender: sender.ok,
    acknowledgements: {
      dpdp: session.settings.compliance.dpdp_acknowledged,
      gdpr: session.settings.compliance.gdpr_acknowledged,
      canSpam: session.settings.compliance.can_spam_acknowledged,
      trai: session.settings.compliance.trai_acknowledged,
    },
  });
  if (!check.ok || !sender.ok) return { ok: false as const, error: check.reasons.concat(sender.ok ? [] : [sender.error]).join(" ") };

  const token = unsubscribeToken();
  const link = unsubscribeUrl(token);
  const body = session.settings.compliance.include_unsubscribe === false || draft.body.includes(link)
    ? draft.body
    : `${draft.body}\n\nUnsubscribe: ${link}`;
  const address = session.settings.compliance.include_physical_address === false ? "" : session.company.mailing_address;
  const fullBody = address && !body.includes(address) ? `${body}\n${address}` : body;
  let providerMessageId = "";
  const provider = sender.provider;
  try {
    if (sender.provider === "gmail") {
      const sent = await sendWithGmail({ accessToken: sender.accessToken, from: sender.from, to: email, subject: draft.subject, body: fullBody, unsubscribeUrl: link });
      providerMessageId = sent.providerMessageId;
    } else {
      const sent = await sendWithResend({ apiKey: sender.apiKey, from: sender.from, to: email, subject: draft.subject, body: fullBody, unsubscribeUrl: link });
      providerMessageId = sent.providerMessageId;
    }
  } catch (sendError) {
    await session.supabase.from("email_messages").insert({
      workspace_id: session.workspaceId,
      lead_id: draft.lead_id,
      contact_id: contact?.id ?? null,
      campaign_id: draft.campaign_id,
      draft_id: draft.id,
      sequence_step_id: draft.sequence_step_id,
      direction: "outbound",
      provider,
      from_email: sender.from,
      to_email: email,
      subject: draft.subject,
      body_text: fullBody,
      status: "failed",
      metadata: { error: sendError instanceof Error ? sendError.message : "Send failed" },
    });
    return { ok: false as const, error: sendError instanceof Error ? sendError.message : "Send failed." };
  }

  await session.supabase.from("email_messages").insert({
    workspace_id: session.workspaceId,
    account_id: sender.accountId,
    lead_id: draft.lead_id,
    contact_id: contact?.id ?? null,
    campaign_id: draft.campaign_id,
    draft_id: draft.id,
    sequence_step_id: draft.sequence_step_id,
    direction: "outbound",
    provider,
    provider_message_id: providerMessageId,
    from_email: sender.from,
    to_email: email,
    subject: draft.subject,
    body_text: fullBody,
    status: "sent",
    sent_at: new Date().toISOString(),
    unsubscribe_token: token,
  });
  await session.supabase.from("email_drafts").update({ status: "sent" }).eq("id", draft.id);
  if (draft.campaign_id) {
    await session.supabase.from("campaign_leads").update({ status: "sent" }).eq("campaign_id", draft.campaign_id).eq("lead_id", draft.lead_id);
  }
  const current = PIPELINE_STAGES.findIndex((stage) => stage.id === lead?.stage);
  const contacted = PIPELINE_STAGES.findIndex((stage) => stage.id === "contacted");
  if (lead && current >= 0 && current < contacted) {
    await session.supabase.from("leads").update({ stage: "contacted" }).eq("id", lead.id);
    await session.supabase.from("lead_activities").insert({
      workspace_id: session.workspaceId,
      lead_id: lead.id,
      actor_id: session.userId,
      activity_type: "stage_changed",
      summary: "Email sent. Stage moved to Contacted.",
      metadata: { to: "contacted" },
    });
  }
  await session.supabase.from("lead_activities").insert({
    workspace_id: session.workspaceId,
    lead_id: draft.lead_id,
    actor_id: session.userId,
    activity_type: "email_sent",
    summary: `Sent “${draft.subject}” to ${email} through ${provider}.`,
    metadata: { provider, provider_message_id: providerMessageId },
  });
  await session.supabase.from("audit_logs").insert({
    workspace_id: session.workspaceId,
    actor_id: session.userId,
    action: "email.sent",
    entity_type: "email_draft",
    entity_id: draft.id,
    metadata: { provider, to: email },
  });
  return { ok: true as const };
}

async function resolveSender(session: AppSession): Promise<
  | { ok: true; provider: "gmail"; from: string; accessToken: string; accountId: string | null }
  | { ok: true; provider: "resend"; from: string; apiKey: string; accountId: string | null }
  | { ok: false; error: string }
> {
  const gmail = await resolveProvider(session.admin, session.workspaceId, "gmail");
  if (gmail.configured && gmail.values.refreshToken && gmail.values.clientId && gmail.values.clientSecret) {
    try {
      const accessToken = await refreshGmailToken({
        clientId: gmail.values.clientId,
        clientSecret: gmail.values.clientSecret,
        refreshToken: gmail.values.refreshToken,
      });
      const { data: account } = await session.supabase.from("email_accounts").select("id, email_address").eq("workspace_id", session.workspaceId).eq("provider", "gmail").eq("status", "connected").maybeSingle();
      return { ok: true, provider: "gmail", from: account?.email_address || gmail.values.email || session.company.email || "", accessToken, accountId: account?.id ?? null };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Gmail is connected but the token could not be refreshed." };
    }
  }
  const resend = await resolveProvider(session.admin, session.workspaceId, "resend");
  if (resend.configured && resend.values.apiKey && resend.values.fromEmail) {
    const { data: account } = await session.supabase.from("email_accounts").select("id").eq("workspace_id", session.workspaceId).eq("provider", "resend").maybeSingle();
    return { ok: true, provider: "resend", from: resend.values.fromEmail, apiKey: resend.values.apiKey, accountId: account?.id ?? null };
  }
  return { ok: false, error: "Connect Gmail or Resend before sending email." };
}

export async function recordReply(supabase: SupabaseClient, input: {
  workspaceId: string;
  userId: string | null;
  leadId: string;
  contactId?: string | null;
  fromEmail: string;
  subject: string;
  body: string;
  category: string;
  classifier: "rules" | "ai" | "manual";
  provider?: string;
  providerMessageId?: string;
}) {
  const { error } = await supabase.from("email_messages").insert({
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    contact_id: input.contactId ?? null,
    direction: "inbound",
    provider: input.provider ?? "manual",
    provider_message_id: input.providerMessageId ?? null,
    from_email: input.fromEmail,
    subject: input.subject,
    body_text: input.body,
    status: "received",
    reply_category: input.category,
    reply_classifier: input.classifier,
  });
  if (error) throw new Error(error.message);
  await supabase.from("leads").update({ stage: input.category === "not_interested" ? "lost" : "replied" }).eq("id", input.leadId);
  await supabase.from("lead_activities").insert({
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    actor_id: input.userId,
    activity_type: "reply_received",
    summary: `Reply categorized as ${input.category.replaceAll("_", " ")} by ${input.classifier}.`,
    metadata: { category: input.category, classifier: input.classifier },
  });
  if (input.category === "unsubscribe") {
    await supabase.from("suppression_list").upsert({
      workspace_id: input.workspaceId,
      email: input.fromEmail.toLowerCase(),
      reason: "unsubscribe",
      source: input.classifier,
    }, { onConflict: "workspace_id,email" });
    await supabase.from("contacts").update({ unsubscribed_at: new Date().toISOString() }).eq("workspace_id", input.workspaceId).ilike("email", input.fromEmail);
    await supabase.from("sequence_enrollments").update({ status: "stopped", stop_reason: "Recipient unsubscribed." }).eq("lead_id", input.leadId).in("status", ["active", "waiting"]);
  }
  if (input.category === "not_interested") {
    await supabase.from("sequence_enrollments").update({ status: "stopped", stop_reason: "Recipient is not interested." }).eq("lead_id", input.leadId).in("status", ["active", "waiting"]);
  } else {
    await supabase.from("sequence_enrollments").update({ status: "stopped", stop_reason: "A reply was received." }).eq("lead_id", input.leadId).eq("status", "active");
  }
}
