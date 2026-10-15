import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { applyTheme } from "@/lib/theme";
import { toast } from "sonner";

// Mint from the accent list in lib/theme.ts. Dark text on it reads far better than white.
const PRIMARY = "bg-[oklch(0.62_0.15_160)] text-[oklch(0.15_0_0)] hover:bg-[oklch(0.62_0.15_160)] hover:brightness-95";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);

  // The saved theme loads with the ledger, which happens after sign-in, so follow the system here.
  useEffect(() => {
    applyTheme("system", "neutral", "A");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("system", "neutral", "A");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

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

  const signingIn = flow === "signIn";

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-8 bg-background px-4 py-10">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-[oklch(0.62_0.15_160)]">
          <svg viewBox="128 160 256 192" className="h-4 w-6 text-[oklch(0.15_0_0)]" aria-hidden="true">
            <path fill="currentColor" d="M128 352V160h48l80 112 80-112h48v192h-48V240l-80 112-80-112v112z" />
          </svg>
        </div>
        <span className="text-2xl font-semibold tracking-tight">UnMoney</span>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm dark:shadow-black/40">
        <h1 className="text-xl font-semibold tracking-tight">{signingIn ? "Welcome back" : "Create your account"}</h1>

        <Button
          variant="outline"
          className="mt-5 h-10 w-full rounded-xl text-sm font-medium"
          onClick={() => signIn("google").catch(() => toast.error("Google sign-in is not configured yet. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET on the Convex deployment."))}
        >
          <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {!signingIn ? (
            <div className="space-y-1.5">
              <Label htmlFor="name" className="font-medium">Name</Label>
              <Input id="name" name="name" autoComplete="name" className="h-10 rounded-xl px-3 md:text-sm" />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="font-medium">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" className="h-10 rounded-xl px-3 md:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="font-medium">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={signingIn ? "current-password" : "new-password"}
              className="h-10 rounded-xl px-3 md:text-sm"
            />
          </div>
          <Button type="submit" className={`mt-2 h-10 w-full rounded-xl text-sm font-semibold ${PRIMARY}`} disabled={busy}>
            {signingIn ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">
        {signingIn ? "New here?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4 hover:opacity-80"
          onClick={() => setFlow(signingIn ? "signUp" : "signIn")}
        >
          {signingIn ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
