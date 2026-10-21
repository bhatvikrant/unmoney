import { useNavigate, useLocation } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MonthNav } from "@/components/shell/MonthNav";
import { Input } from "@/components/ui/input";
import { useStatPeriod } from "./period";
import { useMonthsWithData, usePeriodNeighbours } from "@/lib/period-hooks";
import { cn } from "@/lib/utils";

/** `tabs={false}`: only the period, for a screen opened from Stats (a category). */
export function StatsHeaderBar({ tabs: withTabs = true }: { tabs?: boolean } = {}) {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const p = useStatPeriod();
  const monthsWithData = useMonthsWithData("transactions");
  // The arrows only go to weeks, months or years that have an entry (or the current one). A custom range has no arrows.
  const nb = usePeriodNeighbours(p.period === "custom" ? "monthly" : p.period, p.key, monthsWithData.dates);
  const tabs = [{ to: "/stats", label: "Stats" }, { to: "/budget", label: "Budget" }, { to: "/notes", label: "Note" }];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-2 px-3 py-2">
        {withTabs ? (
          <div className="flex rounded-md bg-muted p-0.5 text-sm">
            {tabs.map((t) => (
              <button key={t.to} type="button" onClick={() => nav(t.to + (t.to === "/notes" ? "" : search))} className={cn("px-4 py-1 rounded-[5px]", pathname.startsWith(t.to) ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>{t.label}</button>
            ))}
          </div>
        ) : null}
        <span className="flex-1" />
        <Select value={p.period} onValueChange={(v) => p.setPeriod(v as typeof p.period)}>
          <SelectTrigger className="w-28 h-8" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Annually</SelectItem>
            {pathname.startsWith("/stats") ? <SelectItem value="custom">Period</SelectItem> : null}
          </SelectContent>
        </Select>
      </div>
      {p.period === "custom" ? (
        <div className="flex gap-2 px-3 pb-2"><Input type="date" value={p.from} onChange={(e) => p.set({ from: e.target.value })} /><Input type="date" value={p.to} onChange={(e) => p.set({ to: e.target.value })} /></div>
      ) : (
        <MonthNav label={p.label} onPrev={nb.prev ? () => p.go(nb.prev!) : undefined} onNext={nb.next ? () => p.go(nb.next!) : undefined} month={p.period === "monthly" ? p.month : undefined} onPick={(m) => p.set({ month: m })} withData={monthsWithData.months} spent={monthsWithData.spent} />
      )}
    </div>
  );
}
