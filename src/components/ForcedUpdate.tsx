import { useEffect, useRef } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryForcedUpdate, skipForcedUpdate, useForcedUpdate } from "@/lib/pwa";

const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Covers the app while it switches to a newer version on its own (src/lib/pwa.ts, applyForced). */
export function ForcedUpdate() {
  const { state, current } = useForcedUpdate();
  const ref = useRef<HTMLDivElement>(null);
  // it covers the app: keyboard and screen-reader focus comes here too, instead of staying on what is underneath
  useEffect(() => { if (state !== "idle") ref.current?.focus(); }, [state]);
  if (state === "idle") return null;
  const failed = state === "failed";
  return (
    <div ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="forced-update-title" aria-describedby="forced-update-body" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background px-8 text-center outline-none">
      <img src="/pwa-192x192.png" alt="" className="size-16 rounded-2xl" />
      <h1 id="forced-update-title" className="mt-6 text-lg font-semibold">{failed ? "Couldn't finish updating" : "Updating UnMoney"}</h1>
      <p id="forced-update-body" className="mt-2 max-w-xs text-sm text-muted-foreground">
        {failed
          ? "The new version didn't download. Check your connection and try again. Your entries are safe: anything not yet synced stays on this device."
          : `The version on this device is from ${day(current)}. Getting the latest, this takes a few seconds.`}
      </p>
      {failed ? (
        <div className="mt-8 flex w-full max-w-xs flex-col gap-2">
          <Button size="lg" onClick={() => void retryForcedUpdate()}>Try again</Button>
          <Button size="lg" variant="ghost" onClick={skipForcedUpdate}>Not now</Button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><WifiOff className="size-3.5" />UnMoney will try again next time you open it.</p>
        </div>
      ) : (
        <Loader2 className="mt-8 size-6 animate-spin text-muted-foreground" aria-label="Updating" />
      )}
    </div>
  );
}
