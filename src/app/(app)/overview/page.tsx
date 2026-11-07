import Link from "next/link";
import { Suspense } from "react";
import { LeadChart, OutreachChart } from "@/components/dashboard/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/feedback";
import { requireReady } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/data/dashboard";
import { currency, titleCase } from "@/lib/utils";

export default function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading overview…</p>}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const session = await requireReady();
  const result = await loadDashboard(session, params.range, params.from, params.to);
  if ("error" in result) return <p className="text-sm text-red-600">{result.error}</p>;
  const { model, range } = result;
  const metrics = [
    ["Discovered leads", model.discovered, "Created in the selected period"],
    ["Qualified leads", model.qualified, "Qualified or later, created in the period"],
    ["Contactable leads", model.contactable, "Have a stored business email"],
    ["Emails drafted", model.drafted, "Drafts created in the period"],
    ["Emails sent", model.sent, "Accepted by an email provider"],
    ["Emails delivered", model.delivered, "Delivery events only"],
    ["Replies received", model.replies, "Stored inbound messages"],
    ["Positive replies", model.positiveReplies, "Interested, meeting, pricing, or more info"],
    ["Meetings booked", model.meetings, "Stage changes to Meeting Scheduled"],
    ["Proposals sent", model.proposals, "Marked sent in the period"],
    ["Deals won", model.won, "Won dates in the period"],
    ["Open pipeline", currency(model.pipelineValue, model.currency), "Current open stages, not filtered by date"],
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description={`${session.workspaceName} · ${range.label}. Counts come from saved records.`}>
        <div className="flex flex-wrap items-center gap-2">
          {["today", "7d", "30d", "90d"].map((value) => <Link key={value} href={`/overview?range=${value}`} className="rounded-md border bg-white px-3 py-2 text-sm">{value === "today" ? "Today" : value === "7d" ? "Last 7 days" : value === "30d" ? "Last 30 days" : "Last 90 days"}</Link>)}
          <form action="/overview" className="flex gap-2">
            <input type="hidden" name="range" value="custom" />
            <input type="date" name="from" required className="h-10 rounded-md border px-2 text-sm" aria-label="Start date" />
            <input type="date" name="to" required className="h-10 rounded-md border px-2 text-sm" aria-label="End date" />
            <button className="rounded-md border bg-white px-3 text-sm">Apply</button>
          </form>
        </div>
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, hint]) => <Stat key={label} label={label} value={String(value)} hint={hint} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Lead acquisition</CardTitle></CardHeader><CardContent><LeadChart data={model.leadSeries} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Outreach performance</CardTitle></CardHeader><CardContent><OutreachChart data={model.outreachSeries} /></CardContent></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><CardTitle>Conversion funnel</CardTitle></CardHeader><CardContent className="space-y-2">{model.funnel.map((item) => <div key={item.stage} className="flex items-center justify-between text-sm"><span>{item.label}</span><span className="font-medium">{item.count}</span></div>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Sales pipeline</CardTitle></CardHeader><CardContent className="space-y-2">{model.pipeline.map((item) => <div key={item.stage} className="flex items-center justify-between text-sm"><span>{item.label}</span><span>{item.count} · {currency(item.value, model.currency)}</span></div>)}</CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Recent activity</CardTitle></CardHeader><CardContent className="space-y-3">{model.activities.length ? model.activities.map((item) => <p key={item.id} className="text-sm"><span className="font-medium">{titleCase(item.activityType)}</span> · {item.summary}</p>) : <p className="text-sm text-muted-foreground">No activity yet.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Upcoming follow-ups</CardTitle></CardHeader><CardContent className="space-y-3">{model.followups.length ? model.followups.map((item) => <Link key={item.id} href={`/leads/${item.id}`} className="block text-sm"><span className="font-medium">{item.company}</span> · {item.due}</Link>) : <p className="text-sm text-muted-foreground">No follow-up dates are set.</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Recommendations</CardTitle></CardHeader><CardContent className="space-y-3">{model.recommendations.map((item) => <div key={item.title}><p className="text-sm font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{item.detail}</p></div>)}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle>Top campaigns</CardTitle></CardHeader><CardContent>{model.campaigns.length ? model.campaigns.map((campaign) => <p key={campaign.id} className="text-sm">{campaign.name}: {campaign.sent} sent, {campaign.replies} replied</p>) : <p className="text-sm text-muted-foreground">No campaigns yet.</p>}</CardContent></Card>
    </div>
  );
}
