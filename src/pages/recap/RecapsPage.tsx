/**
 * /recaps — every month's and year's recap in one list, newest first. Nothing is stored: a recap
 * is built from the entries on this device the moment it is opened, so months from before the
 * feature existed have one too, and edits to old entries show in it straight away. Each finished
 * year's section starts with the year's own row, above its months.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Sparkles } from "lucide-react";
import { useView } from "@/lib/store";
import { useToday } from "@/lib/today";
import { useApp } from "@/lib/app";
import { dateLabel } from "@/lib/format";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState, Row, Section } from "@/components/shell/misc";
import { cn } from "@/lib/utils";
import { parseMonthKey } from "../../../shared/period";
import { recapIndex, RECAP_MIN_ENTRIES, RECAP_YEAR_MIN_MONTHS, type RecapIndexMonthRow, type RecapIndexRow, type RecapIndexYearRow } from "../../../shared/recap";
import { longMonth } from "./cards";

/** The year's row: a filled icon square so it stands apart from the months; muted when the year is too thin. */
export function YearRecapRow({ row, onOpen }: { row: RecapIndexYearRow; onOpen: () => void }) {
  const { fmt } = useApp();
  const open = row.state === "ready";
  return (
    <Row
      icon={<Sparkles />}
      label={<span className={cn("font-medium", !open && "text-muted-foreground")}>{row.year} recap</span>}
      hint={open ? `The whole year · ${row.cards} cards · ${fmt(row.spent)} spent` : `Needs ${RECAP_YEAR_MIN_MONTHS} months with a recap`}
      onClick={open ? onOpen : undefined}
      right={open ? <ChevronRight className="size-4 text-muted-foreground" /> : undefined}
      iconClassName="bg-primary text-primary-foreground"
      className={open ? undefined : "opacity-70"}
    />
  );
}

export default function RecapsPage() {
  const nav = useNavigate();
  const view = useView();
  const today = useToday();
  const { fmt } = useApp();
  const rows = useMemo(() => recapIndex(view, today), [view, today]);
  // one section per year, newest first (the rows already are); a finished year's own row comes first in its section
  const years = useMemo(() => {
    const out: { y: number; rows: RecapIndexRow[] }[] = [];
    for (const r of rows) {
      const y = r.kind === "year" ? r.year : parseMonthKey(r.month).y;
      const last = out[out.length - 1];
      if (last?.y === y) last.rows.push(r); else out.push({ y, rows: [r] });
    }
    return out;
  }, [rows]);
  const ready = rows.filter((r) => r.state === "ready").length;
  const hint = (r: RecapIndexMonthRow) => {
    if (r.state === "current") return r.entries ? `${r.entries} ${r.entries === 1 ? "entry" : "entries"} so far · ready on ${dateLabel(r.readyOn!)}` : `Ready on ${dateLabel(r.readyOn!)}`;
    if (r.state === "thin") return `${r.entries} ${r.entries === 1 ? "entry" : "entries"} · a recap needs ${RECAP_MIN_ENTRIES}`;
    return `${r.cards} cards · ${fmt(r.spent)} spent`;
  };
  return (
    <>
      <PageHeader title="Recaps" back />
      <Page className="pb-10">
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          The story of each month's and year's spending, built from your entries the moment you open it. Every finished month with at least {RECAP_MIN_ENTRIES} expense entries has one; a year needs {RECAP_YEAR_MIN_MONTHS} such months.
        </p>
        {years.map((yr) => (
          <Section key={yr.y} title={String(yr.y)}>
            {yr.rows.map((r) => {
              if (r.kind === "year") return <YearRecapRow key={`y${r.year}`} row={r} onOpen={() => nav(`/recap/${r.year}`)} />;
              const open = r.state === "ready";
              return (
                <Row
                  key={r.month}
                  icon={<Sparkles />}
                  label={<span className={open ? undefined : "text-muted-foreground"}>{longMonth(r.month)} recap</span>}
                  hint={hint(r)}
                  onClick={open ? () => nav(`/recap/${r.month}`) : undefined}
                  right={open ? <ChevronRight className="size-4 text-muted-foreground" /> : undefined}
                  className={open ? undefined : "opacity-70"}
                />
              );
            })}
          </Section>
        ))}
        {!ready ? <EmptyState title="No recap yet" hint={`Your first recap is ready the day after a month ends, once it has ${RECAP_MIN_ENTRIES} expense entries.`} /> : null}
      </Page>
    </>
  );
}
