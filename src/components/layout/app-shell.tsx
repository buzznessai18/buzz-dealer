"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Bot, Building2, CalendarDays, ChevronLeft, FileText, Inbox, KanbanSquare,
  LayoutDashboard, Megaphone, Menu, Package, Plug, Search, Settings, Sparkles, Workflow, X,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { signOut, switchWorkspace } from "@/server/actions";

const ICONS = { LayoutDashboard, Search, Building2, Sparkles, Package, Megaphone, Inbox, KanbanSquare, Bot, CalendarDays, FileText, BarChart3, Plug, Workflow, Settings };

export function AppShell({
  workspaceName,
  workspaces,
  workspaceId,
  userName,
  email,
  children,
}: {
  workspaceName: string;
  workspaces: Array<{ id: string; name: string; role: string }>;
  workspaceId: string;
  userName: string;
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <aside className={cn("fixed inset-y-0 left-0 z-40 hidden flex-col bg-sidebar text-sidebar-foreground transition-all lg:flex", collapsed ? "w-[72px]" : "w-64")}>
        <SidebarBody collapsed={collapsed} pathname={pathname} onNavigate={() => undefined} />
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
          <aside className="relative flex h-full w-72 flex-col bg-sidebar text-sidebar-foreground">
            <SidebarBody collapsed={false} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className={cn("transition-all", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white/90 px-4 backdrop-blur">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <button className="hidden rounded-md p-2 hover:bg-muted lg:inline-flex" onClick={() => setCollapsed((value) => !value)} aria-label="Collapse sidebar"><ChevronLeft className={cn("h-5 w-5 transition-transform", collapsed && "rotate-180")} /></button>
          <form action="/search" className="relative hidden min-w-0 flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input name="q" placeholder="Search companies, leads, products" className="h-10 w-full rounded-md border border-border bg-muted pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </form>
          <form action={async (formData) => { await switchWorkspace(formData); }} className="hidden sm:block">
            <select name="workspaceId" defaultValue={workspaceId} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="h-10 max-w-48 rounded-md border border-border bg-white px-3 text-sm">
              {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
            </select>
          </form>
          <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => setAssistantOpen(true)}>Assistant</button>
          <div className="text-right">
            <p className="text-sm font-medium">{userName || "Member"}</p>
            <p className="max-w-40 truncate text-xs text-muted-foreground">{email}</p>
          </div>
          <form action={signOut}><button className="rounded-md px-3 py-2 text-sm hover:bg-muted">Sign out</button></form>
        </header>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
      {assistantOpen ? <Assistant onClose={() => setAssistantOpen(false)} /> : null}
      <p className="sr-only">{workspaceName}</p>
    </div>
  );
}

function SidebarBody({ collapsed, pathname, onNavigate }: { collapsed: boolean; pathname: string; onNavigate: () => void }) {
  return (
    <>
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary font-semibold text-white">GP</div>
        {collapsed ? null : <div><p className="font-semibold text-white">GrowthPilot</p><p className="text-xs text-slate-400">Business development</p></div>}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.icon as keyof typeof ICONS];
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-white", active && "bg-white/10 text-white")} title={item.label}>
              <Icon className="h-4 w-4 shrink-0" />
              {collapsed ? null : item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function Assistant({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string; confirmation?: { tool: string; args: Record<string, string> } }>>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);

  async function ask(text: string, confirmation?: { tool: string; args: Record<string, string> }) {
    setPending(true);
    setMessages((current) => [...current, { role: "user", content: text }]);
    const response = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text, confirmation }) });
    const payload = await response.json();
    setMessages((current) => [...current, { role: "assistant", content: payload.reply || payload.error || "No response.", confirmation: payload.confirmation }]);
    setPending(false);
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-white shadow-xl">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div><p className="font-semibold">AI assistant</p><p className="text-xs text-muted-foreground">Reads your workspace. Sending and edits need confirmation.</p></div>
        <button onClick={onClose} aria-label="Close assistant"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? <p className="text-sm text-muted-foreground">Try “Show companies that have no follow-up” or “Summarize campaign performance”.</p> : null}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={cn("rounded-lg px-3 py-2 text-sm", message.role === "user" ? "bg-accent" : "bg-muted")}>
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.confirmation ? <button className="mt-2 rounded-md bg-primary px-3 py-1 text-xs text-white" onClick={() => ask("Confirm", message.confirmation)}>Confirm</button> : null}
          </div>
        ))}
      </div>
      <form className="border-t p-3" onSubmit={(event) => { event.preventDefault(); if (!input.trim()) return; const text = input; setInput(""); void ask(text); }}>
        <div className="flex gap-2">
          <input value={input} onChange={(event) => setInput(event.target.value)} className="h-10 flex-1 rounded-md border px-3 text-sm" placeholder="Ask about your pipeline" />
          <button disabled={pending} className="rounded-md bg-primary px-3 text-sm text-white disabled:opacity-50">{pending ? "..." : "Send"}</button>
        </div>
      </form>
    </div>
  );
}
