import { Suspense } from "react";
import { CampaignDetail } from "@/app/(app)/campaigns/page";

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading campaign…</p>}>
      <Campaign params={params} />
    </Suspense>
  );
}

async function Campaign({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignDetail id={id} />;
}
