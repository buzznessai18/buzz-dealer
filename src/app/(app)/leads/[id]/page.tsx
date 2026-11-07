import { Suspense } from "react";
import { LeadDetail } from "@/app/(app)/leads/page";

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading lead…</p>}>
      <Lead params={params} />
    </Suspense>
  );
}

async function Lead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetail id={id} />;
}
