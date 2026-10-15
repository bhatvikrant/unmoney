import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { hashPin, markUnlocked } from "@/lib/passcode";
import { cn } from "@/lib/utils";
import { Delete } from "lucide-react";

export function PinPad({ title, onComplete, error, subtitle }: { title: string; subtitle?: string; onComplete: (pin: string) => void; error?: boolean }) {
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
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="flex flex-col items-center">
      <div className="text-lg font-semibold">{title}</div>
      {subtitle ? <div className="text-sm text-muted-foreground mt-1">{subtitle}</div> : null}
      <div className={cn("flex gap-3 my-6", error && "animate-[shake_0.3s]")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cn("size-3.5 rounded-full border-2 border-foreground", i < pin.length && "bg-foreground")} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {keys.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={!k}
            onClick={() => (k === "⌫" ? setPin((p) => p.slice(0, -1)) : setPin((p) => (p.length < 4 ? p + k : p)))}
            className={cn("size-16 rounded-full text-2xl font-light flex items-center justify-center", k && "bg-muted hover:bg-accent active:scale-95 transition")}
          >
            {k === "⌫" ? <Delete className="size-6" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Lock({ hash, salt, onUnlock }: { hash: string; salt: string; onUnlock: () => void }) {
  const { signOut } = useAuthActions();
  const [error, setError] = useState(false);
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6">
      <PinPad
        title="Enter passcode"
        error={error}
        onComplete={async (pin) => {
          if ((await hashPin(pin, salt)) === hash) {
            markUnlocked();
            onUnlock();
          } else {
            setError(true);
            setTimeout(() => setError(false), 400);
          }
        }}
      />
      <button type="button" className="mt-10 text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => signOut()}>
        Forgot it? Sign out and back in to reset.
      </button>
    </div>
  );
}
