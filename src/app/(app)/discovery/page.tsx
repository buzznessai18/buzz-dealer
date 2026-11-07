import { DiscoveryForm } from "@/components/discovery-form";
import { PageHeader } from "@/components/ui/feedback";

export default function DiscoveryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="AI Lead Discovery" description="Search configured providers or import a CSV. Missing credentials are reported; they are not treated as results." />
      <DiscoveryForm />
    </div>
  );
}
