"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { saveOffering, setOfferingStatus, deleteOffering } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";

const schema = z.object({
  kind: z.enum(["product", "service"]),
  name: z.string().min(2),
  description: z.string().min(10),
  category: z.string().min(2),
  industry: z.string().optional(),
  targetAudience: z.string().optional(),
  problemSolved: z.string().min(5),
  features: z.string().optional(),
  benefits: z.string().optional(),
  techStack: z.string().optional(),
  price: z.string().optional(),
  currency: z.string().optional(),
  priceNotes: z.string().optional(),
  demoUrls: z.string().optional(),
  websiteUrl: z.string().optional(),
  portfolioUrls: z.string().optional(),
});

export function ProductForm() {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const form = useForm({ defaultValues: { kind: "service" as const, name: "", description: "", category: "", problemSolved: "", features: "", benefits: "", techStack: "", demoUrls: "", portfolioUrls: "", websiteUrl: "", price: "", currency: "INR", priceNotes: "", industry: "", targetAudience: "" } });
  return (
    <form className="grid gap-3 rounded-xl border bg-white p-5 md:grid-cols-2" onSubmit={form.handleSubmit((values) => {
      const parsed = schema.safeParse(values);
      if (!parsed.success) { setMessage("Name, description, category, and problem solved are required."); return; }
      start(async () => { const result = await saveOffering(parsed.data); setMessage(result.ok ? result.message || "Saved." : result.error); if (result.ok) form.reset(); });
    })}>
      <select className="h-10 rounded-md border px-3" {...form.register("kind")}><option value="service">Custom development service</option><option value="product">Ready-made product</option></select>
      <Input placeholder="Name" {...form.register("name")} />
      <Input placeholder="Category" {...form.register("category")} />
      <Input placeholder="Industry" {...form.register("industry")} />
      <Textarea className="md:col-span-2" placeholder="Description" {...form.register("description")} />
      <Textarea className="md:col-span-2" placeholder="Problem solved" {...form.register("problemSolved")} />
      <Textarea placeholder="Features, one per line" {...form.register("features")} />
      <Textarea placeholder="Benefits, one per line" {...form.register("benefits")} />
      <Textarea placeholder="Technology stack, one per line" {...form.register("techStack")} />
      <Input placeholder="Target audience" {...form.register("targetAudience")} />
      <Input placeholder="Price" {...form.register("price")} />
      <Input placeholder="Currency" {...form.register("currency")} />
      <Input placeholder="Pricing notes" {...form.register("priceNotes")} />
      <Input placeholder="Website URL" {...form.register("websiteUrl")} />
      <Textarea placeholder="Demo URLs, one per line" {...form.register("demoUrls")} />
      <Textarea placeholder="Portfolio URLs, one per line" {...form.register("portfolioUrls")} />
      <div className="md:col-span-2"><Button disabled={pending} type="submit">Save catalog item</Button>{message ? <p className="mt-2 text-sm">{message}</p> : null}</div>
    </form>
  );
}

export function OfferingActions({ kind, id, status }: { kind: "product" | "service"; id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(() => void setOfferingStatus(kind, id, status === "archived" ? "active" : "archived"))}>{status === "archived" ? "Restore" : "Archive"}</Button>
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => start(() => void deleteOffering(kind, id))}>Delete</Button>
    </div>
  );
}
