import { normalizeDomain } from "@/lib/domain";
import { publicError } from "@/lib/integrations/credentials";

export type DiscoveryQuery = {
  mode: "company" | "opportunity";
  countries: string[];
  city?: string;
  industry?: string;
  companySize?: string;
  companyType?: string;
  keywords?: string;
  category?: string;
  technologies?: string;
  jobTitles?: string;
  requirements?: string;
  opportunityTypes?: string[];
  limit: number;
  providers: Array<"google_search" | "google_maps" | "apollo">;
  findEmails: boolean;
};

export type DiscoveredCompany = {
  name: string;
  website?: string | null;
  domain?: string | null;
  industry?: string | null;
  country?: string | null;
  city?: string | null;
  location?: string | null;
  description?: string | null;
  companySize?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  source: string;
  sourceUrl?: string | null;
  contact?: { name?: string; title?: string; email?: string } | null;
};

export function buildSearchQuery(query: DiscoveryQuery) {
  const opportunity = query.mode === "opportunity" ? (query.opportunityTypes ?? []).join(" ") : "";
  return [
    query.category,
    query.industry,
    query.keywords,
    query.technologies,
    query.requirements,
    query.companyType,
    opportunity,
    "company",
    query.city,
    query.countries.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

type Credentials = {
  search?: { apiKey?: string; cx?: string };
  maps?: { apiKey?: string };
  apollo?: { apiKey?: string };
  hunter?: { apiKey?: string };
};

export async function discoverCompanies(query: DiscoveryQuery, credentials: Credentials) {
  const notices: string[] = [];
  const companies: DiscoveredCompany[] = [];
  const text = buildSearchQuery(query);
  if (!text) return { companies, notices: ["Add an industry, keyword, category, or opportunity type before searching."] };

  if (query.providers.includes("google_search")) {
    if (!credentials.search?.apiKey || !credentials.search.cx) {
      notices.push("Google Search is not configured. Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX, or save them in Integrations.");
    } else {
      try {
        companies.push(...(await searchGoogle(text, query, credentials.search.apiKey, credentials.search.cx)));
      } catch (error) {
        notices.push(`Google Search failed: ${publicError(error)}`);
      }
    }
  }
  if (query.providers.includes("google_maps")) {
    if (!credentials.maps?.apiKey) {
      notices.push("Google Maps Places is not configured.");
    } else {
      try {
        companies.push(...(await searchPlaces(text, query, credentials.maps.apiKey)));
      } catch (error) {
        notices.push(`Google Maps failed: ${publicError(error)}`);
      }
    }
  }
  if (query.providers.includes("apollo")) {
    if (!credentials.apollo?.apiKey) {
      notices.push("Apollo.io is not configured. Company search stays unavailable until an authorized API key is saved.");
    } else {
      try {
        companies.push(...(await searchApollo(query, credentials.apollo.apiKey)));
      } catch (error) {
        notices.push(`Apollo.io failed: ${publicError(error)}`);
      }
    }
  }
  if (!query.providers.length) {
    notices.push("Select at least one configured discovery provider, or import a CSV.");
  }

  const merged = mergeCompanies(companies).slice(0, query.limit);
  if (query.findEmails) {
    if (!credentials.hunter?.apiKey) {
      notices.push("Hunter.io is not configured, so business emails were not requested.");
    } else {
      for (const company of merged.slice(0, 10)) {
        if (!company.domain || company.contact?.email) continue;
        try {
          const contact = await hunterContact(company.domain, credentials.hunter.apiKey);
          if (contact?.email && contact.email.endsWith(`@${company.domain}`)) company.contact = contact;
        } catch (error) {
          notices.push(`Hunter.io could not search ${company.domain}: ${publicError(error)}`);
          break;
        }
      }
    }
  }
  return { companies: merged, notices };
}

async function searchGoogle(text: string, query: DiscoveryQuery, apiKey: string, cx: string) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", text);
  url.searchParams.set("num", String(Math.min(query.limit, 10)));
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Google Search request failed.");
  return ((payload.items ?? []) as Array<{ title?: string; link?: string; snippet?: string }>).map((item) => {
    const domain = normalizeDomain(item.link);
    return {
      name: (item.title || domain || "Untitled result").split(" - ")[0]?.trim() || "Untitled result",
      website: item.link ?? null,
      domain,
      description: item.snippet ?? null,
      country: query.countries[0] ?? null,
      city: query.city ?? null,
      industry: query.industry ?? null,
      source: "google_search",
      sourceUrl: item.link ?? null,
    } satisfies DiscoveredCompany;
  });
}

async function searchPlaces(text: string, query: DiscoveryQuery, apiKey: string) {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.googleMapsUri,places.addressComponents",
    },
    body: JSON.stringify({ textQuery: text, pageSize: Math.min(query.limit, 20) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Places request failed.");
  return ((payload.places ?? []) as Array<Record<string, unknown>>).map((place) => {
    const website = stringValue(place.websiteUri);
    const components = (place.addressComponents as Array<{ longText?: string; types?: string[] }> | undefined) ?? [];
    const country = components.find((item) => item.types?.includes("country"))?.longText ?? query.countries[0] ?? null;
    const city = components.find((item) => item.types?.includes("locality"))?.longText ?? query.city ?? null;
    return {
      name: (place.displayName as { text?: string } | undefined)?.text || "Unnamed business",
      website,
      domain: normalizeDomain(website),
      location: stringValue(place.formattedAddress),
      country,
      city,
      industry: query.industry ?? null,
      phone: stringValue(place.nationalPhoneNumber),
      source: "google_places",
      sourceUrl: stringValue(place.googleMapsUri),
      description: stringValue(place.formattedAddress),
    } satisfies DiscoveredCompany;
  });
}

async function searchApollo(query: DiscoveryQuery, apiKey: string) {
  const response = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      organization_locations: query.countries,
      q_organization_keyword_tags: [query.industry, query.keywords, query.category, ...(query.opportunityTypes ?? [])].filter(Boolean),
      organization_num_employees_ranges: query.companySize ? [query.companySize] : undefined,
      page: 1,
      per_page: Math.min(query.limit, 25),
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || payload?.message || "Apollo request failed.");
  const rows = (payload.organizations ?? payload.accounts ?? []) as Array<Record<string, unknown>>;
  return rows.map((org) => {
    const website = stringValue(org.website_url);
    return {
      name: stringValue(org.name) || "Unnamed organization",
      website,
      domain: normalizeDomain(stringValue(org.primary_domain) || website),
      industry: stringValue(org.industry) || query.industry || null,
      country: stringValue(org.country) || query.countries[0] || null,
      city: stringValue(org.city),
      location: [stringValue(org.city), stringValue(org.country)].filter(Boolean).join(", ") || null,
      description: stringValue(org.short_description),
      companySize: org.estimated_num_employees ? String(org.estimated_num_employees) : null,
      linkedinUrl: stringValue(org.linkedin_url),
      source: "apollo",
      sourceUrl: website,
    } satisfies DiscoveredCompany;
  });
}

async function hunterContact(domain: string, apiKey: string) {
  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.searchParams.set("domain", domain);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("limit", "3");
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.errors?.[0]?.details || "Hunter request failed.");
  const email = (payload.data?.emails ?? []).find((item: { value?: string; confidence?: number }) => item.value && (item.confidence ?? 0) >= 70);
  if (!email?.value) return null;
  return {
    email: String(email.value).toLowerCase(),
    name: [email.first_name, email.last_name].filter(Boolean).join(" ") || undefined,
    title: email.position || undefined,
  };
}

function mergeCompanies(companies: DiscoveredCompany[]) {
  const map = new Map<string, DiscoveredCompany>();
  for (const company of companies) {
    const key = company.domain || company.name.toLowerCase();
    const current = map.get(key);
    if (!current) {
      map.set(key, company);
      continue;
    }
    map.set(key, {
      ...current,
      ...Object.fromEntries(Object.entries(company).filter(([, value]) => value)),
      description: current.description || company.description,
      source: current.source === company.source ? current.source : `${current.source}+${company.source}`,
    });
  }
  return [...map.values()].filter((company) => company.name);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
