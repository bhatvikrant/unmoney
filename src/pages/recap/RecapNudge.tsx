/**
 * "Your September recap is ready": a card on the ledger during the first week of a month, while
 * the previous month has enough entries and this device has not opened or dismissed it. In the
 * first two weeks of January the year's card takes its place, with December's recap as a second
 * button so the month is not lost; dismissing it dismisses both. A card, never a dialog, so
 * nothing sits on top of an entry being typed.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Sparkles, X } from "lucide-react";
import { useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { markRecapSeen, markRecapYearSeen, recapUnseen, recapYearUnseen } from "@/lib/recap";
import { Button } from "@/components/ui/button";
import { monthKey, monthKeyForDate, type MonthKey } from "../../../shared/period";
import { recapNudge, yearRecapNudge } from "../../../shared/recap";
import { longMonth } from "@/lib/format";

/** Shown only while the ledger shows the current month (`month`). */
export function RecapNudge({ month }: { month: MonthKey }) {
  const nav = useNavigate();
  const view = useView();
  const { userId } = useStore();
  const { settings } = useApp();
  const today = useToday();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const current = monthKeyForDate(today, settings.monthStartDay);
  // only on the current month: browsing an old one costs no scan of the entries
  const shown = month === current;
  const ready = useMemo(() => (shown ? recapNudge(view, today) : null), [shown, view, today]);
  const readyYear = useMemo(() => (shown ? yearRecapNudge(view, today) : null), [shown, view, today]);
  if (!shown) return null;
  // the year wins the card; December rides along as the second button
  if (readyYear !== null && dismissed !== String(readyYear) && recapYearUnseen(userId, readyYear)) {
    const december = monthKey(readyYear, 12);
    const withDecember = ready === december && recapUnseen(userId, december);
    const dismiss = () => { if (userId) { markRecapYearSeen(userId, readyYear); markRecapSeen(userId, december); } setDismissed(String(readyYear)); };
    return (
      <Card title={`Your ${readyYear} recap is ready`} hint="Twelve months in a dozen cards: where it went, your top five, your spending personality." onDismiss={dismiss} dismissLabel="Hide for this year">
        <Button size="sm" onClick={() => nav(`/recap/${readyYear}`)}>See {readyYear}</Button>
        {withDecember ? <Button size="sm" variant="outline" onClick={() => nav(`/recap/${december}`)}>{longMonth(december)} recap</Button> : null}
      </Card>
    );
  }
  if (!ready || dismissed === ready || !recapUnseen(userId, ready)) return null;
  const dismiss = () => { if (userId) markRecapSeen(userId, ready); setDismissed(ready); };
  return (
    <Card title={`Your ${longMonth(ready)} recap is ready`} hint="What you spent, where it went and what changed. About 30 seconds." onDismiss={dismiss} dismissLabel="Hide for this month">
      <Button size="sm" onClick={() => nav(`/recap/${ready}`)}>See recap</Button>
    </Card>
  );
}

function Card({ title, hint, children, onDismiss, dismissLabel }: { title: string; hint: string; children: React.ReactNode; onDismiss: () => void; dismissLabel: string }) {
  return (
    <div className="mx-3 my-2.5 flex items-start gap-3 rounded-lg border bg-card p-3 pl-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><Sparkles className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        <div className="mt-2.5 flex gap-2">{children}</div>
      </div>
      <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-1 text-muted-foreground" aria-label={dismissLabel} onClick={onDismiss}><X className="size-4" /></Button>
    </div>
  );
}
