import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { CURRENCIES } from "../../../shared/currencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Onboarding() {
  const complete = useMutation(api.settings.completeOnboarding);
  const [q, setQ] = useState("");
  const [code, setCode] = useState("USD");
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const l = q.trim().toLowerCase();
    return CURRENCIES.filter((c) => !l || c.code.toLowerCase().includes(l) || c.name.toLowerCase().includes(l));
  }, [q]);

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
      </div>
    </div>
  );
}
