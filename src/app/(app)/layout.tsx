import { Suspense } from "react";
import { requireReady } from "@/lib/auth/session";
import { AppShell, WorkspaceSwitcher } from "@/components/layout/app-shell";
import { PageLoading } from "@/components/ui/feedback";

export const instant = false;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={<Suspense fallback={<div className="h-10 w-56 animate-pulse rounded bg-slate-100" />}><WorkspaceHeader /></Suspense>}>
      <Suspense fallback={null}><DemoNotice /></Suspense>
      <Suspense fallback={<PageLoading />}>{children}</Suspense>
    </AppShell>
  );
}

async function WorkspaceHeader() {
  const session = await requireReady();
  return (
    <>
      <WorkspaceSwitcher workspaceId={session.workspaceId} workspaceName={session.workspaceName} workspaces={session.workspaces} />
      <div className="text-right">
        <p className="text-sm font-medium">{session.fullName || "Member"}</p>
        <p className="max-w-40 truncate text-xs text-muted-foreground">{session.email}</p>
      </div>
    </>
  );
}

async function DemoNotice() {
  const session = await requireReady();
  if (!session.isDemo) return null;
  return <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Demo workspace. Figures on these screens come from this workspace’s database records.</p>;
}
