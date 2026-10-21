import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { clearFailures, hashPin, lockoutRemaining, markUnlocked, recordFailure } from "@/lib/passcode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Delete } from "lucide-react";

/** `message` says what went wrong (a wrong code, a mismatch); screen readers hear it too. */
export function PinPad({ title, onComplete, error, subtitle, message, disabled }: { title: string; subtitle?: string; message?: string; onComplete: (pin: string) => void; error?: boolean; disabled?: boolean }) {
  const [pin, setPin] = useState("");
  useEffect(() => {
    if (pin.length === 4) {
      const p = pin;
      setPin("");
      onComplete(p);
    }
  }, [pin, onComplete]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [disabled]);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="flex flex-col items-center">
      <div className="text-lg font-semibold">{title}</div>
      {subtitle ? <div className="text-sm text-muted-foreground mt-1">{subtitle}</div> : null}
      <div className={cn("flex gap-3 mt-6", error && "animate-[shake_0.3s]")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("size-3.5 rounded-full border-2 border-foreground", i < pin.length && "bg-foreground")} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="h-6 text-sm leading-6 text-destructive">{message}</div>
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={!k || disabled}
            aria-label={k === "⌫" ? "Delete last digit" : undefined}
            onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 4 ? p + k : p)))}
            className={cn("size-16 rounded-full text-2xl font-light flex items-center justify-center", k && "bg-muted hover:bg-accent active:scale-95 transition", disabled && "opacity-40")}
          >
            {k === "⌫" ? <Delete className="size-6" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Re-renders every second while a wait after wrong guesses runs; returns the seconds left. */
function useLockout(): [number, () => void] {
  const [left, setLeft] = useState(lockoutRemaining);
  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setLeft(lockoutRemaining()), 1000);
    return () => clearInterval(t);
  }, [left]);
  return [Math.ceil(left / 1000), () => setLeft(lockoutRemaining())];
}

export default function Lock({ hash, salt, resetRequested, onUnlock }: { hash: string; salt: string; resetRequested: boolean; onUnlock: () => void }) {
  const { signOut } = useAuthActions();
  const requestReset = useMutation(api.passcode.requestReset);
  const cancelReset = useMutation(api.passcode.cancelReset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [message, setMessage] = useState<string>();
  const [wait, refreshWait] = useLockout();
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6">
      <PinPad
        title="Enter passcode"
        subtitle={wait ? `Too many wrong tries. Try again in ${wait < 60 ? `${wait} s` : `${Math.ceil(wait / 60)} min`}.` : undefined}
        message={wait ? undefined : message}
        disabled={wait > 0}
        error={error}
        onComplete={async (pin) => {
          if ((await hashPin(pin, salt)) === hash) {
            clearFailures();
            markUnlocked();
            if (resetRequested) void cancelReset().catch(() => {});
            onUnlock();
          } else {
            recordFailure();
            refreshWait();
            setMessage("Wrong passcode. Try again.");
            setError(true);
            setTimeout(() => setError(false), 400);
          }
        }}
      />
      {forgot ? (
        <div className="mt-10 max-w-xs text-center">
          <p className="text-sm text-muted-foreground">Sign in with Google again and the passcode is removed, on every device. Changes not yet synced stay on this device.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => setForgot(false)}>Cancel</Button>
            <Button disabled={busy} onClick={async () => {
              // the server records the request, so only a real new sign-in can act on it
              setBusy(true);
              try { await requestReset(); } catch { toast.error("Resetting the passcode needs a connection."); setBusy(false); return; }
              await signOut();
            }}>Sign out to reset</Button>
          </div>
        </div>
      ) : (
        <button type="button" className="mt-10 text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setForgot(true)}>
          Forgot it?
        </button>
      )}
    </div>
  );
}
