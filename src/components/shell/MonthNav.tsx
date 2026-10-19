import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApp } from "@/lib/app";
import { MONTH_SHORT, todayISO } from "../../../shared/dates";
import { monthKey, monthKeyForDate, parseMonthKey, type MonthKey } from "../../../shared/period";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Tapping the label: either open the month picker (when `month` + `onPick` are given) or run this. */
  onClick?: () => void;
  /** The month the label shows. With `onPick`, tapping the label opens a month picker. */
  month?: MonthKey;
  onPick?: (m: MonthKey) => void;
  /** Months that have something in them. When given, the others are greyed out (the current and selected months stay tappable). */
  withData?: Set<MonthKey>;
};

export function MonthNav({ label, onPrev, onNext, onClick, month, onPick, withData }: Props) {
  const labelCls = "text-sm font-medium px-3 py-1 rounded-md hover:bg-accent";
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={onPrev}><ChevronLeft className="size-5" /></Button>
      {month && onPick ? (
        <MonthPicker month={month} onPick={onPick} withData={withData}>
          <button type="button" className={cn(labelCls, "data-[state=open]:bg-accent")} aria-label={`${label}. Pick a month`}>{label}</button>
        </MonthPicker>
      ) : (
        <button type="button" className={labelCls} onClick={onClick}>{label}</button>
      )}
      <Button variant="ghost" size="icon" aria-label="Next" onClick={onNext}><ChevronRight className="size-5" /></Button>
    </div>
  );
}

/** Popover with a year stepper and a 4×3 month grid. Wraps the trigger element. */
export function MonthPicker({ month, onPick, withData, children }: { month: MonthKey; onPick: (m: MonthKey) => void; withData?: Set<MonthKey>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => parseMonthKey(month).y);
  const { settings } = useApp();
  const sel = parseMonthKey(month);
  const thisMonth = monthKeyForDate(todayISO(), settings.monthStartDay);
  // A month is reachable when it has data, or is the current or selected month. The year arrows stop at the first and last reachable years.
  const reachable = (key: MonthKey) => !withData || key === month || key === thisMonth || withData.has(key);
  const years = withData ? [sel.y, parseMonthKey(thisMonth).y, ...[...withData].map((k) => parseMonthKey(k).y)] : [];
  const minYear = withData ? Math.min(...years) : -Infinity;
  const maxYear = withData ? Math.max(...years) : Infinity;

  const pick = (m: MonthKey) => { onPick(m); setOpen(false); };
  const onOpenChange = (o: boolean) => { if (o) setYear(sel.y); setOpen(o); };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" sideOffset={6} className="w-[calc(100vw-2rem)] max-w-sm gap-0 p-0 overflow-hidden">
        <div className="flex items-center gap-1 bg-primary/10 pl-4 pr-1 py-2">
          <span className="text-sm font-medium flex-1">Date</span>
          <Button variant="ghost" size="sm" className={cn(month === thisMonth && "text-primary")} onClick={() => pick(thisMonth)}>This month</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}><X className="size-4" /></Button>
        </div>
        <div className="flex items-center justify-between px-1 py-1 border-b">
          <Button variant="ghost" size="icon" aria-label="Previous year" disabled={year <= minYear} onClick={() => setYear((y) => y - 1)}><ChevronLeft className="size-5" /></Button>
          <span className="text-sm font-medium tabular-nums">{year}</span>
          <Button variant="ghost" size="icon" aria-label="Next year" disabled={year >= maxYear} onClick={() => setYear((y) => y + 1)}><ChevronRight className="size-5" /></Button>
        </div>
        <div className="grid grid-cols-4 gap-1 p-2">
          {MONTH_SHORT.map((name, i) => {
            const key = monthKey(year, i + 1);
            const selected = key === month;
            const isNow = key === thisMonth;
            const empty = !reachable(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                disabled={empty}
                title={empty ? "Nothing this month" : undefined}
                onClick={() => pick(key)}
                className={cn(
                  "h-11 rounded-md text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/40",
                  selected ? "bg-primary text-primary-foreground font-medium hover:bg-primary/90" : isNow ? "text-primary font-medium" : "",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
