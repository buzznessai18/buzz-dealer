import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";

export default function HomePage() {
  const ready = isSupabaseConfigured();
  return (
    <main className="min-h-screen bg-sidebar text-white">
      <div className="mx-auto flex max-w-6xl flex-col px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary font-semibold">GP</div><span className="whitespace-nowrap font-semibold">GrowthPilot AI</span></div>
          <div className="flex gap-2 text-sm"><Link href="/login" className="whitespace-nowrap rounded-md px-3 py-2 hover:bg-white/10">Sign in</Link><Link href="/signup" className="whitespace-nowrap rounded-md bg-primary px-3 py-2">Create workspace</Link></div>
        </header>
        <section className="grid gap-10 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-blue-300">Internal business development platform</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Find clients, research them, and run outreach from one workspace.</h1>
            <p className="mt-5 max-w-2xl text-lg text-slate-300">GrowthPilot helps a software studio discover companies, match its catalog, prepare approved outreach, and measure the pipeline. It does not invent requirements or send email without a person and a lawful basis.</p>
            {!ready ? <p className="mt-6 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">Supabase is not configured yet. Add the keys in .env.local, apply the migration, then create the first account.</p> : null}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200">
            <p className="font-medium text-white">What the workspace tracks</p>
            <ul className="mt-4 space-y-3">
              {["Lead discovery and CSV import", "Fact and hypothesis research", "Catalog matching", "Approved email outreach", "Pipeline, proposals, and marketing drafts"].map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
