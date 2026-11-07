import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { appUrl } from "@/lib/env";

export function unsubscribeToken() {
  return randomBytes(24).toString("base64url");
}

export function unsubscribeUrl(token: string) {
  return `${appUrl()}/unsubscribe/${token}`;
}

export function buildRawEmail(input: { from: string; to: string; subject: string; body: string; unsubscribeUrl?: string }) {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (input.unsubscribeUrl) headers.push(`List-Unsubscribe: <${input.unsubscribeUrl}>`);
  return Buffer.from([...headers, "", input.body].join("\r\n")).toString("base64url");
}

export async function sendWithResend(input: { apiKey: string; from: string; to: string; subject: string; body: string; unsubscribeUrl?: string }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.body,
      headers: input.unsubscribeUrl ? { "List-Unsubscribe": `<${input.unsubscribeUrl}>` } : undefined,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Resend rejected the email.");
  return { providerMessageId: String(payload.id || "") };
}

export async function refreshGmailToken(input: { clientId: string; clientSecret: string; refreshToken: string }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error_description || "Gmail token refresh failed.");
  return String(payload.access_token);
}

export async function sendWithGmail(input: { accessToken: string; from: string; to: string; subject: string; body: string; unsubscribeUrl?: string }) {
  const raw = buildRawEmail(input);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Gmail rejected the email.");
  return { providerMessageId: String(payload.id || ""), threadId: String(payload.threadId || "") };
}

export function verifyResendWebhook(secret: string, headers: { id: string; timestamp: string; signature: string }, body: string) {
  const age = Math.abs(Date.now() / 1000 - Number(headers.timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(raw, "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest("base64");
  return headers.signature.split(" ").some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
