import { isSupabaseConfigured, isServiceRoleConfigured } from "@/lib/env";

export default function SetupPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Connect GrowthPilot</h1>
      <p className="mt-3 text-muted-foreground">The application shell is ready. Workspace data stays unavailable until Supabase is configured.</p>
      <ul className="mt-6 space-y-3 text-sm">
        <li>Supabase URL and anon key: {isSupabaseConfigured() ? "configured" : "missing"}</li>
        <li>Service role key: {isServiceRoleConfigured() ? "configured" : "missing — required for integration secrets and scheduled jobs"}</li>
        <li>Apply `supabase/migrations/20261107120000_init.sql` in the Supabase SQL editor.</li>
        <li>Copy `.env.example` to `.env.local` and restart the server.</li>
      </ul>
    </main>
  );
}
