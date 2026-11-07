export type SendCheckInput = {
  eligible: boolean;
  lawfulBasis?: string | null;
  requireLawfulBasis: boolean;
  suppressed: boolean;
  unsubscribed: boolean;
  duplicate: boolean;
  campaignApproved: boolean;
  draftApproved: boolean;
  requireManualApproval: boolean;
  automated: boolean;
  allowAutomatedSend: boolean;
  dailyCount: number;
  dailyLimit: number;
  lastSentAt?: string | null;
  minHours: number;
  country?: string | null;
  allowedCountries?: string[];
  now?: Date;
  hasRecipient: boolean;
  hasSender: boolean;
  acknowledgements?: { dpdp?: boolean; gdpr?: boolean; canSpam?: boolean; trai?: boolean };
};

export type SendCheck = { ok: boolean; reasons: string[] };

export function evaluateSend(input: SendCheckInput): SendCheck {
  const reasons: string[] = [];
  const ack = input.acknowledgements;
  if (ack && (!ack.dpdp || !ack.gdpr || !ack.canSpam || !ack.trai)) {
    reasons.push("Confirm the DPDP, GDPR, CAN-SPAM, and TRAI acknowledgements in Settings before sending.");
  }
  if (!input.hasRecipient) reasons.push("The lead has no business email.");
  if (!input.hasSender) reasons.push("No connected email account is available.");
  if (!input.eligible) reasons.push("Outreach eligibility has not been verified for this lead.");
  if (input.requireLawfulBasis && !input.lawfulBasis) reasons.push("A lawful basis has not been recorded.");
  if (input.suppressed) reasons.push("The recipient is on the suppression list.");
  if (input.unsubscribed) reasons.push("The recipient has unsubscribed.");
  if (input.duplicate) reasons.push("This campaign or sequence step was already sent to the lead.");
  if (!input.campaignApproved) reasons.push("The campaign has not been approved.");
  if (input.requireManualApproval && !input.draftApproved) reasons.push("The draft has not been manually approved.");
  if (input.automated && !input.allowAutomatedSend) reasons.push("Automated sending is off for this campaign.");
  if (input.dailyCount >= input.dailyLimit) reasons.push("The daily sending limit has been reached.");
  if (input.allowedCountries?.length && input.country && !input.allowedCountries.some((country) => country.toLowerCase() === input.country?.toLowerCase())) {
    reasons.push(`${input.country} is outside the workspace's allowed outreach countries.`);
  }
  if (input.lastSentAt && input.minHours > 0) {
    const elapsed = ((input.now ?? new Date()).getTime() - new Date(input.lastSentAt).getTime()) / 36e5;
    if (elapsed < input.minHours) reasons.push(`The minimum gap of ${input.minHours} hours between emails has not elapsed.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export type ReplyCategory =
  | "interested"
  | "not_interested"
  | "needs_info"
  | "meeting_request"
  | "pricing"
  | "follow_up_later"
  | "out_of_office"
  | "unsubscribe"
  | "uncategorized";

const RULES: Array<{ category: ReplyCategory; patterns: RegExp[] }> = [
  { category: "unsubscribe", patterns: [/unsubscribe/, /remove me/, /stop emailing/, /do not contact/, /opt out/] },
  { category: "out_of_office", patterns: [/out of office/, /automatic reply/, /away from (the )?office/, /currently away/] },
  { category: "not_interested", patterns: [/not interested/, /no thank/, /not a fit/, /please don't/, /we are all set/, /no longer/] },
  { category: "meeting_request", patterns: [/schedule a call/, /book a (call|meeting)/, /calendar/, /let'?s meet/, /available for a call/] },
  { category: "pricing", patterns: [/\bpricing\b/, /\bprice\b/, /\bcost\b/, /\bquote\b/, /\bbudget\b/] },
  { category: "follow_up_later", patterns: [/next quarter/, /follow up later/, /circle back/, /not right now/, /touch base later/] },
  { category: "interested", patterns: [/interested/, /let'?s talk/, /sounds good/, /tell me more/, /send (me )?more/] },
  { category: "needs_info", patterns: [/more information/, /more details/, /how does/, /can you share/, /what do you offer/] },
];

export function categorizeReply(text: string): { category: ReplyCategory; method: "rules"; matched: string | null } {
  const haystack = text.toLowerCase();
  for (const rule of RULES) {
    const pattern = rule.patterns.find((item) => item.test(haystack));
    if (pattern) return { category: rule.category, method: "rules", matched: pattern.source };
  }
  return { category: "uncategorized", method: "rules", matched: null };
}

export function shouldStopSequence(input: {
  stopOnReply: boolean;
  stopOnUnsubscribe: boolean;
  stopOnNotInterested: boolean;
  replied: boolean;
  unsubscribed: boolean;
  notInterested: boolean;
  lost: boolean;
}) {
  if (input.unsubscribed && input.stopOnUnsubscribe) return "Recipient unsubscribed.";
  if (input.notInterested && input.stopOnNotInterested) return "Recipient is not interested.";
  if (input.lost) return "Lead is marked lost.";
  if (input.replied && input.stopOnReply) return "A reply was received.";
  return null;
}
