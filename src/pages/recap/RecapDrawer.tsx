/**
 * The drawer a recap card opens over itself: the entries behind a category, a day, a note, a
 * payment method… counted exactly as the card counted them, so its total is the card's figure.
 * A day, a month or an hour steps to its neighbours with ‹ › (or ← →) without closing; "other
 * categories" lists them, and each opens its own entries with a way back.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shell/Money";
import { TransactionList, TransactionRow } from "@/components/tx/TransactionList";
import { useApp } from "@/lib/app";
import { useView } from "@/lib/store";
import { useOpenEntry } from "@/lib/nav";
import { longMonth } from "@/lib/format";
import { addDays, parts } from "../../../shared/dates";
import { parseMonthKey, shiftMonthKey, type Range } from "../../../shared/period";
import { recapDrill, recapQualifies, type RecapDrill } from "../../../shared/recap";
import { statsByCategory } from "../../../shared/views";
import { dayLabel, hourRange } from "./cards";
import { encodeDrill } from "./drill";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RecapDrawer({ drill, recapKey, range, onDrill, onClose }: {
  /** The open drill; null when closed. */
  drill: RecapDrill | null;
  /** The recap's month key, or its year as "YYYY". */
  recapKey: string;
  range: Range;
  onDrill: (d: RecapDrill) => void;
  onClose: () => void;
}) {
  // the last drill stays on screen while the drawer slides away
  const [shown, setShown] = useState(drill);
  if (drill && (!shown || encodeDrill(drill) !== encodeDrill(shown))) setShown(drill);
  // a category opened from "other categories" can go back to the list
  const [back, setBack] = useState<RecapDrill | null>(null);
  if (!drill && back) setBack(null);
  return (
    <Drawer open={!!drill} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="md:mx-auto md:max-w-xl md:rounded-t-xl">
        {shown ? <Body d={shown} open={!!drill} recapKey={recapKey} range={range} back={back} onDrill={(next, from) => { setBack(from ?? null); onDrill(next); }} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function Body({ d, open, recapKey, range, back, onDrill }: {
  d: RecapDrill; open: boolean; recapKey: string; range: Range; back: RecapDrill | null;
  onDrill: (next: RecapDrill, from?: RecapDrill) => void;
}) {
  const view = useView();
  const nav = useNavigate();
  const openEntry = useOpenEntry();
  const { accountName } = useApp();
  const year = /^\d{4}$/.test(recapKey);
  const period = year ? recapKey : `${longMonth(recapKey)} ${parseMonthKey(recapKey).y}`;
  const key = encodeDrill(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { txs, amount } = useMemo(() => recapDrill(view, range, d), [view, range.from, range.to, key]);
  const byCat = useMemo(() => statsByCategory(view, range.from, range.to, "expense"), [view, range.from, range.to]);

  // ‹ › for a day, a month or an hour: the neighbours inside the recap
  let prev: RecapDrill | null = null, next: RecapDrill | null = null;
  if (d.kind === "day") {
    const a = addDays(d.date, -1), b = addDays(d.date, 1);
    if (a >= range.from) prev = { kind: "day", date: a };
    if (b <= range.to) next = { kind: "day", date: b };
  } else if (d.kind === "month" && year) {
    const a = shiftMonthKey(d.month, -1), b = shiftMonthKey(d.month, 1);
    if (parseMonthKey(a).y === Number(recapKey)) prev = { kind: "month", month: a };
    if (parseMonthKey(b).y === Number(recapKey)) next = { kind: "month", month: b };
  } else if (d.kind === "hour") {
    if (d.hour > 0) prev = { kind: "hour", hour: d.hour - 1 };
    if (d.hour < 23) next = { kind: "hour", hour: d.hour + 1 };
  }
  const stepping = d.kind === "day" || d.kind === "month" || d.kind === "hour";
  // ← → step too, wherever the focus is in the drawer (the recap's own arrows stand down while a dialog is open)
  const prevKey = prev && encodeDrill(prev), nextKey = next && encodeDrill(next);
  useEffect(() => {
    if (!open || (!prevKey && !nextKey)) return;
    const h = (e: globalThis.KeyboardEvent) => {
      const step = e.key === "ArrowLeft" ? prev : e.key === "ArrowRight" ? next : null;
      if (!step || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onDrill(step);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prevKey, nextKey]);

  const others = d.kind === "rest" ? byCat.items.filter((i) => !d.exclude.includes(i.id)) : [];
  const title = (() => {
    switch (d.kind) {
      case "category": return byCat.items.find((i) => i.id === d.id)?.name ?? "Category";
      case "rest": return plural(others.length, "other category", "other categories");
      case "day": return `${dayLabel(d.date)} ${parts(d.date).y}`;
      case "month": return `${longMonth(d.month)} ${parseMonthKey(d.month).y}`;
      case "note": return `“${d.text}”`;
      case "account": return accountName(d.id) || "Payment method";
      case "hour": return hourRange(d.hour);
      case "scheduled": return "Scheduled entries";
      case "income": return "Income";
      case "largest": return `Your ${d.count} largest`;
    }
  })();
  const count = txs.length;
  const sub = !count
    ? (d.kind === "income" ? "Nothing came in" : "Nothing spent")
    : `${plural(count, "entry", "entries")}${stepping && d.kind !== "hour" ? "" : ` · ${period}`}`;
  const kind = d.kind === "income" ? "income" : "expense";

  const statsQuery = year ? `?period=yearly&year=${recapKey}` : `?month=${recapKey}`;
  const action =
    d.kind === "category" && d.id !== "none" && d.id !== "fees"
      ? <Button variant="outline" size="sm" className="w-full" onClick={() => nav(`/stats/c/${encodeURIComponent(d.id)}${statsQuery}`)}>Open in Stats<ChevronRight /></Button>
      : d.kind === "month" && recapQualifies(view, d.month)
        ? <Button variant="outline" size="sm" className="w-full" onClick={() => nav(`/recap/${d.month}`)}>Open {longMonth(d.month)}'s recap<ChevronRight /></Button>
        : null;

  return (
    <div className="flex min-h-0 flex-col">
      <DrawerHeader className="flex-row items-center gap-1 px-2 py-2">
        {back ? (
          <Button variant="ghost" size="icon" aria-label="Back to the list" onClick={() => onDrill(back)}><ChevronLeft className="size-4" /></Button>
        ) : stepping ? (
          <Button variant="ghost" size="icon" aria-label="Previous" title="Previous (←)" disabled={!prev} onClick={() => prev && onDrill(prev)}><ChevronLeft className="size-4" /></Button>
        ) : <span className="w-2" />}
        <div className="min-w-0 flex-1 text-left">
          <DrawerTitle className="truncate text-base">{title}</DrawerTitle>
          <DrawerDescription className="truncate text-xs">{sub}</DrawerDescription>
        </div>
        {count ? <Money amount={amount} kind={kind} className="shrink-0 text-base font-semibold" /> : null}
        {stepping && !back
          ? <Button variant="ghost" size="icon" aria-label="Next" title="Next (→)" disabled={!next} onClick={() => next && onDrill(next)}><ChevronRight className="size-4" /></Button>
          : <span className="w-2" />}
      </DrawerHeader>
      {action ? <div className="px-4 pb-3">{action}</div> : null}
      <div className="max-h-[65vh] overflow-y-auto border-t safe-bottom">
        {d.kind === "rest" ? (
          others.map((c) => (
            <button key={c.id} type="button" onClick={() => onDrill({ kind: "category", id: c.id }, d)}
              className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/40 active:bg-accent">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{Math.round(c.pct * 100)}%</span>
              <Money amount={c.amount} kind="expense" />
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))
        ) : d.kind === "largest" ? (
          txs.map((t) => <TransactionRow key={t._id} tx={t} showDate onClick={() => openEntry(t._id)} />)
        ) : (
          <TransactionList txs={txs} emptyText={d.kind === "income" ? "Nothing came in" : "No entries"} />
        )}
      </div>
    </div>
  );
}
