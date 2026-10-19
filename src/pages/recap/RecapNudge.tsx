/**
 * "Your September recap is ready": a card on the ledger during the first week of a month, while
 * the previous month has enough entries and this device has not opened or dismissed it. A card,
 * never a dialog, so nothing sits on top of an entry being typed.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Sparkles, X } from "lucide-react";
import { useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { markRecapSeen, recapUnseen } from "@/lib/recap";
import { Button } from "@/components/ui/button";
import { monthKeyForDate, type MonthKey } from "../../../shared/period";
import { recapNudge } from "../../../shared/recap";
import { longMonth } from "./cards";

/** Shown only while the ledger shows the current month (`month`). */
export function RecapNudge({ month }: { month: MonthKey }) {
  const nav = useNavigate();
  const view = useView();
  const { userId } = useStore();
  const { settings } = useApp();
  const today = useToday();
  const [dismissed, setDismissed] = useState<MonthKey | null>(null);
  const ready = useMemo(() => recapNudge(view, today), [view, today]);
  const current = monthKeyForDate(today, settings.monthStartDay);
  if (!ready || month !== current || dismissed === ready || !recapUnseen(userId, ready)) return null;
  const dismiss = () => { if (userId) markRecapSeen(userId, ready); setDismissed(ready); };
  return (
    <div className="mx-3 my-2.5 flex items-start gap-3 rounded-lg border bg-card p-3 pl-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Sparkles className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Your {longMonth(ready)} recap is ready</div>
        <div className="mt-0.5 text-xs text-muted-foreground">What you spent, where it went and what changed. About 30 seconds.</div>
        <div className="mt-2.5"><Button size="sm" onClick={() => nav(`/recap/${ready}`)}>See recap</Button></div>
      </div>
      <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 text-muted-foreground" aria-label="Hide for this month" onClick={dismiss}><X className="size-4" /></Button>
    </div>
  );
}
