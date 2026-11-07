export type DateRangeKey = "today" | "7d" | "30d" | "90d" | "custom";

export type DateRange = {
  key: DateRangeKey;
  label: string;
  start: string;
  end: string;
};

function iso(date: Date) {
  return date.toISOString();
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function resolveDateRange(
  range: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): DateRange | { error: string } {
  const end = now;
  if (!range || range === "30d") {
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { key: "30d", label: "Last 30 days", start: iso(start), end: iso(end) };
  }
  if (range === "today") {
    return { key: "today", label: "Today", start: iso(startOfUtcDay(end)), end: iso(end) };
  }
  if (range === "7d") {
    return { key: "7d", label: "Last 7 days", start: iso(new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)), end: iso(end) };
  }
  if (range === "90d") {
    return { key: "90d", label: "Last 90 days", start: iso(new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000)), end: iso(end) };
  }
  if (range === "custom") {
    if (!from || !to) return { error: "Choose both a start and an end date." };
    const start = new Date(`${from}T00:00:00.000Z`);
    const finish = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime())) {
      return { error: "The custom date range is not valid." };
    }
    if (start > finish) return { error: "The start date must be before the end date." };
    return { key: "custom", label: `${from} to ${to}`, start: iso(start), end: iso(finish) };
  }
  return { error: "Unknown date range." };
}

export function inRange(value: string | null | undefined, start: string, end: string) {
  if (!value) return false;
  return value >= start && value <= end;
}

export function dayKey(value: string) {
  return value.slice(0, 10);
}

export function eachDay(startIso: string, endIso: string) {
  const days: string[] = [];
  const cursor = startOfUtcDay(new Date(startIso));
  const last = startOfUtcDay(new Date(endIso));
  while (cursor <= last && days.length < 370) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
