const LEGAL_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt. ltd",
  "pvt limited",
  "limited",
  "ltd",
  "llc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "gmbh",
  "plc",
  "llp",
];

export function normalizeDomain(input: string | null | undefined) {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
  value = value.split("/")[0]?.split("?")[0]?.split("#")[0] ?? "";
  value = value.split(":")[0] ?? "";
  value = value.replace(/\.$/, "");
  if (!value.includes(".") || value.includes(" ")) return null;
  return value;
}

export function websiteFromDomain(domain: string | null) {
  return domain ? `https://${domain}` : null;
}

export function normalizeCompanyName(name: string) {
  let value = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (value.endsWith(` ${suffix}`)) {
        value = value.slice(0, -(` ${suffix}`.length)).trim();
        changed = true;
      }
    }
  }
  return value.replace(/\s+/g, " ");
}

export function dedupeKey(company: { domain?: string | null; name: string; country?: string | null }) {
  if (company.domain) return `domain:${company.domain}`;
  const name = normalizeCompanyName(company.name);
  const country = (company.country || "").trim().toLowerCase();
  return `name:${name}|${country}`;
}

export function sameCompany(
  left: { domain?: string | null; name: string; country?: string | null },
  right: { domain?: string | null; name: string; country?: string | null },
) {
  return dedupeKey(left) === dedupeKey(right);
}
