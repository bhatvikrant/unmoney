/**
 * Credit cards with something payable that is due within three days, or overdue: one line at the
 * top of Payment methods ("Card bills · 2 overdue · ₹43,000"), which opens to the cards with Pay.
 * Pay opens the card's payment, prefilled with what is payable.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown } from "lucide-react";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { dateLabel } from "@/lib/format";
import { cardsDue } from "../../../shared/views";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OPEN_KEY = "unmoney.cardBillsOpen";

export function CardBills({ className }: { className: string }) {
  const nav = useNavigate();
  const today = useToday();
  const { accounts } = useApp();
  const due = useMemo(() => cardsDue(accounts, today), [accounts, today]);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } });
  if (!due.length) return null;
  const overdue = due.filter((d) => d.overdue).length;
  const total = due.reduce((s, d) => s + d.payable, 0);
  const flip = () => { setOpen(!open); try { localStorage.setItem(OPEN_KEY, open ? "0" : "1"); } catch { /* private mode: closed next time */ } };
  return (
    <div className="mt-3 border-y">
      <button type="button" onClick={flip} aria-expanded={open} className={className}>
        <ChevronDown className={cn("size-4 mr-1 transition-transform", !open && "-rotate-90")} />
        <span className="flex-1 text-left font-medium text-foreground/80">
          Card bills
          <span className={cn("font-normal", overdue ? "text-destructive" : "text-muted-foreground")}> · {overdue ? `${overdue} overdue` : `${due.length} due soon`}</span>
        </span>
        <Money amount={total} kind="expense" />
      </button>
      {open ? (
        <div className="bg-card border-t">
          {due.map((d) => (
            <div key={d.account._id} className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.account.name}</span>
                <span className={cn("block text-xs", d.overdue ? "text-destructive" : "text-muted-foreground")}>
                  {d.overdue ? `Overdue since ${dateLabel(d.due)}` : d.days === 0 ? "Due today" : d.days === 1 ? "Due tomorrow" : `Due ${dateLabel(d.due, { weekday: true })}`}
                </span>
              </span>
              <Money amount={d.payable} kind="expense" />
              <Button size="sm" variant="outline" className="h-7" onClick={() => nav(`/payment-methods/${d.account._id}?pay=1`)}>Pay</Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
