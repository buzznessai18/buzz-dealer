import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { envConfigured, missingEnv, type ProviderKey } from "@/lib/env";

export type SecretMap = Record<string, string>;

const ENV_MAP: Record<ProviderKey, SecretMap> = new Proxy({} as Record<ProviderKey, SecretMap>, {
  get(_target, property) {
    return envFor(String(property) as ProviderKey);
  },
});

function envFor(provider: ProviderKey): SecretMap {
  const read = (name: string) => process.env[name] || "";
  if (provider === "openai") return compact({ apiKey: read("OPENAI_API_KEY"), model: read("OPENAI_MODEL") });
  if (provider === "anthropic") return compact({ apiKey: read("ANTHROPIC_API_KEY"), model: read("ANTHROPIC_MODEL") });
  if (provider === "gemini") return compact({ apiKey: read("GEMINI_API_KEY"), model: read("GEMINI_MODEL") });
  if (provider === "google_search") return compact({ apiKey: read("GOOGLE_SEARCH_API_KEY"), cx: read("GOOGLE_SEARCH_CX") });
  if (provider === "google_maps") return compact({ apiKey: read("GOOGLE_MAPS_API_KEY") });
  if (provider === "hunter") return compact({ apiKey: read("HUNTER_API_KEY") });
  if (provider === "apollo") return compact({ apiKey: read("APOLLO_API_KEY") });
  if (provider === "gmail") return compact({ clientId: read("GOOGLE_CLIENT_ID"), clientSecret: read("GOOGLE_CLIENT_SECRET") });
  if (provider === "resend") return compact({ apiKey: read("RESEND_API_KEY"), fromEmail: read("RESEND_FROM_EMAIL") });
  return {};
}

function compact(values: SecretMap) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

export async function readIntegration(admin: SupabaseClient | null, workspaceId: string, provider: string) {
  if (!admin) return { secret: null as SecretMap | null, row: null as IntegrationRow | null };
  const [{ data: secretRow }, { data: row }] = await Promise.all([
    admin.from("integration_secrets").select("secret_value").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle(),
    admin.from("integrations").select("provider, status, enabled, public_config, last_error, last_tested_at, usage").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle(),
  ]);
  let secret: SecretMap | null = null;
  if (secretRow?.secret_value) {
    try {
      secret = JSON.parse(decryptSecret(secretRow.secret_value)) as SecretMap;
    } catch (error) {
      return {
        secret: null,
        row: {
          provider,
          status: "error",
          enabled: row?.enabled ?? false,
          public_config: (row?.public_config as Record<string, unknown>) ?? {},
          last_error: error instanceof Error ? error.message : "Secret could not be read.",
          last_tested_at: row?.last_tested_at ?? null,
          usage: (row?.usage as Record<string, unknown>) ?? {},
        },
      };
    }
  }
  return { secret, row: (row as IntegrationRow | null) ?? null };
}

export type IntegrationRow = {
  provider: string;
  status: string;
  enabled: boolean;
  public_config: Record<string, unknown>;
  last_error: string | null;
  last_tested_at: string | null;
  usage: Record<string, unknown>;
};

export async function resolveProvider(admin: SupabaseClient | null, workspaceId: string, provider: ProviderKey) {
  const stored = await readIntegration(admin, workspaceId, provider);
  return describeProvider(provider, stored.secret, stored.row);
}

export async function listResolvedProviders(admin: SupabaseClient | null, workspaceId: string, providers: ProviderKey[]) {
  const secrets = new Map<string, SecretMap | null>();
  const rows = new Map<string, IntegrationRow>();
  if (admin) {
    const [{ data: secretRows }, { data: integrationRows }] = await Promise.all([
      admin.from("integration_secrets").select("provider, secret_value").eq("workspace_id", workspaceId),
      admin.from("integrations").select("provider, status, enabled, public_config, last_error, last_tested_at, usage").eq("workspace_id", workspaceId),
    ]);
    for (const row of integrationRows ?? []) rows.set(row.provider, row as IntegrationRow);
    for (const secretRow of secretRows ?? []) {
      if (!secretRow.secret_value) continue;
      try {
        secrets.set(secretRow.provider, JSON.parse(decryptSecret(secretRow.secret_value)) as SecretMap);
      } catch (error) {
        const existing = rows.get(secretRow.provider);
        rows.set(secretRow.provider, {
          provider: secretRow.provider,
          status: "error",
          enabled: existing?.enabled ?? false,
          public_config: existing?.public_config ?? {},
          last_error: error instanceof Error ? error.message : "Secret could not be read.",
          last_tested_at: existing?.last_tested_at ?? null,
          usage: existing?.usage ?? {},
        });
      }
    }
  }
  return providers.map((provider) => describeProvider(provider, secrets.get(provider) ?? null, rows.get(provider) ?? null));
}

function describeProvider(provider: ProviderKey, secret: SecretMap | null, row: IntegrationRow | null) {
  const envValues = envFor(provider);
  const merged = { ...envValues, ...(secret ?? {}) };
  const disabled = row?.enabled === false;
  const hasValues = provider === "gmail"
    ? Boolean(merged.clientId && merged.clientSecret && (merged.refreshToken || envConfigured("gmail")))
    : Object.keys(provider === "google_search" ? { apiKey: merged.apiKey, cx: merged.cx } : { apiKey: merged.apiKey }).every((key) => merged[key]);
  const configured = !disabled && (provider === "gmail" ? Boolean(merged.clientId && merged.clientSecret) : hasValues);
  return {
    provider,
    configured,
    disabled,
    source: secret ? "workspace" : envValues.apiKey || envValues.clientId ? "environment" : "missing",
    values: configured ? merged : {},
    row,
    missing: secret ? [] : missingEnv(provider),
  };
}

export async function saveProviderSecret(admin: SupabaseClient, workspaceId: string, provider: string, secret: SecretMap) {
  const secretValue = encryptSecret(JSON.stringify(secret));
  const { error } = await admin.from("integration_secrets").upsert(
    { workspace_id: workspaceId, provider, secret_value: secretValue },
    { onConflict: "workspace_id,provider" },
  );
  if (error) throw new Error(error.message);
}

export function envFallback(provider: ProviderKey) {
  return ENV_MAP[provider];
}

export function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return message
    .replace(/key=[^&\s]+/gi, "key=redacted")
    .replace(/Bearer\s+\S+/gi, "Bearer redacted")
    .replace(/[A-Za-z0-9_\-]{24,}/g, (token) => (token.startsWith("enc") ? token : "[redacted]"))
    .slice(0, 400);
}
