export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function isServiceRoleConfigured() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && isSupabaseConfigured());
}

export function isEncryptionConfigured() {
  return (process.env.INTEGRATION_ENCRYPTION_KEY || "").length >= 32;
}

export type ProviderKey =
  | "openai"
  | "anthropic"
  | "gemini"
  | "google_search"
  | "google_maps"
  | "hunter"
  | "apollo"
  | "gmail"
  | "resend";

const ENV_KEYS: Record<ProviderKey, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  google_search: ["GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_CX"],
  google_maps: ["GOOGLE_MAPS_API_KEY"],
  hunter: ["HUNTER_API_KEY"],
  apollo: ["APOLLO_API_KEY"],
  gmail: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  resend: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
};

export function missingEnv(provider: ProviderKey) {
  return ENV_KEYS[provider].filter((key) => !process.env[key]);
}

export function envConfigured(provider: ProviderKey) {
  return missingEnv(provider).length === 0;
}

export function publicConfigStatus() {
  return {
    supabase: isSupabaseConfigured(),
    serviceRole: isServiceRoleConfigured(),
    encryption: isEncryptionConfigured(),
    cron: Boolean(process.env.CRON_SECRET),
  };
}
