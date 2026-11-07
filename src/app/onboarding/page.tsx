import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth/session";
import { createWorkspace } from "@/server/actions";
import { OnboardingForm } from "@/components/onboarding-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted-foreground">Loading account…</main>}>
      <Onboarding />
    </Suspense>
  );
}

async function Onboarding() {
  const state = await getSessionState();
  if (state.status === "anonymous" || state.status === "unconfigured") redirect("/login");
  if (state.status === "error") return <main className="p-8 text-sm text-red-600">{state.message}</main>;
  if (state.status === "ready" && state.session.company.onboarding_completed) redirect("/overview");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Set up your company</h1>
      <p className="mt-2 text-sm text-muted-foreground">GrowthPilot uses this profile in outreach and marketing. It does not invent case studies.</p>
      {state.status === "needs-workspace" ? (
        <form action={createWorkspace} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
          <h2 className="font-medium">Create the workspace</h2>
          <Input name="name" required minLength={2} placeholder="Workspace name" aria-label="Workspace name" defaultValue={state.fullName ? `${state.fullName}'s workspace` : ""} />
          <Button type="submit">Create workspace</Button>
        </form>
      ) : (
        <div className="mt-8 rounded-xl border bg-white p-6">
          <OnboardingForm companyName={state.session.company.company_name} />
        </div>
      )}
    </main>
  );
}
