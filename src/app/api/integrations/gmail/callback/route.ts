import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/auth/session";
import { resolveProvider, saveProviderSecret } from "@/lib/integrations/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";

export async function GET(request: Request) {
  const session = await requireWriter();
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/integrations?error=gmail", appUrl()));
  const gmail = await resolveProvider(session.admin, session.workspaceId, "gmail");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: gmail.values.clientId,
      client_secret: gmail.values.clientSecret,
      redirect_uri: `${appUrl()}/api/integrations/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json();
  if (!response.ok) return NextResponse.redirect(new URL("/integrations?error=gmail", appUrl()));
  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${payload.access_token}` } });
  const profileJson = await profile.json();
  const admin = createAdminClient();
  if (!admin || !payload.refresh_token) return NextResponse.redirect(new URL("/integrations?error=gmail", appUrl()));
  await saveProviderSecret(admin, session.workspaceId, "gmail", { ...gmail.values, refreshToken: payload.refresh_token, email: profileJson.emailAddress });
  await session.supabase.from("email_accounts").upsert({
    workspace_id: session.workspaceId,
    provider: "gmail",
    email_address: profileJson.emailAddress,
    status: "connected",
  }, { onConflict: "workspace_id,provider,email_address" });
  await session.supabase.from("integrations").upsert({ workspace_id: session.workspaceId, provider: "gmail", status: "connected", enabled: true }, { onConflict: "workspace_id,provider" });
  return NextResponse.redirect(new URL("/integrations", appUrl()));
}
