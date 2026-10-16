import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { CloudOff, Lock, RefreshCw } from "lucide-react";
import { Logo } from "@/components/shell/Logo";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const points = [
  { icon: CloudOff, label: "Works offline" },
  { icon: RefreshCw, label: "Syncs everywhere" },
  { icon: Lock, label: "Passcode lock" },
];

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);

  // The saved theme loads with the ledger, which happens after sign-in, so follow the system here.
  useEffect(() => {
    applyTheme("system", "neutral", "A");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("system", "neutral", "A");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  async function google() {
    setBusy(true);
    try {
      await signIn("google");
    } catch {
      toast.error("Could not start Google sign-in. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      {/* a faint wash of the ledger's two colours, income blue and expense coral, behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] opacity-70 dark:opacity-40"
        style={{
          background:
            "radial-gradient(42rem 22rem at 18% -10%, color-mix(in oklch, var(--income) 14%, transparent), transparent 70%), radial-gradient(38rem 20rem at 85% -5%, color-mix(in oklch, var(--expense) 12%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <Logo size={34} className="mb-8" />

        <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-card">
          <h1 className="text-lg font-semibold tracking-tight">Welcome to UnMoney</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with Google to keep your ledger in step across your phone and desktop.
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={google}
            className={cn(
              "mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-background text-sm font-medium text-foreground shadow-card",
              "transition-[transform,background-color,box-shadow] duration-150 ease-out",
              "hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            {busy ? (
              <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
            )}
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>

          <ul className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-5">
            {points.map((p) => (
              <li key={p.label} className="flex flex-col items-center gap-1.5 text-center">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground/80">
                  <p.icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="text-[11px] leading-tight text-muted-foreground">{p.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 max-w-xs text-center text-xs text-muted-foreground/80">
          Track income, expenses and transfers across every account. Your ledger stays on this device and syncs when you are online.
        </p>
      </div>
    </div>
  );
}
