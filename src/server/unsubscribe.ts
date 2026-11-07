"use server";

import { createAdminClient } from "@/lib/supabase/admin";

export async function confirmUnsubscribe(token: string) {
  const admin = createAdminClient();
  if (!admin) throw new Error("Unsubscribe handling is not configured.");
  const { data } = await admin.from("email_messages").select("id, workspace_id, to_email, lead_id").eq("unsubscribe_token", token).maybeSingle();
  if (!data?.to_email) throw new Error("This unsubscribe link is not recognized.");
  await admin.from("suppression_list").upsert({ workspace_id: data.workspace_id, email: data.to_email.toLowerCase(), reason: "unsubscribe", source: "link" }, { onConflict: "workspace_id,email" });
  await admin.from("contacts").update({ unsubscribed_at: new Date().toISOString() }).eq("workspace_id", data.workspace_id).ilike("email", data.to_email);
  await admin.from("email_events").insert({ workspace_id: data.workspace_id, message_id: data.id, event_type: "unsubscribed", payload: { email: data.to_email } });
  if (data.lead_id) await admin.from("sequence_enrollments").update({ status: "stopped", stop_reason: "Recipient unsubscribed." }).eq("lead_id", data.lead_id);
}
