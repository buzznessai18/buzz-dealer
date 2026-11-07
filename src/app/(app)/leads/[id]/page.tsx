import { Suspense } from "react";
import { LeadDetail } from "@/app/(app)/leads/page";
import { PageLoading } from "@/components/ui/feedback";

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Loading lead" />}>
      <Lead params={params} />
    </Suspense>
  );
}

async function Lead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetail id={id} />;
}
