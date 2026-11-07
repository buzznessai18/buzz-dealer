"use client";

import { useState, useTransition } from "react";
import { COUNTRY_OPTIONS, OPPORTUNITY_TYPES } from "@/lib/constants";
import { importCsv, runDiscovery } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";

export function DiscoveryForm() {
  const [countries, setCountries] = useState<string[]>(["India"]);
  const [opportunities, setOpportunities] = useState<string[]>([]);
  const [mode, setMode] = useState<"company" | "opportunity">("company");
  const [providers, setProviders] = useState<Array<"google_search" | "google_maps" | "apollo">>(["google_search"]);
  const [message, setMessage] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    start(async () => {
      const result = await runDiscovery({
        mode,
        countries,
        city: String(formData.get("city") || ""),
        industry: String(formData.get("industry") || ""),
        companySize: String(formData.get("companySize") || ""),
        companyType: String(formData.get("companyType") || ""),
        keywords: String(formData.get("keywords") || ""),
        category: String(formData.get("category") || ""),
        technologies: String(formData.get("technologies") || ""),
        jobTitles: String(formData.get("jobTitles") || ""),
        requirements: String(formData.get("requirements") || ""),
        opportunityTypes: opportunities,
        limit: Number(formData.get("limit") || 20),
        providers,
        findEmails: formData.get("findEmails") === "on",
      });
      setMessage(result.ok ? result.message || "Search complete." : result.error);
      setNotices(result.notices ?? []);
    });
  }

  return (
    <div className="space-y-4">
      <form action={submit} className="grid gap-4 rounded-xl border bg-white p-5 md:grid-cols-2">
        <label className="text-sm">Mode<select className="mt-1 h-10 w-full rounded-md border px-3" value={mode} onChange={(event) => setMode(event.target.value as "company" | "opportunity")}><option value="company">Search by company</option><option value="opportunity">Search by opportunity</option></select></label>
        <label className="text-sm">Results<input name="limit" type="number" min={1} max={50} defaultValue={20} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
        <label className="text-sm">Industry<Input name="industry" /></label>
        <label className="text-sm">City<Input name="city" /></label>
        <label className="text-sm">Company size<Input name="companySize" placeholder="11,50" /></label>
        <label className="text-sm">Company type<Input name="companyType" placeholder="startup, enterprise" /></label>
        <label className="text-sm">Keywords<Input name="keywords" /></label>
        <label className="text-sm">Category<Input name="category" /></label>
        <label className="text-sm">Technology requirements<Input name="technologies" /></label>
        <label className="text-sm">Job titles<Input name="jobTitles" /></label>
        <label className="text-sm md:col-span-2">Business requirements<Textarea name="requirements" /></label>
        <fieldset className="md:col-span-2"><legend className="text-sm font-medium">Countries</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{COUNTRY_OPTIONS.map((country) => <label key={country} className="flex gap-2 text-sm"><input type="checkbox" checked={countries.includes(country)} onChange={(event) => setCountries((current) => event.target.checked ? [...current, country] : current.filter((item) => item !== country))} />{country}</label>)}</div></fieldset>
        {mode === "opportunity" ? <fieldset className="md:col-span-2"><legend className="text-sm font-medium">Opportunity types</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{OPPORTUNITY_TYPES.map((item) => <label key={item.id} className="flex gap-2 text-sm"><input type="checkbox" checked={opportunities.includes(item.id)} onChange={(event) => setOpportunities((current) => event.target.checked ? [...current, item.id] : current.filter((value) => value !== item.id))} />{item.label}</label>)}</div></fieldset> : null}
        <fieldset className="md:col-span-2"><legend className="text-sm font-medium">Providers</legend><div className="mt-2 flex flex-wrap gap-4 text-sm">{(["google_search", "google_maps", "apollo"] as const).map((provider) => <label key={provider} className="flex gap-2"><input type="checkbox" checked={providers.includes(provider)} onChange={(event) => setProviders((current) => event.target.checked ? [...current, provider] : current.filter((item) => item !== provider))} />{provider.replaceAll("_", " ")}</label>)}</div></fieldset>
        <label className="flex items-center gap-2 text-sm md:col-span-2"><input name="findEmails" type="checkbox" />Find business emails with Hunter.io for up to 10 domains</label>
        <Button disabled={pending} type="submit">{pending ? "Searching…" : "Run discovery"}</Button>
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
      <Notice items={notices} />
      <CsvImport />
    </div>
  );
}

function CsvImport() {
  const [message, setMessage] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <form className="rounded-xl border bg-white p-5" onSubmit={(event) => {
      event.preventDefault();
      const file = (event.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
      if (!file) return;
      file.text().then((csv) => start(async () => {
        const result = await importCsv(csv);
        setMessage(result.ok ? result.message || "Imported." : result.error);
        setNotices(result.notices ?? []);
      }));
    }}>
      <h2 className="font-medium">CSV import</h2>
      <p className="mt-1 text-sm text-muted-foreground">Columns: company, website, industry, country, city, description, company_size, linkedin_url, contact_name, designation, email.</p>
      <input name="file" type="file" accept=".csv,text/csv" className="mt-3 text-sm" required />
      <Button className="mt-3" disabled={pending} type="submit">Import</Button>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      <div className="mt-3"><Notice items={notices} /></div>
    </form>
  );
}
