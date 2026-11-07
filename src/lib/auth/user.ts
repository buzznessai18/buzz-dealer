import type { SupabaseClient } from "@supabase/supabase-js";

export async function userFromAuth(supabase: SupabaseClient) {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const expiresAtMs = (session?.expires_at ?? 0) * 1000;
  if (session?.user && expiresAtMs - Date.now() > 120_000) return session.user;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
