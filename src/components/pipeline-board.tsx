"use client";

import { PIPELINE_STAGES } from "@/lib/constants";
import { updateLead } from "@/server/actions";

export function PipelineBoard({ leads }: { leads: Array<{ id: string; stage: string; company: string; value: number; probability: number }> }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {PIPELINE_STAGES.map((stage) => (
        <section key={stage.id} className="w-64 shrink-0 rounded-lg bg-muted p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const id = event.dataTransfer.getData("text/plain"); if (id) void updateLead({ id, stage: stage.id }); }}>
          <h2 className="text-sm font-semibold">{stage.label}</h2>
          <div className="mt-3 space-y-2">
            {leads.filter((lead) => lead.stage === stage.id).map((lead) => (
              <article key={lead.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", lead.id)} className="cursor-grab rounded-md border bg-white p-3 text-sm">
                <a className="font-medium text-primary" href={`/leads/${lead.id}`}>{lead.company}</a>
                <p className="text-xs text-muted-foreground">{lead.value} · {lead.probability}%</p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
