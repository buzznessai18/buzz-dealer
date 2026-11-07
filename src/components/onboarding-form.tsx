"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { COUNTRY_OPTIONS, SUGGESTED_SERVICES } from "@/lib/constants";
import { completeOnboarding } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/feedback";

const schema = z.object({
  companyName: z.string().min(2),
  website: z.string().optional(),
  description: z.string().min(10),
  location: z.string().min(2),
  email: z.email(),
  mailingAddress: z.string().min(5),
  services: z.array(z.string()).min(1),
  countries: z.array(z.string()).min(1),
  industries: z.array(z.string()).min(1),
  customerProfile: z.string().min(10),
  signature: z.string().min(5),
  aiProvider: z.enum(["openai", "anthropic", "gemini"]),
  aiModel: z.string().min(2),
  seedServices: z.boolean(),
});

export function OnboardingForm({ companyName }: { companyName: string }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const form = useForm({
    defaultValues: {
      companyName,
      website: "",
      description: "",
      location: "",
      email: "",
      mailingAddress: "",
      services: SUGGESTED_SERVICES.map((item) => item[0]),
      countries: ["India"],
      industries: ["Software"],
      customerProfile: "",
      signature: "",
      aiProvider: "openai" as const,
      aiModel: "gpt-4o-mini",
      seedServices: true,
    },
  });
  const countries = useWatch({ control: form.control, name: "countries" });
  const services = useWatch({ control: form.control, name: "services" });
  const seedServices = useWatch({ control: form.control, name: "seedServices" });

  return (
    <form className="space-y-5" onSubmit={form.handleSubmit((values) => {
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        setError("Complete the required company, audience, and signature fields.");
        return;
      }
      startTransition(async () => {
        const result = await completeOnboarding(parsed.data);
        if (result && "error" in result && result.error) setError(result.error);
      });
    })}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company name"><Input {...form.register("companyName")} /></Field>
        <Field label="Website"><Input {...form.register("website")} placeholder="https://" /></Field>
        <Field label="Location"><Input {...form.register("location")} /></Field>
        <Field label="Company email"><Input type="email" {...form.register("email")} /></Field>
      </div>
      <Field label="Description"><Textarea {...form.register("description")} /></Field>
      <Field label="Mailing address"><Textarea {...form.register("mailingAddress")} /></Field>
      <Field label="Target countries">
        <div className="grid gap-2 sm:grid-cols-3">{COUNTRY_OPTIONS.map((country) => <label key={country} className="flex items-center gap-2 text-sm"><input type="checkbox" value={country} checked={countries.includes(country)} onChange={(event) => {
          const current = form.getValues("countries");
          form.setValue("countries", event.target.checked ? [...current, country] : current.filter((item) => item !== country));
        }} />{country}</label>)}</div>
      </Field>
      <Field label="Target industries"><Input placeholder="Healthcare, SaaS, manufacturing" onChange={(event) => form.setValue("industries", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></Field>
      <Field label="Ideal customer profile"><Textarea {...form.register("customerProfile")} /></Field>
      <Field label="Services to add">{SUGGESTED_SERVICES.map((item) => <label key={item[0]} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={services.includes(item[0])} onChange={(event) => {
        const current = form.getValues("services");
        form.setValue("services", event.target.checked ? [...current, item[0]] : current.filter((service) => service !== item[0]));
      }} />{item[0]}</label>)}</Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seedServices} onChange={(event) => form.setValue("seedServices", event.target.checked)} />Add the selected services to the catalog</label>
      <Field label="Email signature"><Textarea {...form.register("signature")} /></Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="AI provider"><select className="h-10 w-full rounded-md border px-3" {...form.register("aiProvider")}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></Field>
        <Field label="AI model"><Input {...form.register("aiModel")} /></Field>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button disabled={pending} type="submit">{pending ? "Saving…" : "Finish onboarding"}</Button>
    </form>
  );
}
