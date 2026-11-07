import { Suspense } from "react";
import { CampaignDetail } from "@/app/(app)/campaigns/page";
import { PageLoading } from "@/components/ui/feedback";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageLoading label="Loading campaign" />}>
      <Campaign params={params} />
    </Suspense>
  );
}

async function Campaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
