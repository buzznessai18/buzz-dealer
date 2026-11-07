import { Suspense } from "react";
import Link from "next/link";
import { signIn } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <AuthCard title="Sign in" subtitle="Use the email and password for your GrowthPilot workspace.">
      <Suspense fallback={null}>
        <AuthError searchParams={searchParams} />
      </Suspense>
      <form action={signIn} className="space-y-4">
        <Input name="email" type="email" required placeholder="Email" aria-label="Email" />
        <Input name="password" type="password" required minLength={8} placeholder="Password" aria-label="Password" />
        <Button className="w-full" type="submit">Sign in</Button>
      </form>
      <p className="text-sm text-muted-foreground">No account yet? <Link className="text-primary" href="/signup">Create one</Link></p>
    </AuthCard>
  );
}

async function AuthError({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return params.error ? <p className="text-sm text-red-600">{params.error}</p> : null;
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary font-semibold text-white">GP</div><div><h1 className="text-xl font-semibold">{title}</h1><p className="text-sm text-muted-foreground">{subtitle}</p></div></div>
        <div className="space-y-4">{children}</div>
      </div>
    </main>
  );
}
