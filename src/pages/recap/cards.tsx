/**
 * One component per recap card kind (spec §4.1–4.3). Every number comes from shared/recap.ts;
 * these only lay it out: a lead-in label with the card's tint square, one big number or
 * headline, a line or two of context, a visual that fills the middle, and a footnote at the
 * bottom. The card lets taps through to the zones beneath it; its buttons and links catch them.
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
import { pctChange, recapText, type RecapBudgets, type RecapCard, type RecapStrip } from "../../../shared/recap";
import type { Tx } from "../../../shared/views";

/** The chart hue each card is tinted with, in the order the cards run. */
const TINT: Record<RecapCard["kind"], string> = {
  cover: "var(--chart-rest)", total: "var(--chart-8)", categories: "var(--chart-1)", biggest: "var(--chart-2)", days: "var(--chart-4)",
  repeat: "var(--chart-7)", changes: "var(--chart-5)", inout: "var(--chart-3)", budgets: "var(--chart-3)", closer: "var(--chart-rest)",
};
/** Text drawn on a solid chart colour: a fixed near-black in both themes (spec §4.2). */
const ON_CHART = "oklch(0.145 0 0)";
const ON_SIGNAL = "oklch(0.985 0 0)";
const REST = "var(--chart-rest)";

export const longMonth = (k: MonthKey) => MONTH_LONG[parseMonthKey(k).m - 1];
const dayLabel = (d: ISODate) => `${WEEKDAY_SHORT[weekday(d)]} ${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
const shortDay = (d: ISODate) => `${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
/** "1–30 Sep", or "25 Sep – 24 Oct" when the logical month straddles two calendar months. */
function rangeLabel(r: Range): string {
  const a = parts(r.from), b = parts(r.to);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTH_SHORT[a.m - 1]}` : `${a.d} ${MONTH_SHORT[a.m - 1]} – ${b.d} ${MONTH_SHORT[b.m - 1]}`;
}
const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ---- the shared bones ----

/** The card surface: the page background with one chart hue mixed in (9%, 14% in dark mode; srgb, see the spec). */
export function CardFrame({ kind, children, className }: { kind: RecapCard["kind"]; children: ReactNode; className?: string }) {
  return (
    <section
      style={{ "--tint": TINT[kind] } as CSSProperties}
      className={cn(
        "flex h-full flex-col select-none px-6 pt-14 pb-7 text-foreground",
        "bg-[color-mix(in_srgb,var(--tint)_9%,var(--background))] dark:bg-[color-mix(in_srgb,var(--tint)_14%,var(--background))]",
        className,
      )}
    >
      {children}
    </section>
  );
}
const Label = ({ children }: { children: ReactNode }) => (
  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
    <i className="size-1.5 shrink-0 rounded-[2px]" style={{ background: "var(--tint)" }} />{children}
  </div>
);
const Num = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("mt-1 mb-2.5 text-[60px] font-semibold leading-none tracking-[-0.04em] tabular", className)}>{children}</div>;
const H = ({ children, className, xl }: { children: ReactNode; className?: string; xl?: boolean }) => (
  <h2 className={cn("mb-1.5 font-semibold", xl ? "text-[44px] leading-none tracking-[-0.035em]" : "text-2xl leading-[1.15] tracking-[-0.02em]", className)}>{children}</h2>
);
const Ctx = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("my-0.5 text-[15px] text-muted-foreground", className)}>{children}</p>;
const B = ({ children, className }: { children: ReactNode; className?: string }) => <b className={cn("font-medium text-foreground", className)}>{children}</b>;
/** The middle of the card: whatever is in it is vertically centred in the space the top and the footnote leave. */
const Vis = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("flex min-h-0 flex-1 flex-col justify-center", className)}>{children}</div>;
const Foot = ({ children }: { children: ReactNode }) => <div className="mt-3.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">{children}</div>;
const FootLink = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className="pointer-events-auto inline-flex shrink-0 items-center gap-1 font-medium text-foreground">{children}<ChevronRight className="size-3.5" /></button>
);
const Tiles = ({ children, three, className }: { children: ReactNode; three?: boolean; className?: string }) => <div className={cn("mt-3.5 grid gap-2", three ? "grid-cols-3" : "grid-cols-2", className)}>{children}</div>;
function Tile({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card px-[11px] py-[9px]", className)}>
      <div className="mb-px text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className="truncate text-[17px] font-semibold tracking-[-0.01em]">{value}</div>
      {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
const Swatch = ({ color }: { color: string }) => <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
/** A legend row: swatch, name, amount; three cells of the grid that holds them. */
const legendRow = (key: string, color: string, name: ReactNode, amount: ReactNode, muted = false) => [
  <Swatch key={`${key}-s`} color={color} />,
  <span key={`${key}-n`} className={cn("truncate", muted && "text-muted-foreground")}>{name}</span>,
  <span key={`${key}-a`} className={cn("text-right tabular", muted && "text-muted-foreground")}>{amount}</span>,
];
const Legend = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-[5px] text-[13px]", className)}>{children}</div>;
/** The month's colour signature: the top three categories at their share, the rest grey. Same order and colours as card 3 and Stats. */
function Strip({ strip, className }: { strip: RecapStrip; className?: string }) {
  if (!strip.length) return null;
  return (
    <div className={cn("flex h-2.5 gap-0.5 overflow-hidden rounded-[3px]", className)}>
      {strip.map((c, i) => <i key={c.id} className="block h-full" style={{ width: pct(c.pct), background: colorAt(i, strip.length + 1) }} />)}
      <i className="block h-full flex-1" style={{ background: REST }} />
    </div>
  );
}
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
      <Vis>
        <Label>Your recap</Label>
        <H xl>{longMonth(month)}</H>
        <H xl className="mt-0.5 font-medium text-muted-foreground">{y}</H>
        <Ctx className="mt-[18px]"><B>{plural(card.entries, "entry", "entries")}</B> across {plural(card.days, "day")}</Ctx>
        <Ctx>{rangeLabel(card.range)} · {plural(card.count, "card")} · about 30 seconds</Ctx>
      </Vis>
      <Strip strip={card.strip} />
      <Foot><span>UnMoney</span><span className="inline-flex items-center gap-1 font-medium text-foreground">Tap to start<ChevronRight className="size-3.5" /></span></Foot>
    </CardFrame>
  );
}

export function TotalCard({ card, month }: Props<"total">) {
  const { fmt } = useApp();
  const max = Math.max(card.amount, card.prev ?? 0, 1);
  const bar = (label: string, amount: number, now: boolean) => (
    <div className="my-1.5 grid grid-cols-[44px_1fr_auto] items-center gap-2.5 text-[13px]">
      <span className={now ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
      <i className={cn("block h-[26px] rounded", now ? "bg-expense" : "opacity-45")} style={{ width: pct(amount / max), background: now ? undefined : REST }} />
      <span className={cn("font-medium tabular", !now && "text-muted-foreground")}>{fmt(amount)}</span>
    </div>
  );
  return (
    <CardFrame kind="total">
      <Vis>
        <Label>You spent</Label>
        <Num><Money amount={card.amount} kind="expense" /></Num>
        {card.change !== undefined && card.prevLabel ? <Ctx className="flex items-center gap-1"><Delta change={card.change} /> {card.prevLabel}</Ctx> : null}
        <Ctx>about <B><Money amount={card.perDay} /> a day</B></Ctx>
        <div className="mt-7">
          {card.prev !== undefined && card.prevLabel ? bar(card.prevLabel.slice(0, 3), card.prev, false) : null}
          {bar(longMonth(month).slice(0, 3), card.amount, true)}
        </div>
      </Vis>
      <Foot><span>The same figure as Expenses on Stats</span></Foot>
    </CardFrame>
  );
}

export function CategoriesCard({ card, month }: Props<"categories">) {
  const nav = useNavigate();
  const { fmt } = useApp();
  const n = card.top.length + card.rest.count;
  const lead = card.top[0];
  return (
    <CardFrame kind="categories">
      <Label>Where it went</Label>
      <H>{lead.name} took the biggest slice</H>
      <Ctx><B><Money amount={lead.amount} /></B> · {plural(card.lead.count, "entry", "entries")} · {fmt(card.lead.avg)} each on average</Ctx>
      <Vis>
        <div className="my-3.5 mb-3 flex max-h-[280px] min-h-[190px] flex-1 flex-col gap-[3px] overflow-hidden rounded-lg">
          {card.top.map((t, i) => (
            <div key={t.id} className="flex min-h-6 items-center justify-between px-3 text-sm font-medium" style={{ flex: Math.max(t.pct, 0.02), background: colorAt(i, n), color: ON_CHART }}>
              <span className="min-w-0 truncate">{t.name}</span><span className="ml-2 font-normal opacity-80">{pct(t.pct)}</span>
            </div>
          ))}
          {card.rest.count ? (
            <div className="flex min-h-6 items-center justify-between px-3 text-sm font-medium text-foreground" style={{ flex: Math.max(card.rest.pct, 0.02), background: REST }}>
              <span className="min-w-0 truncate">{plural(card.rest.count, "other category", "other categories")}</span><span className="ml-2 font-normal opacity-80">{pct(card.rest.pct)}</span>
            </div>
          ) : null}
        </div>
        <Legend>
          {card.top.map((t, i) => legendRow(t.id, colorAt(i, n), t.name, fmt(t.amount)))}
          {card.rest.count ? legendRow("rest", REST, "Everything else", fmt(card.rest.amount), true) : null}
        </Legend>
      </Vis>
      <Foot><span>{plural(n, "category", "categories")} in all</span><FootLink onClick={() => nav(`/stats?month=${month}`)}>Open Stats</FootLink></Foot>
    </CardFrame>
  );
}

export function BiggestCard({ card }: Props<"biggest">) {
  const nav = useNavigate();
  const { accountName, categoryLabel } = useApp();
  const title = (tx: Tx) => tx.note.trim() || categoryLabel(tx) || (tx.type === "transfer" ? `Transfer to ${accountName(tx.toAccountId)}` : "Uncategorised");
  const line = (tx: Tx) => [tx.type === "transfer" ? "Transfer" : categoryLabel(tx) || "Uncategorised", accountName(tx.accountId), dayLabel(tx.date)].join(" · ");
  const rows = [{ tx: card.tx, note: title(card.tx), amount: card.tx.amount }, ...card.runnersUp];
  const together = rows.length === 1 ? "The one entry" : rows.length === 2 ? "Top two together" : "Top three together";
  return (
    <CardFrame kind="biggest">
      <Vis>
        <Label>Biggest single spend</Label>
        <Num><Money amount={card.tx.amount} kind="expense" /></Num>
        <H className="line-clamp-2">{title(card.tx)}</H>
        <Ctx><B>{pct(card.share)}</B> of the month in one entry</Ctx>
        <div className="mt-[22px] overflow-hidden rounded-lg border bg-card">
          {rows.map((r, i) => (
            <div key={r.tx._id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
              <span className="w-4 text-center text-xs text-muted-foreground">{i + 1}</span>
              <div className={cn("min-w-0 flex-1 text-sm", i === 0 && "font-medium")}><span className="block truncate">{r.note}</span><small className="block truncate text-xs font-normal text-muted-foreground">{line(r.tx)}</small></div>
              <Money amount={r.amount} kind="expense" className="text-sm" />
            </div>
          ))}
        </div>
      </Vis>
      <Foot><span>{together}: {pct(card.topShare)} of the month</span><FootLink onClick={() => nav(`/t/${card.tx._id}`)}>Open entry</FootLink></Foot>
    </CardFrame>
  );
}

export function DaysCard({ card }: Props<"days">) {
  const days = card.perDay;
  const bi = days.findIndex((d) => d.date === card.busiest);
  const busiest = days[bi];
  const max = Math.max(1, ...days.map((d) => d.amount));
  const at = (f: number) => parts(days[Math.round((days.length - 1) * f)].date).d;
  const calloutRight = bi > days.length * 0.6;
  const callout = `${WEEKDAY_SHORT[weekday(card.busiest)]} ${parts(card.busiest).d}`;
  return (
    <CardFrame kind="days">
      <Label>Your days</Label>
      <H>Busiest: {dayLabel(card.busiest)}</H>
      <Ctx className="truncate"><B><Money amount={busiest.amount} /></B> in {plural(busiest.count, "entry", "entries")}{card.busiestNotes.length ? ` · ${joinAnd(card.busiestNotes)}` : ""}</Ctx>
      <Vis>
        <div className="relative my-1.5 flex h-[150px] items-end gap-[3px]">
          <span
            className="absolute top-0 text-[11px] whitespace-nowrap text-muted-foreground"
            style={calloutRight ? { right: pct((days.length - bi - 0.5) / days.length) } : { left: pct((bi + 0.5) / days.length) }}
          >
            {calloutRight ? `${callout} →` : `← ${callout}`}
          </span>
          {days.map((d) => {
            const wk = weekday(d.date) === 0 || weekday(d.date) === 6;
            const zero = d.amount === 0;
            return (
              <i
                key={d.date}
                className={cn("block flex-1 rounded-t-[2px]", zero ? "opacity-40" : d.date === card.busiest ? "bg-expense" : wk ? "bg-expense opacity-55" : "bg-expense opacity-40")}
                style={{ height: zero ? 3 : `${Math.max(2, Math.round((d.amount / max) * 100))}%`, background: zero ? REST : undefined }}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{shortDay(days[0].date)}</span><span>{at(0.25)}</span><span>{at(0.5)}</span><span>{at(0.75)}</span><span>{shortDay(days[days.length - 1].date)}</span>
        </div>
        <Tiles three>
          <Tile label="No-spend" value={plural(card.noSpend, "day")} />
          <Tile label="Weekends" value={pct(card.weekendShare)} hint="of spend" />
          <Tile label="Per day" value={card.entriesPerDay.toFixed(1)} hint="entries" />
        </Tiles>
      </Vis>
      <Foot><span>Lighter bars are weekends</span></Foot>
    </CardFrame>
  );
}

export function RepeatCard({ card }: Props<"repeat">) {
  const { fmt } = useApp();
  const note = card.note;
  const bars = note ? [{ text: note.text, count: note.count }, ...card.nextNotes] : [];
  return (
    <CardFrame kind="repeat">
      <Vis>
        <Label>On repeat</Label>
        {note ? (
          <>
            <H xl className="line-clamp-2">“{note.text}”</H>
            <Ctx className="mt-1.5"><B>{note.count} times</B> · {fmt(note.amount)} altogether · {fmt(Math.round(note.amount / note.count))} each</Ctx>
            <div className="mt-[22px]">
              {bars.map((b, i) => (
                <div key={b.text} className="my-1.5 grid grid-cols-[72px_1fr_28px] items-center gap-2.5 text-[13px]">
                  <span className={cn("truncate", i === 0 ? "font-medium text-foreground" : "text-muted-foreground")}>{b.text}</span>
                  <i className={cn("block h-[22px] rounded", i === 0 ? "opacity-100" : "opacity-35")} style={{ width: pct(b.count / note.count), background: "var(--tint)" }} />
                  <span className="text-right font-medium tabular">{b.count}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <H>{plural(card.scheduled!.count, "scheduled entry", "scheduled entries")}</H>
            <Ctx><B><Money amount={card.scheduled!.amount} /></B> added on schedule</Ctx>
          </>
        )}
        <Tiles>
          {card.account ? <Tile label="Most used method" value={card.account.name} hint={`${pct(card.account.share)} of spend`} /> : null}
          {card.scheduled ? <Tile label="Scheduled" value={<Money amount={card.scheduled.amount} />} hint={plural(card.scheduled.count, "repeat")} /> : null}
        </Tiles>
      </Vis>
      <Foot><span>Notes matched ignoring case</span></Foot>
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
  const [first, ...others] = card.movers;
  const fallers = card.movers.filter((m) => m.after < m.before).map((m) => m.name);
  const biggest = Math.max(1, ...card.movers.map((m) => Math.abs(m.after - m.before)));
  const line = fallers.length ? `${joinAnd(fallers)} fell` : others.length ? `${joinAnd(others.map((m) => m.name))} rose too` : "Nothing else moved by much";
  return (
    <CardFrame kind="changes">
      <Label>What changed since {card.prevLabel}</Label>
      <H className="line-clamp-2">{moverHeadline(first)}</H>
      <Ctx className="truncate">{line}</Ctx>
      <Vis>
        {card.movers.map((m) => {
          const up = m.after > m.before;
          const delta = m.before === 0 ? "new" : m.after === 0 ? "gone" : `${up ? "+" : "−"}${pctChange(m.pct!).pct}%`;
          return (
            <div key={m.id} className="grid grid-cols-[1fr_96px_auto] items-center gap-3 border-b py-2.5 last:border-b-0">
              <div className="min-w-0 text-[15px]"><span className="block truncate">{m.name}</span><small className="block text-xs text-muted-foreground tabular">{fmt(m.before)} → {fmt(m.after)}</small></div>
              <div className="relative h-[18px]">
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-muted-foreground/50" />
                <i className={cn("absolute top-[3px] block h-3 rounded-[3px]", up ? "left-1/2 bg-expense" : "right-1/2 bg-income")} style={{ width: pct((Math.abs(m.after - m.before) / biggest) * 0.5) }} />
              </div>
              <span className={cn("text-right text-sm font-medium whitespace-nowrap tabular", up ? "text-expense" : "text-income")}>{delta}</span>
            </div>
          );
        })}
      </Vis>
      <Foot><span>Only moves above 5% of the month's total</span></Foot>
    </CardFrame>
  );
}

export function InOutCard({ card }: Props<"inout">) {
  const { fmt } = useApp();
  const spentShare = Math.min(1, card.spent / card.income);
  return (
    <CardFrame kind="inout">
      <Vis>
        <Label>In vs out</Label>
        <Num>{card.keptPct}%</Num>
        <H className="-mt-1">of what came in, {card.keptPct < 0 ? "and more, spent" : "kept"}</H>
        <div className="my-3.5 mb-2.5 flex h-12 gap-1 overflow-hidden rounded-md">
          <i className="flex h-full items-center overflow-hidden bg-expense px-2.5 text-[13px] font-medium whitespace-nowrap" style={{ width: spentShare < 1 ? pct(spentShare) : undefined, flex: spentShare < 1 ? undefined : 1, color: ON_SIGNAL }}>Spent {fmt(card.spent)}</i>
          {spentShare < 1 ? <i className="flex h-full flex-1 items-center overflow-hidden bg-income px-2.5 text-[13px] font-medium whitespace-nowrap" style={{ color: ON_SIGNAL }}>Kept</i> : null}
        </div>
        <Legend className="mb-1.5">
          {legendRow("in", "var(--income)", "Income", <Money amount={card.income} kind="income" />)}
          {legendRow("out", "var(--expense)", "Spent", <Money amount={card.spent} kind="expense" />)}
          {legendRow("kept", REST, "Kept", <Money amount={card.income - card.spent} />)}
        </Legend>
        {card.budgets ? <Tiles><BudgetsTile budgets={card.budgets} className="col-span-full" /></Tiles> : null}
      </Vis>
      <Foot><span>{card.prevKeptPct !== undefined ? `Last month: ${card.prevKeptPct}% kept` : "No income recorded the month before"}</span></Foot>
    </CardFrame>
  );
}

export function BudgetsCard({ card }: Props<"budgets">) {
  const { fmt } = useApp();
  const b = card.budgets;
  return (
    <CardFrame kind="budgets">
      <Vis>
        <Label>Budgets</Label>
        <H>{b.held} of {b.total} held</H>
        <Ctx>{b.worst ? <><B>{b.worst.name}</B> went over by <B><Money amount={b.worst.over} kind="expense" /></B></> : "Every budget stayed within its limit"}</Ctx>
        <Tiles><Tile label="Held" value={b.held} /><Tile label="Over" value={b.total - b.held} hint={b.worst ? `worst: ${fmt(b.worst.over)}` : undefined} /></Tiles>
      </Vis>
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
  const { y } = parseMonthKey(month);
  async function copy() {
    try {
      await navigator.clipboard.writeText(recapText(s, `${name} ${y}`, fmt));
      setCopied(true);
      toast.success("Summary copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Your browser may not allow it here.");
    }
  }
  const change = s.change !== undefined && s.prevLabel ? pctChange(s.change) : undefined;
  const row = (label: string, value: ReactNode, key: string) => (
    <div key={key} className="flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0 lg:py-1.5">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span><b className="min-w-0 truncate text-right font-medium">{value}</b>
    </div>
  );
  return (
    <CardFrame kind="closer">
      <Label>Keep this one</Label>
      <Vis>
        {/* the poster: the thing to keep (and later share as an image), so the actions stay outside it */}
        {/* on a wide screen the card is 560 px tall, so the poster's rows and title tighten a little to fit without scrolling */}
        <div className="rounded-[14px] border bg-card px-4 pt-4 pb-3 shadow-card lg:pt-3">
          <div className="mb-3 flex items-start justify-between lg:mb-2">
            <div className="text-[30px] font-semibold leading-none tracking-[-0.03em] lg:text-[26px]">{name}<br /><span className="font-medium text-muted-foreground">{y}</span></div>
            <span className="mt-1 text-xs font-semibold tracking-[-0.01em]">UnMoney</span>
          </div>
          <Strip strip={s.strip} className="mb-1.5" />
          {row("Spent", <Money amount={s.spent} kind="expense" />, "spent")}
          {change ? row(`vs ${s.prevLabel}`, <span className={change.less ? "text-income" : "text-expense"}>{change.pct === 0 ? "the same" : `${change.less ? "↓" : "↑"} ${change.pct}% ${change.less ? "less" : "more"}`}</span>, "vs") : null}
          {row("Top category", s.top ? `${s.top.name} · ${pct(s.top.pct)}` : "—", "top")}
          {row("Biggest spend", s.biggest ? `${s.biggest.note} · ${fmt(s.biggest.amount)}` : "—", "big")}
          {row("Kept", s.keptPct !== undefined ? `${s.keptPct}% of income` : "no income logged", "kept")}
          {row("No-spend days", s.noSpend, "nospend")}
          {row("On repeat", s.repeat ? `“${s.repeat.text}” ×${s.repeat.count}` : "—", "repeat")}
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{rangeLabel(s.range)} · {plural(s.entries, "entry", "entries")}</span><span>unmoney.vercel.app</span></div>
        </div>
        <div className="pointer-events-auto mt-3.5 flex gap-2 lg:mt-3">
          <Button size="lg" className="h-10 flex-1 lg:h-9" onClick={() => nav(`/stats?month=${month}`)}>Open in Stats</Button>
          <Button size="lg" variant="outline" className="h-10 flex-1 lg:h-9" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy summary"}</Button>
        </div>
      </Vis>
      <Foot><span>Every month's recap stays on Stats</span><FootLink onClick={onClose}>Done</FootLink></Foot>
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
