import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type AppSession = {
  supabase: SupabaseClient;
  admin: SupabaseClient | null;
  userId: string;
  email: string | null;
  fullName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  isDemo: boolean;
  role: WorkspaceRole;
  workspaces: Array<{ id: string; name: string; slug: string; role: WorkspaceRole }>;
  company: {
    company_name: string;
    website: string | null;
    description: string | null;
    location: string | null;
    mailing_address: string | null;
    email: string | null;
    logo_url: string | null;
    services: unknown[];
    target_countries: string[];
    target_industries: string[];
    ideal_customer_profile: Record<string, unknown>;
    portfolio: unknown[];
    case_studies: unknown[];
    email_signature: string | null;
    ai_provider: "openai" | "anthropic" | "gemini";
    ai_model: string;
    onboarding_completed: boolean;
  };
  settings: {
    timezone: string;
    currency: string;
    brand_voice: string;
    content_language: string;
    daily_send_limit: number;
    min_hours_between_emails: number;
    require_manual_approval: boolean;
    auto_send_replies: boolean;
    compliance: {
      require_lawful_basis?: boolean;
      allowed_countries?: string[];
      include_physical_address?: boolean;
      include_unsubscribe?: boolean;
      dpdp_acknowledged?: boolean;
      gdpr_acknowledged?: boolean;
      can_spam_acknowledged?: boolean;
      trai_acknowledged?: boolean;
    };
    ai_monthly_token_limit: number;
    data_retention_days: number;
  };
};

export type SessionState =
  | { status: "anonymous" }
  | { status: "unconfigured" }
  | { status: "needs-workspace"; userId: string; email: string | null; fullName: string; supabase: SupabaseClient }
  | { status: "ready"; session: AppSession }
  | { status: "error"; message: string };

export const getSessionState = cache(async (): Promise<SessionState> => {
  await connection();
  if (!isSupabaseConfigured()) return { status: "unconfigured" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "anonymous" };
  const user = data.user;
  const { data: memberships, error: memberError } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, slug, is_demo)")
    .eq("user_id", user.id);
  if (memberError) return { status: "error", message: memberError.message };
  const workspaces = (memberships ?? [])
    .map((row) => {
      const workspace = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;
      if (!workspace) return null;
      return { id: workspace.id as string, name: workspace.name as string, slug: workspace.slug as string, role: row.role as WorkspaceRole, isDemo: Boolean(workspace.is_demo) };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!workspaces.length) {
    return { status: "needs-workspace", userId: user.id, email: user.email ?? null, fullName: String(user.user_metadata?.full_name || ""), supabase };
  }
  const cookieStore = await cookies();
  const requested = cookieStore.get("gp_workspace")?.value;
  const current = workspaces.find((item) => item.id === requested) ?? workspaces[0];
  const [{ data: company, error: companyError }, { data: settings, error: settingsError }, { data: profile }] = await Promise.all([
    supabase.from("company_profiles").select("*").eq("workspace_id", current.id).maybeSingle(),
    supabase.from("company_settings").select("*").eq("workspace_id", current.id).maybeSingle(),
    supabase.from("profiles").select("full_name, avatar_url, email").eq("id", user.id).maybeSingle(),
  ]);
  if (companyError || settingsError || !company || !settings) {
    return { status: "error", message: companyError?.message || settingsError?.message || "Workspace profile is missing. Apply the database migration." };
  }
  return {
    status: "ready",
    session: {
      supabase,
      admin: createAdminClient(),
      userId: user.id,
      email: user.email ?? profile?.email ?? null,
      fullName: profile?.full_name || String(user.user_metadata?.full_name || ""),
      workspaceId: current.id,
      workspaceName: current.name,
      workspaceSlug: current.slug,
      isDemo: current.isDemo,
      role: current.role,
      workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, slug: workspace.slug, role: workspace.role })),
      company: {
        company_name: company.company_name || "",
        website: company.website,
        description: company.description,
        location: company.location,
        mailing_address: company.mailing_address,
        email: company.email,
        logo_url: company.logo_url,
        services: company.services ?? [],
        target_countries: company.target_countries ?? [],
        target_industries: company.target_industries ?? [],
        ideal_customer_profile: company.ideal_customer_profile ?? {},
        portfolio: company.portfolio ?? [],
        case_studies: company.case_studies ?? [],
        email_signature: company.email_signature,
        ai_provider: company.ai_provider,
        ai_model: company.ai_model,
        onboarding_completed: company.onboarding_completed,
      },
      settings: {
        timezone: settings.timezone,
        currency: settings.currency,
        brand_voice: settings.brand_voice,
        content_language: settings.content_language,
        daily_send_limit: settings.daily_send_limit,
        min_hours_between_emails: settings.min_hours_between_emails,
        require_manual_approval: settings.require_manual_approval,
        auto_send_replies: settings.auto_send_replies,
        compliance: settings.compliance ?? {},
        ai_monthly_token_limit: settings.ai_monthly_token_limit,
        data_retention_days: settings.data_retention_days,
      },
    },
  };
});

export async function requireReady() {
  const state = await getSessionState();
  if (state.status === "unconfigured") redirect("/setup");
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "error") throw new Error(state.message);
  if (state.status === "needs-workspace") redirect("/onboarding");
  if (!state.session.company.onboarding_completed) redirect("/onboarding");
  return state.session;
}

export async function requireWriter() {
  const session = await requireReady();
  if (session.role === "viewer") throw new Error("Viewers can review records but cannot change them.");
  return session;
}

export async function setWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set("gp_workspace", workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
