import { Suspense } from "react";
import Link from "next/link";
import { signUp } from "@/server/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard } from "@/app/login/page";

export default function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <AuthCard title="Create account" subtitle="This creates your user. You will name the workspace next.">
      <Suspense fallback={null}>
        <SignupError searchParams={searchParams} />
      </Suspense>
      <form action={signUp} className="space-y-4">
        <Input name="fullName" required minLength={2} placeholder="Your name" aria-label="Your name" />
        <Input name="company" required minLength={2} placeholder="Company name" aria-label="Company name" />
        <Input name="email" type="email" required placeholder="Work email" aria-label="Work email" />
        <Input name="password" type="password" required minLength={8} placeholder="Password" aria-label="Password" />
        <Button className="w-full" type="submit">Create account</Button>
      </form>
      <p className="text-sm text-muted-foreground">Already registered? <Link className="text-primary" href="/login">Sign in</Link></p>
    </AuthCard>
  );
}

async function SignupError({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return params.error ? <p className="text-sm text-red-600">{params.error}</p> : null;
}
