import { Suspense } from "react";
import { requireReady } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export const instant = false;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Loading workspace…</p>}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </Suspense>
  );
}

async function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const session = await requireReady();
  return (
    <AppShell
      workspaceName={session.workspaceName}
      workspaceId={session.workspaceId}
      workspaces={session.workspaces}
      userName={session.fullName}
      email={session.email}
    >
      {session.isDemo ? <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Demo workspace. Figures on these screens come from this workspace’s database records.</p> : null}
      {children}
    </AppShell>
  );
}
