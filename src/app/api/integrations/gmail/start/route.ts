import { NextResponse } from "next/server";
import { requireWriter } from "@/lib/auth/session";
import { resolveProvider } from "@/lib/integrations/credentials";
import { appUrl } from "@/lib/env";

export async function GET() {
  const session = await requireWriter();
  const gmail = await resolveProvider(session.admin, session.workspaceId, "gmail");
  if (!gmail.values.clientId || !gmail.values.clientSecret) {
    return NextResponse.json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before connecting Gmail." }, { status: 400 });
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", gmail.values.clientId);
  url.searchParams.set("redirect_uri", `${appUrl()}/api/integrations/gmail/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly");
  return NextResponse.redirect(url);
}
