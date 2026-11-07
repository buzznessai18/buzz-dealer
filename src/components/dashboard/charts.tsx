"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function LeadChart({ data }: { data: Array<{ date: string; leads: number }> }) {
  if (!data.some((item) => item.leads > 0)) return <p className="text-sm text-muted-foreground">No leads were created in this period.</p>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="leads" stroke="#2563eb" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OutreachChart({ data }: { data: Array<{ date: string; sent: number; delivered: number; replies: number }> }) {
  if (!data.some((item) => item.sent || item.delivered || item.replies)) return <p className="text-sm text-muted-foreground">No outreach events are stored in this period.</p>;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="sent" fill="#2563eb" radius={3} />
          <Bar dataKey="delivered" fill="#0f766e" radius={3} />
          <Bar dataKey="replies" fill="#d97706" radius={3} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
