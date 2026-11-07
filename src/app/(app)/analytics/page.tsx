import Link from "next/link";
import { Suspense } from "react";
import { requireReady } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/data/dashboard";
import { PageHeader, Stat } from "@/components/ui/feedback";

export default function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading analytics…</p>}>
      <Analytics searchParams={searchParams} />
    </Suspense>
  );
}

async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const session = await requireReady();
  const result = await loadDashboard(session, params.range || "90d");
  if ("error" in result) return <p className="text-sm text-red-600">{result.error}</p>;
  const { data: companies } = await session.supabase.from("companies").select("industry, country").eq("workspace_id", session.workspaceId);
  const industries = countBy(companies ?? [], "industry");
  const countries = countBy(companies ?? [], "country");
  const model = result.model;
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics & Reports" description="Figures are aggregated from workspace records for the last 90 days unless noted.">
        <Link className="rounded-md bg-primary px-3 py-2 text-sm text-white" href="/api/analytics/export">Export CSV</Link>
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Discovered" value={String(model.discovered)} />
        <Stat label="Qualified" value={String(model.qualified)} />
        <Stat label="Reply rate" value={model.sent ? `${Math.round((model.replies / model.sent) * 100)}%` : "0%"} hint="Replies divided by sent emails" />
        <Stat label="Positive reply rate" value={model.sent ? `${Math.round((model.positiveReplies / model.sent) * 100)}%` : "0%"} />
        <Stat label="Meetings" value={String(model.meetings)} />
        <Stat label="Proposals" value={String(model.proposals)} />
        <Stat label="Won deals" value={String(model.won)} />
        <Stat label="Open pipeline" value={String(model.pipelineValue)} />
      </div>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-5"><h2 className="font-medium">Industries</h2>{industries.map((item) => <p key={item.label} className="mt-2 text-sm">{item.label}: {item.count}</p>)}</div>
        <div className="rounded-lg border bg-white p-5"><h2 className="font-medium">Countries</h2>{countries.map((item) => <p key={item.label} className="mt-2 text-sm">{item.label}: {item.count}</p>)}</div>
      </section>
    </div>
  );
}

function countBy(rows: Array<Record<string, string | null>>, key: string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = row[key] || "Unknown";
    map.set(label, (map.get(label) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
