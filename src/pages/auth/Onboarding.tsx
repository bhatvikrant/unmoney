import { useOp, useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { CURRENCIES, guessCurrency } from "../../../shared/currencies";
import { clearUnlock } from "@/lib/passcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Onboarding() {
  const complete = useOp("settings.completeOnboarding");
  const [q, setQ] = useState("");
  // where the user seems to be, picked and listed first; USD when nothing says
  const [guess] = useState(() => guessCurrency(navigator.languages ?? [navigator.language], Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [code, setCode] = useState(guess ?? "USD");
  const [busy, setBusy] = useState(false);
  const { user, clearLocal } = useStore();
  const { signOut } = useAuthActions();
  const list = useMemo(() => {
    const l = q.trim().toLowerCase();
    const found = CURRENCIES.filter((c) => !l || c.code.toLowerCase().includes(l) || c.name.toLowerCase().includes(l));
    return guess ? [...found.filter((c) => c.code === guess), ...found.filter((c) => c.code !== guess)] : found;
  }, [q, guess]);
  // signed in with the wrong Google account: nothing is set up yet, so nothing to lose
  async function notMe() {
    clearUnlock();
    await clearLocal();
    await signOut();
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Pick your main currency</h1>
        <p className="text-sm text-muted-foreground mt-1">Every total is shown in it. You can add other currencies later and change this one from Settings.</p>
        <Input className="mt-4" placeholder="Search currencies" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="mt-3 max-h-72 overflow-y-auto border rounded-lg divide-y">
          {list.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCode(c.code)}
              className={cn("w-full flex items-center justify-between px-3 py-2.5 text-sm text-left hover:bg-accent", code === c.code && "bg-accent font-medium")}
            >
              <span>{c.name}</span>
              <span className="text-muted-foreground tabular">{c.code} · {c.symbol}</span>
            </button>
          ))}
        </div>
        <Button
          className="w-full mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await complete({ currency: code });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not finish setup");
              setBusy(false);
            }
          }}
        >
          Start with {code}
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {user?.email ? <>Signed in as {user.email}. </> : null}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void notMe()}>Not you? Sign out</button>
        </p>
      </div>
    </div>
  );
}
