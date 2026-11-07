import { NextResponse } from "next/server";
import { requireReady } from "@/lib/auth/session";
import { generateText, parseJsonObject } from "@/lib/ai/generate";
import { researchLead, generateDraft, createProposal, runDiscovery } from "@/server/actions";

export async function POST(request: Request) {
  const session = await requireReady();
  const body = await request.json();
  const message = String(body.message || "");
  const confirmation = body.confirmation as { tool?: string; args?: Record<string, string> } | undefined;
  if (confirmation?.tool) {
    const result = await executeConfirmed(confirmation.tool, confirmation.args ?? {}, session.workspaceId);
    return NextResponse.json({ reply: result });
  }
  const lower = message.toLowerCase();
  if (!process.env.OPENAI_API_KEY && session.company.ai_provider === "openai") {
    return NextResponse.json({ reply: await ruleReply(session.supabase, session.workspaceId, lower) });
  }
  try {
    const response = await generateText({
      supabase: session.supabase,
      admin: session.admin,
      workspaceId: session.workspaceId,
      userId: session.userId,
      provider: session.company.ai_provider,
      model: session.company.ai_model,
      feature: "assistant",
      json: true,
      monthlyLimit: session.settings.ai_monthly_token_limit,
      system: "You are GrowthPilot's assistant. Return JSON {reply, confirmation}. confirmation is null for read-only answers. For research, outreach drafts, discovery, or proposals set confirmation to {tool, args} and explain what will happen. Never claim an email was sent. Tools: research_lead {leadId}, generate_outreach {leadId}, create_proposal {leadId,title}, discover {query}. Use only the database summary supplied.",
      prompt: JSON.stringify({ message, summary: await workspaceSummary(session.supabase, session.workspaceId) }),
    });
    const parsed = parseJsonObject(response.text);
    return NextResponse.json({ reply: String(parsed.reply || "I could not answer that."), confirmation: parsed.confirmation || undefined });
  } catch (error) {
    return NextResponse.json({ reply: await ruleReply(session.supabase, session.workspaceId, lower) + (error instanceof Error ? `\n\nAI note: ${error.message}` : "") });
  }
}

async function executeConfirmed(tool: string, args: Record<string, string>, workspaceId: string) {
  if (tool === "research_lead" && args.leadId) {
    const result = await researchLead(args.leadId);
    return result.ok ? "Research saved." : result.error;
  }
  if (tool === "generate_outreach" && args.leadId) {
    const result = await generateDraft({ leadId: args.leadId, purpose: "cold", tone: "professional" });
    return result.ok ? "Draft saved. It was not sent." : result.error;
  }
  if (tool === "create_proposal" && args.title) {
    const result = await createProposal({ leadId: args.leadId, title: args.title });
    return result.ok ? "Proposal draft saved." : result.error;
  }
  if (tool === "discover") {
    const result = await runDiscovery({ mode: "company", countries: ["India"], keywords: args.query || "software", limit: 20, providers: ["google_search"], findEmails: false });
    return result.ok ? result.message || "Discovery finished." : result.error;
  }
  return `No confirmed action was available for ${tool} in workspace ${workspaceId}.`;
}

async function workspaceSummary(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, workspaceId: string) {
  const [{ count: leads }, { count: sent }, { data: followups }] = await Promise.all([
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("email_messages").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("direction", "outbound"),
    supabase.from("leads").select("id, company:companies(name)").eq("workspace_id", workspaceId).is("next_follow_up", null).limit(10),
  ]);
  return { leads: leads ?? 0, sent: sent ?? 0, missingFollowUp: (followups ?? []).map((lead) => (Array.isArray(lead.company) ? lead.company[0] : lead.company)?.name) };
}

async function ruleReply(supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, workspaceId: string, message: string) {
  const summary = await workspaceSummary(supabase, workspaceId);
  if (message.includes("follow")) return `Companies without a follow-up date: ${summary.missingFollowUp.filter(Boolean).join(", ") || "none"}.`;
  if (message.includes("campaign") || message.includes("summar")) return `The workspace has ${summary.leads} ${summary.leads === 1 ? "lead" : "leads"} and ${summary.sent} stored outbound ${summary.sent === 1 ? "email" : "emails"}. Open Analytics for the period breakdown.`;
  return "Natural-language answers need a configured AI provider. You can still use the module screens. Ask about follow-ups or campaign totals for a database answer without AI.";
}
