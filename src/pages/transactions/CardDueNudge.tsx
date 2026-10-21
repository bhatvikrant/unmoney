/**
 * "HDFC card: ₹14,000 due Sat, Oct 25": a line on the ledger while a credit card has something
 * payable due within three days, or overdue. Pay opens the card's payment, prefilled with what is
 * payable. Hiding it lasts until that card's next due date, on this device.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CreditCard, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { dateLabel } from "@/lib/format";
import { cardsDue } from "../../../shared/views";
import { monthKeyForDate, type MonthKey } from "../../../shared/period";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const HIDDEN_KEY = "unmoney.cardDueHidden";
const readHidden = (): string[] => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); } catch { return []; } };
const writeHidden = (v: string[]) => { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(v.slice(-20))); } catch { /* private mode: it shows again next time */ } };

/** Shown only while the ledger shows the current month (`month`). */
export function CardDueNudge({ month }: { month: MonthKey }) {
  const nav = useNavigate();
  const today = useToday();
  const { accounts, settings } = useApp();
  const [hidden, setHidden] = useState(readHidden);
  const due = useMemo(() => cardsDue(accounts, today).filter((d) => !hidden.includes(`${d.account._id}|${d.due}`)), [accounts, today, hidden]);
  if (!due.length || month !== monthKeyForDate(today, settings.monthStartDay)) return null;
  const hide = (key: string) => { const next = [...hidden, key]; writeHidden(next); setHidden(next); };
  return (
    <div className="mx-3 my-2.5 divide-y rounded-lg border bg-card">
      {due.map((d) => (
        <div key={d.account._id} className="flex items-center gap-3 p-3 pl-3.5" role="status">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><CreditCard className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{d.account.name}: <Money amount={d.payable} kind="expense" /></div>
            <div className={cn("text-xs", d.overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
              {d.overdue ? `Overdue since ${dateLabel(d.due)}` : d.days === 0 ? "Due today" : d.days === 1 ? "Due tomorrow" : `Due ${dateLabel(d.due, { weekday: true })}`}
            </div>
          </div>
          <Button size="sm" onClick={() => nav(`/payment-methods/${d.account._id}?pay=1`)}>Pay</Button>
          <Button variant="ghost" size="icon" className="size-7 -mr-1" aria-label={`Hide until ${d.account.name}'s next due date`} onClick={() => hide(`${d.account._id}|${d.due}`)}><X className="size-4" /></Button>
        </div>
      ))}
    </div>
  );
}
