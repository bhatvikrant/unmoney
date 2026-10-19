/**
 * One component per recap card kind. Every number comes from shared/recap.ts; these only lay it
 * out: a small uppercase lead-in, one big number or headline, a line or two of context, an optional
 * small visual, and a footnote pinned to the bottom.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shell/Money";
import { colorAt } from "@/pages/stats/charts";
import { MONTH_LONG, MONTH_SHORT, WEEKDAY_SHORT, parts, weekday, type ISODate } from "../../../shared/dates";
import { parseMonthKey, type MonthKey, type Range } from "../../../shared/period";
import { pctChange, recapText, type RecapBudgets, type RecapCard } from "../../../shared/recap";

/** The chart hue each card is tinted with, in the order the cards run. */
const TINT: Record<RecapCard["kind"], string> = {
  cover: "var(--chart-rest)", total: "var(--chart-8)", categories: "var(--chart-1)", biggest: "var(--chart-2)", days: "var(--chart-4)",
  repeat: "var(--chart-7)", changes: "var(--chart-5)", inout: "var(--chart-3)", budgets: "var(--chart-3)", closer: "var(--chart-rest)",
};

export const longMonth = (k: MonthKey) => MONTH_LONG[parseMonthKey(k).m - 1];
const dayLabel = (d: ISODate) => `${WEEKDAY_SHORT[weekday(d)]} ${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
const shortDay = (d: ISODate) => `${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
/** "1–30 Sep", or "25 Sep – 24 Oct" when the logical month straddles two calendar months. */
function rangeLabel(r: Range): string {
  const a = parts(r.from), b = parts(r.to);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTH_SHORT[a.m - 1]}` : `${a.d} ${MONTH_SHORT[a.m - 1]} – ${b.d} ${MONTH_SHORT[b.m - 1]}`;
}
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---- the shared bones ----

/** The card surface: the page background with one chart hue mixed in (9%, 14% in dark mode; srgb, see the spec). */
export function CardFrame({ kind, children, className }: { kind: RecapCard["kind"]; children: ReactNode; className?: string }) {
  return (
    <section
      style={{ "--tint": TINT[kind] } as CSSProperties}
      className={cn(
        "flex h-full flex-col select-none px-7 pt-14 pb-9 text-foreground",
        "bg-[color-mix(in_srgb,var(--tint)_9%,var(--background))] dark:bg-[color-mix(in_srgb,var(--tint)_14%,var(--background))]",
        className,
      )}
    >
      {children}
    </section>
  );
}
const Label = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground", className)}>{children}</div>;
const Big = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("my-0.5 mb-2 text-5xl font-semibold leading-[1.05] tracking-[-0.03em] tabular", className)}>{children}</div>;
const H = ({ children, className }: { children: ReactNode; className?: string }) => <h2 className={cn("mb-2 text-[22px] font-semibold leading-tight tracking-[-0.02em]", className)}>{children}</h2>;
const Ctx = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("my-0.5 text-[15px] text-muted-foreground", className)}>{children}</p>;
const B = ({ children, className }: { children: ReactNode; className?: string }) => <b className={cn("font-medium text-foreground", className)}>{children}</b>;
const Foot = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-muted-foreground", className)}>{children}</div>;
const Tiles = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("mt-4 grid grid-cols-2 gap-2.5", className)}>{children}</div>;
function Tile({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card px-3 py-2.5", className)}>
      <Label className="mb-0.5">{label}</Label>
      <div className="truncate text-[17px] font-semibold tracking-[-0.01em]">{value}</div>
      {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
/** A footnote link. The card lets taps through to the zones beneath it; its controls catch them (pointer-events-auto). */
const FootLink = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className="pointer-events-auto inline-flex items-center gap-1 font-medium text-foreground">{children}<ChevronRight className="size-3.5" /></button>
);
/** A change in spending: less is drawn in the income colour, more in the expense colour. */
function Delta({ change }: { change: number }) {
  const { pct: p, less } = pctChange(change);
  if (p === 0) return <B>the same as</B>;
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium", less ? "text-income" : "text-expense")}>
      {less ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}{p}% {less ? "less" : "more"} than
    </span>
  );
}
function BudgetsTile({ budgets, className }: { budgets: RecapBudgets; className?: string }) {
  const { fmt } = useApp();
  return <Tile className={className} label="Budgets" value={`${budgets.held} of ${budgets.total} held`} hint={budgets.worst ? `${budgets.worst.name} went over by ${fmt(budgets.worst.over)}` : "All within budget"} />;
}

// ---- the cards ----

type Props<K extends RecapCard["kind"]> = { card: Extract<RecapCard, { kind: K }>; month: MonthKey; onClose?: () => void };

export function CoverCard({ card, month }: Props<"cover">) {
  const { y } = parseMonthKey(month);
  return (
    <CardFrame kind="cover">
      <div className="my-auto">
        <Label>{longMonth(month)} {y} · {rangeLabel(card.range)}</Label>
        <H className="mt-1.5 text-[34px] leading-[1.1]">Your {longMonth(month)}<br />recap</H>
        <Ctx className="mt-3.5"><B>{card.entries} entries</B> across {card.days} days</Ctx>
        <Ctx>{card.count} cards · about 30 seconds</Ctx>
      </div>
      <Foot><span>UnMoney</span><span className="inline-flex items-center gap-1 font-medium text-foreground">Tap to start<ChevronRight className="size-3.5" /></span></Foot>
    </CardFrame>
  );
}

export function TotalCard({ card }: Props<"total">) {
  return (
    <CardFrame kind="total">
      <Label>You spent</Label>
      <Big className="text-[56px]"><Money amount={card.amount} kind="expense" /></Big>
      {card.change !== undefined && card.prevLabel ? <Ctx className="flex items-center gap-1"><Delta change={card.change} /> {card.prevLabel}</Ctx> : null}
      <Ctx>about <B><Money amount={card.perDay} /> a day</B></Ctx>
      <Foot><span>Same as Expenses on Stats</span></Foot>
    </CardFrame>
  );
}

export function CategoriesCard({ card }: Props<"categories">) {
  const { fmt } = useApp();
  const n = card.top.length + card.rest.count;
  const lead = card.top[0];
  const row = (sw: string, p: number, name: ReactNode, amount: number, muted = false) => (
    <div key={String(name)} className={cn("flex items-center gap-2.5 border-b py-2 text-[15px] last:border-b-0", muted && "text-muted-foreground")}>
      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: sw }} />
      <span className="w-9 text-xs text-muted-foreground tabular">{pct(p)}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="tabular">{fmt(amount)}</span>
    </div>
  );
  return (
    <CardFrame kind="categories">
      <Label>Where it went</Label>
      <H>{lead.name} took the biggest slice</H>
      <div className="my-4 mb-3.5 flex h-3.5 gap-0.5 overflow-hidden rounded">
        {card.top.map((t, i) => <i key={t.id} className="block h-full" style={{ width: pct(t.pct), background: colorAt(i, n) }} />)}
        {card.rest.count ? <i className="block h-full flex-1" style={{ background: "var(--chart-rest)" }} /> : null}
      </div>
      <div>
        {card.top.map((t, i) => row(colorAt(i, n), t.pct, t.name, t.amount))}
        {card.rest.count ? row("var(--chart-rest)", card.rest.pct, `${card.rest.count} other ${card.rest.count === 1 ? "category" : "categories"}`, card.rest.amount, true) : null}
      </div>
      <Foot><span>{lead.name}: {card.lead.count} {card.lead.count === 1 ? "entry" : "entries"}, {fmt(card.lead.avg)} each on average</span></Foot>
    </CardFrame>
  );
}

export function BiggestCard({ card }: Props<"biggest">) {
  const nav = useNavigate();
  const { fmt, accountName, categoryLabel } = useApp();
  const tx = card.tx;
  const title = tx.note.trim() || categoryLabel(tx) || (tx.type === "transfer" ? `Transfer to ${accountName(tx.toAccountId)}` : "Uncategorised");
  const line = [tx.type === "transfer" ? "Transfer" : categoryLabel(tx) || "Uncategorised", accountName(tx.accountId), dayLabel(tx.date)].join(" · ");
  return (
    <CardFrame kind="biggest">
      <Label>Biggest single spend</Label>
      <Big><Money amount={tx.amount} kind="expense" /></Big>
      <H className="mt-1 line-clamp-2">{title}</H>
      <Ctx>{line}</Ctx>
      <Ctx className="mt-2.5"><B>{pct(card.share)}</B> of the month in one go</Ctx>
      <Foot>
        <span className="min-w-0 truncate">{card.runnersUp.length ? `Next: ${card.runnersUp.map((r) => `${r.note} ${fmt(r.amount)}`).join(" · ")}` : "The only entry that size"}</span>
        <FootLink onClick={() => nav(`/t/${tx._id}`)}>Open</FootLink>
      </Foot>
    </CardFrame>
  );
}

export function DaysCard({ card }: Props<"days">) {
  const busiest = card.perDay.find((d) => d.date === card.busiest)!;
  const max = Math.max(1, ...card.perDay.map((d) => d.amount));
  const mid = card.perDay[Math.floor(card.perDay.length / 2)];
  return (
    <CardFrame kind="days">
      <Label>Your days</Label>
      <H>Busiest: {dayLabel(card.busiest)}</H>
      <Ctx><B><Money amount={busiest.amount} /></B> in {busiest.count} {busiest.count === 1 ? "entry" : "entries"}</Ctx>
      <div className="mt-4 mb-1.5 flex h-[92px] items-end gap-[3px]">
        {card.perDay.map((d) => (
          <i
            key={d.date}
            className={cn("block flex-1 rounded-t-[2px]", d.amount === 0 ? "opacity-35" : d.date === card.busiest ? "bg-expense" : "bg-expense opacity-45")}
            style={{ height: d.amount === 0 ? 2 : `${Math.max(2, Math.round((d.amount / max) * 100))}%`, background: d.amount === 0 ? "var(--chart-rest)" : undefined }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{shortDay(card.perDay[0].date)}</span><span>{parts(mid.date).d}</span><span>{shortDay(card.perDay[card.perDay.length - 1].date)}</span></div>
      <Tiles>
        <Tile label="No-spend days" value={card.noSpend} />
        <Tile label="Weekends" value={<>{pct(card.weekendShare)} <span className="text-xs font-normal text-muted-foreground">of spend</span></>} />
      </Tiles>
      <Foot><span>Entries per day: {card.entriesPerDay.toFixed(1)} on average</span></Foot>
    </CardFrame>
  );
}

export function RepeatCard({ card }: Props<"repeat">) {
  const { fmt } = useApp();
  const note = card.note;
  return (
    <CardFrame kind="repeat">
      <Label>On repeat</Label>
      {note ? (
        <>
          <H className="line-clamp-2">“{note.text}” · {note.count} times</H>
          <Ctx><B><Money amount={note.amount} /></B> altogether · {fmt(Math.round(note.amount / note.count))} each</Ctx>
        </>
      ) : (
        <>
          <H>{card.scheduled!.count} scheduled {card.scheduled!.count === 1 ? "entry" : "entries"}</H>
          <Ctx><B><Money amount={card.scheduled!.amount} /></B> added on schedule</Ctx>
        </>
      )}
      <Tiles className="mt-5">
        {card.account ? <Tile label="Most used" value={card.account.name} hint={`${pct(card.account.share)} of spend`} /> : null}
        {card.scheduled ? <Tile label="Scheduled" value={<Money amount={card.scheduled.amount} />} hint={`${card.scheduled.count} ${card.scheduled.count === 1 ? "repeat" : "repeats"}`} /> : null}
      </Tiles>
      <Foot><span className="min-w-0 truncate">{card.nextNotes.length ? `Then ${card.nextNotes.map((n) => `“${n.text}” ×${n.count}`).join(" · ")}` : note ? "No other note came up more than once" : "No note came up three times"}</span></Foot>
    </CardFrame>
  );
}

/** "Shopping doubled", "Travel is new", "Transport: 40% less". */
function moverHeadline(m: { name: string; before: number; after: number }): string {
  if (m.before === 0) return `${m.name} is new`;
  if (m.after === 0) return `${m.name} dropped to nothing`;
  const ratio = m.after / m.before;
  if (ratio >= 2.95) return `${m.name} tripled`;
  if (ratio >= 1.95) return `${m.name} doubled`;
  if (ratio <= 0.52 && ratio >= 0.48) return `${m.name} halved`;
  const { pct: p, less } = pctChange(ratio - 1);
  return `${m.name}: ${p}% ${less ? "less" : "more"}`;
}

export function ChangesCard({ card }: Props<"changes">) {
  const { fmt } = useApp();
  const first = card.movers[0];
  return (
    <CardFrame kind="changes">
      <Label>What changed since {card.prevLabel}</Label>
      <H className="line-clamp-2">{moverHeadline(first)}</H>
      <div>
        {card.movers.map((m) => {
          const up = m.after > m.before;
          const delta = m.before === 0 ? "new" : m.after === 0 ? "gone" : `${up ? "+" : "−"}${pctChange(m.pct!).pct}%`;
          return (
            <div key={m.id} className="flex items-center gap-3 border-b py-3 last:border-b-0">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", up ? "bg-expense/15 text-expense" : "bg-income/15 text-income")}>{up ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}</span>
              <span className="min-w-0 flex-1 text-[15px]"><span className="block truncate">{m.name}</span><small className="block text-xs text-muted-foreground tabular">{fmt(m.before)} → {fmt(m.after)}</small></span>
              <span className={cn("font-medium tabular", up ? "text-expense" : "text-income")}>{delta}</span>
            </div>
          );
        })}
      </div>
      <Foot><span>Only categories that moved by more than {fmt(Math.round(card.threshold))}</span></Foot>
    </CardFrame>
  );
}

export function InOutCard({ card }: Props<"inout">) {
  const spentShare = Math.min(1, card.spent / card.income);
  const row = (sw: string, name: string, amount: ReactNode) => (
    <div className="flex items-center gap-2.5 py-1 text-[15px]"><span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: sw }} /><span className="flex-1">{name}</span>{amount}</div>
  );
  return (
    <CardFrame kind="inout">
      <Label>In vs out</Label>
      <Big className="mb-0">{card.keptPct}%</Big>
      <H className="mt-0">of what came in, {card.keptPct < 0 ? "and more, spent" : "kept"}</H>
      <div className="mt-3.5 mb-2 flex h-3 gap-1.5 overflow-hidden rounded">
        <i className="block h-full bg-expense" style={{ width: pct(spentShare) }} />
        {spentShare < 1 ? <i className="block h-full flex-1 bg-income" /> : null}
      </div>
      {row("var(--income)", "Income", <Money amount={card.income} kind="income" />)}
      {row("var(--expense)", "Spent", <Money amount={card.spent} kind="expense" />)}
      {row("var(--chart-rest)", "Kept", <Money amount={card.income - card.spent} />)}
      {card.budgets ? <Tiles className="mt-4"><BudgetsTile budgets={card.budgets} className="col-span-full" /></Tiles> : null}
      <Foot><span>{card.prevKeptPct !== undefined ? `Last month: ${card.prevKeptPct}% kept` : "No income recorded the month before"}</span></Foot>
    </CardFrame>
  );
}

export function BudgetsCard({ card }: Props<"budgets">) {
  const { fmt } = useApp();
  const b = card.budgets;
  return (
    <CardFrame kind="budgets">
      <Label>Budgets</Label>
      <H>{b.held} of {b.total} held</H>
      <Ctx>{b.worst ? <><B>{b.worst.name}</B> went over by <B><Money amount={b.worst.over} kind="expense" /></B></> : "Every budget stayed within its limit"}</Ctx>
      <Tiles><Tile label="Held" value={b.held} /><Tile label="Over" value={b.total - b.held} hint={b.worst ? `worst: ${fmt(b.worst.over)}` : undefined} /></Tiles>
      <Foot><span>No income was recorded this month</span></Foot>
    </CardFrame>
  );
}

export function CloserCard({ card, month, onClose }: Props<"closer">) {
  const nav = useNavigate();
  const { fmt } = useApp();
  const s = card.summary;
  const [copied, setCopied] = useState(false);
  const name = longMonth(month);
  async function copy() {
    const text = recapText(s, `${name} ${parseMonthKey(month).y}`, fmt);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Summary copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Your browser may not allow it here.");
    }
  }
  const change = s.change !== undefined && s.prevLabel ? pctChange(s.change) : undefined;
  return (
    <CardFrame kind="closer">
      <Label>{name} in one card</Label>
      <Tiles className="mt-1">
        <Tile label="Spent" value={<Money amount={s.spent} kind="expense" />} hint={change ? `${change.pct === 0 ? "same as" : `${change.less ? "↓" : "↑"} ${change.pct}% vs`} ${s.prevLabel!.slice(0, 3)}` : undefined} />
        <Tile label="Top category" value={s.top?.name ?? "—"} hint={s.top ? pct(s.top.pct) : undefined} />
        <Tile label="Biggest spend" value={s.biggest ? <Money amount={s.biggest.amount} /> : "—"} hint={s.biggest?.note} />
        <Tile label="Kept" value={s.keptPct !== undefined ? `${s.keptPct}%` : "—"} hint={s.keptPct !== undefined ? "of income" : "no income logged"} />
        <Tile label="No-spend days" value={s.noSpend} />
        <Tile label="On repeat" value={s.repeat ? `${s.repeat.text} ×${s.repeat.count}` : "—"} />
      </Tiles>
      <div className="pointer-events-auto mt-4 flex flex-col gap-2">
        <Button size="lg" className="h-10 w-full" onClick={() => nav(`/stats?month=${month}`)}>Open {name} in Stats</Button>
        <Button size="lg" variant="outline" className="h-10 w-full" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy summary"}</Button>
      </div>
      <Foot><span>Recaps stay on Stats for every month</span><FootLink onClick={onClose}>Done</FootLink></Foot>
    </CardFrame>
  );
}

/** The card for a `kind`. */
export function RecapCardView({ card, month, onClose }: { card: RecapCard; month: MonthKey; onClose: () => void }) {
  switch (card.kind) {
    case "cover": return <CoverCard card={card} month={month} />;
    case "total": return <TotalCard card={card} month={month} />;
    case "categories": return <CategoriesCard card={card} month={month} />;
    case "biggest": return <BiggestCard card={card} month={month} />;
    case "days": return <DaysCard card={card} month={month} />;
    case "repeat": return <RepeatCard card={card} month={month} />;
    case "changes": return <ChangesCard card={card} month={month} />;
    case "inout": return <InOutCard card={card} month={month} />;
    case "budgets": return <BudgetsCard card={card} month={month} />;
    case "closer": return <CloserCard card={card} month={month} onClose={onClose} />;
  }
}
