import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("flow", flow);
    setBusy(true);
    try {
      await signIn("password", fd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(flow === "signIn" ? "Could not sign in. Check your email and password." : `Could not create the account. ${msg.includes("already") ? "That email is already registered." : "Use at least 8 characters."}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="text-2xl font-semibold tracking-tight">unmoney</div>
          <p className="text-sm text-muted-foreground mt-1">Every account, every transaction, nothing behind a paywall.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {flow === "signUp" ? (
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete={flow === "signIn" ? "current-password" : "new-password"} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{flow === "signIn" ? "Sign in" : "Create account"}</Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
        <Button variant="outline" className="w-full" onClick={() => signIn("google").catch(() => toast.error("Google sign-in is not configured yet. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET on the Convex deployment."))}>
          Continue with Google
        </Button>
        <button type="button" className="mt-6 text-sm text-muted-foreground underline-offset-4 hover:underline w-full" onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}>
          {flow === "signIn" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
