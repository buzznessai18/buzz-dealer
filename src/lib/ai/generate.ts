import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { resolveProvider } from "@/lib/integrations/credentials";

export type GenerateRequest = {
  supabase: SupabaseClient;
  admin: SupabaseClient | null;
  workspaceId: string;
  userId: string | null;
  provider: "openai" | "anthropic" | "gemini";
  model?: string | null;
  feature: string;
  system: string;
  prompt: string;
  json?: boolean;
  monthlyLimit: number;
  trustedJob?: boolean;
};

export type GenerateResponse = {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

const COST_PER_MILLION: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "claude-sonnet-4-5": [3, 15],
  "gemini-2.5-pro": [1.25, 10],
};

export async function generateText(request: GenerateRequest): Promise<GenerateResponse> {
  if (!request.trustedJob) {
    const { data: allowed, error: rateError } = await request.supabase.rpc("bump_rate_limit", {
      p_ws: request.workspaceId,
      p_bucket: `ai:${request.feature}`,
      p_limit: 40,
      p_window_seconds: 3600,
    });
    if (rateError) throw new Error(`Rate limit check failed. Apply the database migration. ${rateError.message}`);
    if (!allowed) throw new Error("Hourly AI limit reached for this workspace member.");
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: usage } = await request.supabase
    .from("ai_usage_logs")
    .select("input_tokens, output_tokens")
    .eq("workspace_id", request.workspaceId)
    .gte("created_at", monthStart.toISOString());
  const used = (usage ?? []).reduce((sum, row) => sum + Number(row.input_tokens || 0) + Number(row.output_tokens || 0), 0);
  if (used >= request.monthlyLimit) {
    throw new Error("The workspace monthly AI token limit has been reached. Raise it in Settings or wait until next month.");
  }

  const resolved = await resolveProvider(request.admin, request.workspaceId, request.provider);
  if (!resolved.configured || !resolved.values.apiKey) {
    throw new Error(`${request.provider} is not configured. Add a workspace key or set the server environment variable, then enable the integration.`);
  }
  const model = request.model || resolved.values.model || defaultModel(request.provider);
  const result = await callProvider(request.provider, resolved.values.apiKey, model, request);

  const rates = COST_PER_MILLION[model] ?? [1, 3];
  const estimated = (result.inputTokens * rates[0] + result.outputTokens * rates[1]) / 1_000_000;
  await request.supabase.from("ai_usage_logs").insert({
    workspace_id: request.workspaceId,
    user_id: request.userId,
    provider: request.provider,
    model,
    feature: request.feature,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    estimated_cost: estimated,
  });
  return { ...result, provider: request.provider, model };
}

function defaultModel(provider: GenerateRequest["provider"]) {
  if (provider === "anthropic") return "claude-sonnet-4-5";
  if (provider === "gemini") return "gemini-2.5-pro";
  return "gpt-4o-mini";
}

async function callProvider(provider: GenerateRequest["provider"], apiKey: string, model: string, request: GenerateRequest): Promise<Omit<GenerateResponse, "provider" | "model">> {
  if (provider === "openai") {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      response_format: request.json ? { type: "json_object" } : undefined,
    });
    return {
      text: response.choices[0]?.message?.content || "",
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
  if (provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || "Anthropic request failed.");
    const text = (payload.content ?? []).map((part: { text?: string }) => part.text || "").join("\n");
    return { text, inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 };
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: request.json ? "application/json" : "text/plain" },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Gemini request failed.");
  const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("\n") ?? "";
  return {
    text,
    inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export function parseJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
  return JSON.parse(trimmed) as Record<string, unknown>;
}
