import { createAdminClient } from "@/lib/supabase/admin";
import { verifyResendWebhook } from "@/lib/email/transport";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const body = await request.text();
  if (!secret) return Response.json({ ok: false, error: "RESEND_WEBHOOK_SECRET is not configured." }, { status: 401 });
  const verified = verifyResendWebhook(secret, {
    id: request.headers.get("svix-id") || "",
    timestamp: request.headers.get("svix-timestamp") || "",
    signature: request.headers.get("svix-signature") || "",
  }, body);
  if (!verified) return Response.json({ ok: false, error: "Invalid webhook signature." }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return Response.json({ ok: false, error: "Service role is not configured." }, { status: 500 });
  const event = JSON.parse(body) as { type?: string; data?: { email_id?: string } };
  const eventType = event.type === "email.delivered" ? "delivered" : event.type === "email.bounced" ? "bounced" : event.type === "email.complained" ? "complained" : null;
  if (!eventType || !event.data?.email_id) return Response.json({ ok: true, ignored: true });
  const { data: message } = await admin.from("email_messages").select("id, workspace_id, to_email").eq("provider_message_id", event.data.email_id).maybeSingle();
  if (!message) return Response.json({ ok: true, matched: false });
  await admin.from("email_events").insert({ workspace_id: message.workspace_id, message_id: message.id, event_type: eventType, payload: event.data });
  if (eventType === "delivered") await admin.from("email_messages").update({ status: "delivered" }).eq("id", message.id);
  if (eventType === "bounced") {
    await admin.from("email_messages").update({ status: "bounced" }).eq("id", message.id);
    if (message.to_email) await admin.from("suppression_list").upsert({ workspace_id: message.workspace_id, email: message.to_email, reason: "bounce", source: "resend" }, { onConflict: "workspace_id,email" });
  }
  if (eventType === "complained" && message.to_email) {
    await admin.from("suppression_list").upsert({ workspace_id: message.workspace_id, email: message.to_email, reason: "complaint", source: "resend" }, { onConflict: "workspace_id,email" });
  }
  return Response.json({ ok: true });
}
