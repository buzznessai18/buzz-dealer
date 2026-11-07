import { requireReady } from "@/lib/auth/session";
import { toCsv } from "@/lib/dashboard-metrics";

export async function GET() {
  const session = await requireReady();
  const { data, error } = await session.supabase.from("leads").select("stage, source, deal_value, probability, created_at, company:companies(name, country, industry, domain)").eq("workspace_id", session.workspaceId);
  if (error) return new Response(error.message, { status: 500 });
  const csv = toCsv((data ?? []).map((lead) => {
    const company = Array.isArray(lead.company) ? lead.company[0] : lead.company;
    return { company: company?.name, domain: company?.domain, industry: company?.industry, country: company?.country, stage: lead.stage, source: lead.source, deal_value: lead.deal_value, probability: lead.probability, created_at: lead.created_at };
  }));
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=growthpilot-leads.csv" } });
}
