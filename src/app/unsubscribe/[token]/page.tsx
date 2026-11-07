import { Suspense } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmUnsubscribe } from "@/server/unsubscribe";

export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-lg p-8 text-sm">Checking this unsubscribe link…</main>}>
      <Unsubscribe params={params} />
    </Suspense>
  );
}

async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  if (!admin) return <main className="mx-auto max-w-lg p-8">Unsubscribe handling needs the server service role key.</main>;
  const { data } = await admin.from("email_messages").select("to_email, subject").eq("unsubscribe_token", token).maybeSingle();
  if (!data) return <main className="mx-auto max-w-lg p-8">This unsubscribe link is not recognized.</main>;
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Unsubscribe</h1>
      <p className="mt-3 text-sm">Stop outreach email to {data.to_email}. This does not delete the conversation history.</p>
      <form className="mt-4" action={confirmUnsubscribe.bind(null, token)}><button className="rounded-md bg-primary px-4 py-2 text-sm text-white">Confirm unsubscribe</button></form>
    </main>
  );
}
