/**
 * One component per recap card kind (monthly spec §4.1–4.3, yearly spec §4). Every number comes
 * from shared/recap.ts; these only lay it out: a lead-in label with the card's tint square, one
 * big number or headline, a line or two of context, a visual that fills the middle, and a
 * footnote at the bottom. The card lets taps through to the zones beneath it; its buttons and
 * links catch them, and so do the parts that open their entries in the drawer (a category, a day's
 * bar, a note: see drill.ts). The cards a month and a year share switch their copy on `card.scope`.
 */
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowDown, ArrowUp, ChevronRight, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shell/Money";
import { colorAt } from "@/lib/theme";
import { longMonth } from "@/lib/format";
import { diffDays, MONTH_LONG, MONTH_SHORT, WEEKDAY_SHORT, parts, weekday, type ISODate } from "../../../shared/dates";
import { parseMonthKey, type MonthKey, type Range } from "../../../shared/period";
import { pctChange, type RecapBudgets, type RecapCard, type RecapDrill, type RecapStrip } from "../../../shared/recap";
import type { Tx } from "../../../shared/views";
import { useDrill, useHints } from "./drill";
import { MARK, posterImage, posterRows, type Poster, type PosterRow } from "./poster";
import { Logo } from "@/components/shell/Logo";

/** The chart hue each card is tinted with, in the order the cards run. */
const TINT: Record<RecapCard["kind"], string> = {
  cover: "var(--chart-rest)", total: "var(--chart-8)", categories: "var(--chart-1)", biggest: "var(--chart-2)", days: "var(--chart-4)",
  repeat: "var(--chart-7)", changes: "var(--chart-5)", inout: "var(--chart-3)", budgets: "var(--chart-3)", closer: "var(--chart-rest)",
  months: "var(--chart-4)", top5: "var(--chart-7)", calendar: "var(--chart-8)", clock: "var(--chart-6)", methods: "var(--chart-3)", new: "var(--chart-4)", personality: "var(--chart-7)",
};
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Text drawn on a solid chart colour: a fixed near-black in both themes (spec §4.2). */
const ON_CHART = "oklch(0.145 0 0)";
const ON_SIGNAL = "oklch(0.985 0 0)";
const REST = "var(--chart-rest)";

export { longMonth };
export const dayLabel = (d: ISODate) => `${WEEKDAY_SHORT[weekday(d)]} ${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
const shortDay = (d: ISODate) => `${parts(d).d} ${MONTH_SHORT[parts(d).m - 1]}`;
/** "1–30 Sep", or "25 Sep – 24 Oct" when the logical month straddles two calendar months. */
function rangeLabel(r: Range): string {
  const a = parts(r.from), b = parts(r.to);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTH_SHORT[a.m - 1]}` : `${a.d} ${MONTH_SHORT[a.m - 1]} – ${b.d} ${MONTH_SHORT[b.m - 1]}`;
}
/** "25 Jan 2026 – 24 Jan 2027": a logical year that straddles two calendar years (month start day ≠ 1). */
const yearRangeLabel = (r: Range) => `${shortDay(r.from)} ${parts(r.from).y} – ${shortDay(r.to)} ${parts(r.to).y}`;
/** "8 pm" */
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
/** "8–9 pm", or "11 am – 12 pm" across noon or midnight. */
export function hourRange(h: number): string {
  const next = (h + 1) % 24;
  return h < 12 === next < 12 ? `${h % 12 || 12}–${next % 12 || 12} ${h < 12 ? "am" : "pm"}` : `${hourLabel(h)} – ${hourLabel(next)}`;
}
/** "05:40" → "5:40 am" */
function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
/** The Stats page for a month key or a year key. */
const statsPath = (key: string) => (/^\d{4}$/.test(key) ? `/stats?period=yearly&year=${key}` : `/stats?month=${key}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
/** "34% kept", or "120% spent" when more went out than came in: a negative share kept reads badly. */
const keptText = (keptPct: number) => (keptPct < 0 ? `${100 - keptPct}% spent` : `${keptPct}% kept`);
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
function Tile({ label, value, hint, className, drill }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string; drill?: RecapDrill }) {
  const body = (
    <>
      <div className="mb-px flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}{drill ? <ChevronRight className="size-3" /> : null}</div>
      <div className="truncate text-[17px] font-semibold tracking-[-0.01em]">{value}</div>
      {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  const box = cn("min-w-0 rounded-lg border bg-card px-[11px] py-[9px]", className);
  return drill ? <Tap drill={drill} className={box}>{body}</Tap> : <div className={box}>{body}</div>;
}
/**
 * A part of a card that opens its entries in the drawer. It catches the tap the zones beneath the
 * card would take, so a tap on it never steps to the next card (a swipe still does).
 */
function Tap({ drill, children, className, style, label, hint }: {
  drill: RecapDrill; children?: ReactNode; className?: string; style?: CSSProperties; label?: string;
  /** Point at this one with a pulsing dot while hints are on: true for its centre, or the dot's position classes. */
  hint?: boolean | string;
}) {
  const open = useDrill();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => open(drill)}
      style={style}
      className={cn("pointer-events-auto relative cursor-pointer text-left transition-opacity hover:opacity-85 active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", className)}
    >
      {children}
      {hint ? <HintDot className={typeof hint === "string" ? hint : undefined} /> : null}
    </button>
  );
}
/**
 * A pulsing white dot over one tappable part of a card, so the first recap shows what can be
 * tapped. One per card, and only until the user first opens a drawer (RecapPage turns them off).
 */
function HintDot({ className }: { className?: string }) {
  if (!useHints()) return null;
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute z-10 flex size-2.5 animate-in fade-in-0 duration-700", className ?? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2")}>
      <span className="absolute inline-flex size-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2.5 rounded-full bg-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.25)]" />
    </span>
  );
}
/** Where a hint dot sits for a row: in the card's left gutter, level with the row. */
const GUTTER = "-left-[18px] top-1/2 -translate-y-1/2";
/** For a bar: near its foot, centred. */
const BAR_FOOT = "bottom-2 left-1/2 -translate-x-1/2";
/** A legend row that opens its entries: the three cells of `legendRow` on the Legend's own columns. */
const TapRow = ({ drill, children, hint }: { drill: RecapDrill; children: ReactNode; hint?: boolean | string }) => (
  <Tap drill={drill} hint={hint} className="col-span-3 -mx-1.5 grid grid-cols-subgrid items-center rounded px-1.5 py-px">{children}</Tap>
);
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
  if (card.scope === "year") {
    const straddles = parts(card.range.from).d !== 1;
    return (
      <CardFrame kind="cover">
        <Vis>
          <Label>Your year in money</Label>
          <div className="mb-1.5 text-[88px] font-semibold leading-none tracking-[-0.05em]">{month}</div>
          <Ctx className="mt-[18px]"><B>{plural(card.entries, "entry", "entries")}</B> across {plural(card.days, "day")}</Ctx>
          <Ctx>{straddles ? `${yearRangeLabel(card.range)} · ` : ""}{plural(card.count, "card")} · under a minute</Ctx>
        </Vis>
        <Strip strip={card.strip} />
        <Foot><span>UnMoney</span><span className="inline-flex items-center gap-1 font-medium text-foreground">Tap to start<ChevronRight className="size-3.5" /></span></Foot>
      </CardFrame>
    );
  }
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
  const year = card.scope === "year";
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
        {year && card.perMonth !== undefined
          ? <Ctx>about <B><Money amount={card.perMonth} /> a month</B> · <Money amount={card.perDay} /> a day</Ctx>
          : <Ctx>about <B><Money amount={card.perDay} /> a day</B></Ctx>}
        <div className="mt-7">
          {card.prev !== undefined && card.prevLabel ? bar(year ? card.prevLabel : card.prevLabel.slice(0, 3), card.prev, false) : null}
          {bar(year ? month : longMonth(month).slice(0, 3), card.amount, true)}
        </div>
      </Vis>
      <Foot><span>The same figure as Expenses on Stats{year ? ", Annually" : ""}</span></Foot>
    </CardFrame>
  );
}

export function CategoriesCard({ card, month }: Props<"categories">) {
  const nav = useNavigate();
  const { fmt } = useApp();
  const year = card.scope === "year";
  const n = card.top.length + card.rest.count;
  const lead = card.top[0];
  const second = card.top[1];
  const topTwo = lead.pct + (second?.pct ?? 0);
  const rest: RecapDrill = { kind: "rest", exclude: card.top.map((t) => t.id) };
  return (
    <CardFrame kind="categories">
      <Label>Where it went</Label>
      {year ? (
        <>
          <H className="line-clamp-2">{lead.name}{second ? `, then ${second.name}` : ""}</H>
          <Ctx>Together <B>{topTwo >= 0.48 && topTwo <= 0.52 ? "half the year" : `${pct(topTwo)} of the year`}</B></Ctx>
        </>
      ) : (
        <>
          <H>{lead.name} took the biggest slice</H>
          <Ctx><B><Money amount={lead.amount} /></B> · {plural(card.lead.count, "entry", "entries")} · {fmt(card.lead.avg)} each on average</Ctx>
        </>
      )}
      <Vis>
        <div className="my-3.5 mb-3 flex max-h-[280px] min-h-[190px] flex-1 flex-col gap-[3px] overflow-hidden rounded-lg">
          {card.top.map((t, i) => (
            <Tap key={t.id} drill={{ kind: "category", id: t.id }} hint={i === 0} label={`${t.name}: see its entries`} className="flex min-h-6 items-center justify-between px-3 text-sm font-medium" style={{ flex: Math.max(t.pct, 0.02), background: colorAt(i, n), color: ON_CHART }}>
              <span className="min-w-0 truncate">{t.name}</span><span className="ml-2 font-normal opacity-80">{pct(t.pct)}</span>
            </Tap>
          ))}
          {card.rest.count ? (
            <Tap drill={rest} label="See the other categories" className="flex min-h-6 items-center justify-between px-3 text-sm font-medium text-foreground" style={{ flex: Math.max(card.rest.pct, 0.02), background: REST }}>
              <span className="min-w-0 truncate">{plural(card.rest.count, "other category", "other categories")}</span><span className="ml-2 font-normal opacity-80">{pct(card.rest.pct)}</span>
            </Tap>
          ) : null}
        </div>
        <Legend>
          {card.top.slice(0, 3).map((t, i) => <TapRow key={t.id} drill={{ kind: "category", id: t.id }}>{legendRow(t.id, colorAt(i, n), t.name, fmt(t.amount))}</TapRow>)}
          {!year && card.rest.count ? <TapRow drill={rest}>{legendRow("rest", REST, "Everything else", fmt(card.rest.amount), true)}</TapRow> : null}
        </Legend>
      </Vis>
      <Foot><span>{plural(n, "category", "categories")} · tap one for its entries</span><FootLink onClick={() => nav(statsPath(month))}>Open Stats</FootLink></Foot>
    </CardFrame>
  );
}

export function BiggestCard({ card }: Props<"biggest">) {
  const nav = useNavigate();
  const drill = useDrill();
  const { accountName, categoryLabel } = useApp();
  const title = (tx: Tx) => tx.note.trim() || categoryLabel(tx) || (tx.type === "transfer" ? `Transfer to ${accountName(tx.toAccountId)}` : "Uncategorised");
  const line = (tx: Tx) => [tx.type === "transfer" ? "Transfer" : categoryLabel(tx) || "Uncategorised", accountName(tx.accountId), dayLabel(tx.date)].join(" · ");
  const year = card.scope === "year";
  // card.amount is what counted (a transfer's amount plus its fee), the same figure the closer shows
  const rows = [{ tx: card.tx, note: title(card.tx), amount: card.amount }, ...card.runnersUp];
  const together = rows.length === 1 ? "The one entry" : rows.length === 2 ? "Top two together" : "Top three together";
  const period = year ? "the year" : "the month";
  return (
    <CardFrame kind="biggest">
      <Vis>
        <Label>Biggest single spend</Label>
        <Num><Money amount={card.amount} kind="expense" /></Num>
        <H className="line-clamp-2">{title(card.tx)}</H>
        <Ctx><B>{pct(card.share)}</B> of {period} in one entry{year ? ` · ${dayLabel(card.tx.date)}` : ""}</Ctx>
        <div className="mt-[22px] overflow-hidden rounded-lg border bg-card">
          {rows.map((r, i) => (
            <button key={r.tx._id} type="button" onClick={() => nav(`/t/${r.tx._id}`)} className="pointer-events-auto relative flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-accent/40 active:bg-accent">
              {i === 0 ? <HintDot className="top-1/2 left-1 -translate-y-1/2" /> : null}
              <span className="w-4 text-center text-xs text-muted-foreground">{i + 1}</span>
              <div className={cn("min-w-0 flex-1 text-sm", i === 0 && "font-medium")}><span className="block truncate">{r.note}</span><small className="block truncate text-xs font-normal text-muted-foreground">{line(r.tx)}</small></div>
              <Money amount={r.amount} kind="expense" className="text-sm" />
            </button>
          ))}
        </div>
      </Vis>
      {year
        ? <Foot><span>Your ten largest: {pct(card.topShare)} of the year</span><FootLink onClick={() => drill({ kind: "largest", count: 10 })}>See all ten</FootLink></Foot>
        : <Foot><span>{together}: {pct(card.topShare)} of the month</span><FootLink onClick={() => drill({ kind: "largest", count: 10 })}>Top ten</FootLink></Foot>}
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
            // the whole column is the button, so a short bar is as easy to hit as a tall one
            return (
              <Tap key={d.date} drill={{ kind: "day", date: d.date }} hint={d.date === card.busiest && BAR_FOOT} label={dayLabel(d.date)} className="flex h-full min-w-0 flex-1 items-end">
                <i
                  className={cn("block w-full rounded-t-[2px]", zero ? "opacity-40" : d.date === card.busiest ? "bg-expense" : wk ? "bg-expense opacity-55" : "bg-expense opacity-40")}
                  style={{ height: zero ? 3 : `${Math.max(2, Math.round((d.amount / max) * 100))}%`, background: zero ? REST : undefined }}
                />
              </Tap>
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
      <Foot><span>Lighter bars are weekends · tap a bar for that day</span></Foot>
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
                <Tap key={b.text} drill={{ kind: "note", text: b.text }} hint={i === 0} label={`“${b.text}”: see its entries`} className="my-1.5 grid w-full grid-cols-[72px_1fr_28px] items-center gap-2.5 text-[13px]">
                  <span className={cn("truncate", i === 0 ? "font-medium text-foreground" : "text-muted-foreground")}>{b.text}</span>
                  <i className={cn("block h-[22px] rounded", i === 0 ? "opacity-100" : "opacity-35")} style={{ width: pct(b.count / note.count), background: "var(--tint)" }} />
                  <span className="text-right font-medium tabular">{b.count}</span>
                </Tap>
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
          {card.account ? <Tile label="Most used method" value={card.account.name} hint={`${pct(card.account.share)} of spend`} drill={{ kind: "account", id: card.account.id }} /> : null}
          {card.scheduled ? <Tile label="Scheduled" value={<Money amount={card.scheduled.amount} />} hint={plural(card.scheduled.count, "repeat")} drill={{ kind: "scheduled" }} /> : null}
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
  const year = card.scope === "year";
  const [first, ...others] = card.movers;
  // the line is about the other movers: the headline already says what the first one did
  const firstRose = first.after > first.before;
  const fallers = others.filter((m) => m.after < m.before).map((m) => m.name);
  const risers = others.filter((m) => m.after > m.before).map((m) => m.name);
  const biggest = Math.max(1, ...card.movers.map((m) => Math.abs(m.after - m.before)));
  const line = fallers.length ? `${joinAnd(fallers)} fell${firstRose ? "" : " too"}` : risers.length ? `${joinAnd(risers)} rose${firstRose ? " too" : ""}` : "Nothing else moved by much";
  return (
    <CardFrame kind="changes">
      <Label>What changed since {card.prevLabel}</Label>
      <H className="line-clamp-2">{moverHeadline(first)}</H>
      <Ctx className="truncate">{line}</Ctx>
      <Vis>
        {card.movers.map((m) => {
          const up = m.after > m.before;
          // a year shows a rise of 2× or more as "N×" (spec §4.2, card 10)
          const delta = m.before === 0 ? "new" : m.after === 0 ? "gone" : year && m.after / m.before >= 2 ? `${(m.after / m.before).toFixed(1).replace(/\.0$/, "")}×` : `${up ? "+" : "−"}${pctChange(m.pct!).pct}%`;
          return (
            <Tap key={m.id} drill={{ kind: "category", id: m.id }} hint={m === first && GUTTER} label={`${m.name}: see its entries`} className="grid w-full grid-cols-[1fr_96px_auto] items-center gap-3 border-b py-2.5 last:border-b-0">
              <div className="min-w-0 text-[15px]"><span className="block truncate">{m.name}</span><small className="block text-xs text-muted-foreground tabular">{fmt(m.before)} → {fmt(m.after)}</small></div>
              <div className="relative h-[18px]">
                <span className="absolute top-0 bottom-0 left-1/2 w-px bg-muted-foreground/50" />
                <i className={cn("absolute top-[3px] block h-3 rounded-[3px]", up ? "left-1/2 bg-expense" : "right-1/2 bg-income")} style={{ width: pct((Math.abs(m.after - m.before) / biggest) * 0.5) }} />
              </div>
              <span className={cn("text-right text-sm font-medium whitespace-nowrap tabular", up ? "text-expense" : "text-income")}>{delta}</span>
            </Tap>
          );
        })}
      </Vis>
      <Foot><span>Only moves above {year ? "2% of the year's" : "5% of the month's"} total</span></Foot>
    </CardFrame>
  );
}

export function InOutCard({ card }: Props<"inout">) {
  const { fmt } = useApp();
  const year = card.scope === "year";
  const spentShare = Math.min(1, card.spent / card.income);
  const over = card.keptPct < 0;
  const foot = year
    ? (card.prevKeptPct !== undefined ? `Last year: ${keptText(card.prevKeptPct)}` : "No income recorded the year before")
    : (card.prevKeptPct !== undefined ? `Last month: ${keptText(card.prevKeptPct)}` : "No income recorded the month before");
  return (
    <CardFrame kind="inout">
      <Vis>
        <Label>In vs out</Label>
        <Num>{over ? 100 - card.keptPct : card.keptPct}%</Num>
        <H className="-mt-1">of what came in, {over ? "spent" : "kept"}</H>
        <div className="my-3.5 mb-2.5 flex h-12 gap-1 overflow-hidden rounded-md">
          <i className="flex h-full items-center overflow-hidden bg-expense px-2.5 text-[13px] font-medium whitespace-nowrap" style={{ width: spentShare < 1 ? pct(spentShare) : undefined, flex: spentShare < 1 ? undefined : 1, color: ON_SIGNAL }}>Spent {fmt(card.spent)}</i>
          {spentShare < 1 ? <i className="flex h-full flex-1 items-center overflow-hidden bg-income px-2.5 text-[13px] font-medium whitespace-nowrap" style={{ color: ON_SIGNAL }}>Kept</i> : null}
        </div>
        <Legend className="mb-1.5">
          <TapRow drill={{ kind: "income" }} hint="-left-2 top-1/2 -translate-y-1/2">{legendRow("in", "var(--income)", "Income", <Money amount={card.income} kind="income" />)}</TapRow>
          {legendRow("out", "var(--expense)", "Spent", <Money amount={card.spent} kind="expense" />)}
          {legendRow("kept", REST, "Kept", <Money amount={card.income - card.spent} />)}
        </Legend>
        {card.budgets ? <Tiles><BudgetsTile budgets={card.budgets} className="col-span-full" /></Tiles> : null}
        {year && (card.bestMonth || card.budgetMonths) ? (
          <Tiles>
            {card.bestMonth ? <Tile label="Best month" value={longMonth(card.bestMonth.month)} hint={keptText(card.bestMonth.keptPct)} drill={{ kind: "month", month: card.bestMonth.month }} /> : null}
            {card.budgetMonths ? <Tile label="Budgets" value={`${card.budgetMonths.held} of ${card.budgetMonths.total}`} hint="months within budget" /> : null}
          </Tiles>
        ) : null}
      </Vis>
      <Foot><span>{foot}</span></Foot>
    </CardFrame>
  );
}

export function BudgetsCard({ card }: Props<"budgets">) {
  const { fmt } = useApp();
  const b = card.budgets;
  if (card.scope === "year") {
    return (
      <CardFrame kind="budgets">
        <Vis>
          <Label>Budgets</Label>
          <H>{b.held} of {b.total} months within budget</H>
          <Ctx>{b.held === b.total ? "Every budget held in every month" : `${plural(b.total - b.held, "month")} had a budget go over`}</Ctx>
          <Tiles><Tile label="Held" value={plural(b.held, "month")} /><Tile label="Over" value={plural(b.total - b.held, "month")} /></Tiles>
        </Vis>
        <Foot><span>No income was recorded this year</span></Foot>
      </CardFrame>
    );
  }
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
  const year = card.scope === "year";
  const name = year ? month : longMonth(month);
  const y = year ? "" : String(parseMonthKey(month).y);
  const rows = posterRows(s, year, fmt);
  const meta = year ? `${plural(s.entries, "entry", "entries")} · ${plural(s.days, "day")}` : `${rangeLabel(s.range)} · ${plural(s.entries, "entry", "entries")}`;
  const file = usePosterFile({
    title: name, sub: y || undefined, meta, rows, rest: REST,
    strip: s.strip.map((c, i) => ({ pct: c.pct, color: colorAt(i, s.strip.length + 1) })),
  }, `unmoney-recap-${month}.png`);
  // the phone's share sheet takes the image where it can (Messages, WhatsApp, Photos…); everywhere else it is a download
  const canShare = !!file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  async function share() {
    if (!file) return;
    try { await navigator.share({ files: [file], title: `${year ? name : `${name} ${y}`} · UnMoney` }); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Couldn't share it"); }
  }
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  // on a wide screen the card is 560 px tall, so the poster's rows and title tighten a little to fit without scrolling
  const row = (r: PosterRow) => (
    <div key={r.key} className={cn("flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0", year ? "lg:py-1" : "lg:py-1.5")}>
      <span className="whitespace-nowrap text-muted-foreground">{r.label}</span>
      <b className={cn("min-w-0 truncate text-right font-medium tabular", r.tone === "income" && "text-income", r.tone === "expense" && "text-expense")}>{r.value}</b>
    </div>
  );
  return (
    <CardFrame kind="closer">
      <Label>Keep this one</Label>
      <Vis>
        {/* the poster: the thing to keep, and what Share and Download send as an image (poster.ts draws the same rows) */}
        <div className="relative isolate overflow-hidden rounded-[14px] border bg-card px-4 pt-4 pb-3 shadow-card lg:pt-3">
          {/* the watermark: the mark, large and faint, off the bottom-right corner */}
          <svg viewBox="128 160 256 192" aria-hidden="true" className="absolute -right-6 -bottom-4 -z-10 w-48 fill-foreground opacity-[0.045]"><path d={MARK} /></svg>
          {year
            ? <div className="text-[40px] font-semibold leading-none tracking-[-0.03em] lg:text-[32px]">{name}</div>
            : <div className="text-[30px] font-semibold leading-none tracking-[-0.03em] lg:text-[26px]">{name}<br /><span className="font-medium text-muted-foreground">{y}</span></div>}
          <div className="mt-1.5 mb-3 text-xs text-muted-foreground lg:mb-2">{meta}</div>
          <Strip strip={s.strip} className="mb-1.5" />
          <div>{rows.map(row)}</div>
          {/* the signature, quiet: no rule above it, at half strength */}
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-60">
            <Logo size={14} wordmark={false} />
            <span className="mr-auto font-semibold tracking-[-0.01em] text-foreground">UnMoney</span>
            <span>unmoney.vercel.app</span>
          </div>
        </div>
        <div className="pointer-events-auto mt-3.5 flex gap-2 lg:mt-3">
          <Button size="lg" className="h-10 flex-1 lg:h-9" onClick={() => nav(statsPath(month))}>{year ? `Open ${month} in Stats` : "Open in Stats"}</Button>
          {canShare ? <Button size="lg" variant="outline" className="h-10 flex-1 lg:h-9" onClick={() => void share()}><Share2 />Share</Button> : null}
          <Button size="lg" variant="outline" className={cn("h-10 lg:h-9", canShare ? "px-3" : "flex-1")} aria-label="Download image" title="Download image" disabled={!file} onClick={download}>
            <Download />{canShare ? null : "Download"}
          </Button>
        </div>
      </Vis>
      <Foot><span>Every {year ? "year's recap stays on Recaps" : "month's recap stays on Stats"}</span><FootLink onClick={onClose}>Done</FootLink></Foot>
    </CardFrame>
  );
}

/**
 * The poster as a PNG file, made once when the card opens: the share sheet on iOS only opens
 * straight from the tap, so the image has to be ready before it.
 */
function usePosterFile(poster: Poster, name: string): File | null {
  const [file, setFile] = useState<File | null>(null);
  const key = JSON.stringify(poster);
  useEffect(() => {
    let live = true;
    posterImage(poster).then((b) => { if (live) setFile(new File([b], name, { type: "image/png" })); }).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, name]);
  return file;
}

// ---- the year's own cards (yearly spec §4.2) ----

export function MonthsCard({ card }: Props<"months">) {
  const { fmt } = useApp();
  const max = Math.max(1, ...card.perMonth.map((m) => m.amount));
  const priciest = card.perMonth.find((m) => m.month === card.priciest)!;
  return (
    <CardFrame kind="months">
      <Label>Month by month</Label>
      <H>{longMonth(card.priciest)} cost the most</H>
      <Ctx className="truncate"><B><Money amount={priciest.amount} /></B>{card.ratio > 0 && card.lightest !== card.priciest ? <> · {card.ratio.toFixed(1)}× {longMonth(card.lightest)}, your lightest</> : null}</Ctx>
      <Vis>
        {/* the priciest bar is solid expense, the lightest the income colour; both carry their amount above */}
        <div className="my-2.5 mb-1 flex h-[140px] items-end gap-[5px] pt-4">
          {card.perMonth.map((m) => {
            const hi = m.month === card.priciest, lo = m.month === card.lightest;
            const h = m.amount ? Math.max(2, Math.round((m.amount / max) * 100)) : 0;
            return (
              <Tap key={m.month} drill={{ kind: "month", month: m.month }} hint={hi && BAR_FOOT} label={longMonth(m.month)} className="relative h-full min-w-0 flex-1">
                <i className={cn("absolute inset-x-0 bottom-0 block rounded-t-[3px]", hi ? "bg-expense" : lo ? "bg-income opacity-90" : "bg-expense opacity-40")} style={{ height: `${h}%` }} />
                {(hi || lo) && m.amount ? <span className="absolute left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-foreground" style={{ bottom: `calc(${h}% + 3px)` }}>{fmt(m.amount)}</span> : null}
              </Tap>
            );
          })}
        </div>
        <div className="grid grid-cols-12 text-center text-[10px] text-muted-foreground">{card.perMonth.map((m) => <span key={m.month}>{MONTH_SHORT[parseMonthKey(m.month).m - 1][0]}</span>)}</div>
        <Tiles three>
          <Tile label="Above average" value={plural(card.aboveAvg, "month")} />
          <Tile label="Quietest" value={longMonth(card.lightest)} drill={{ kind: "month", month: card.lightest }} />
          <Tile label="Swing" value={`±${pct(card.swing)}`} hint="vs the average" />
        </Tiles>
      </Vis>
      <Foot><span>Each month's spend · tap a bar for its entries</span></Foot>
    </CardFrame>
  );
}

export function Top5Card({ card }: Props<"top5">) {
  const { fmt } = useApp();
  const first = card.notes[0];
  const every = card.everyDays === undefined ? "" : card.everyDays < 1.05 ? "about one a day" : `one every ${card.everyDays.toFixed(1)} days`;
  return (
    <CardFrame kind="top5">
      <Label>Your top five</Label>
      <H>The things you logged most</H>
      <Vis>
        <div className="mt-2.5">
          {card.notes.map((n, i) => (
            <Tap key={n.text} drill={{ kind: "note", text: n.text }} hint={i === 0 && GUTTER} label={`“${n.text}”: see its entries`} className="flex w-full items-center gap-3.5 border-b py-2 last:border-b-0">
              <span className={cn("w-[30px] shrink-0 text-[28px] font-semibold leading-none tracking-[-0.03em]", i === 0 ? "text-foreground" : "text-muted-foreground")}>{i + 1}</span>
              <div className="min-w-0 flex-1 text-[17px] font-semibold tracking-[-0.01em]">
                <span className="block truncate">{n.text}</span>
                <small className="block truncate text-xs font-normal text-muted-foreground">{fmt(n.amount)} · {fmt(Math.round(n.amount / n.count))} each</small>
              </div>
              <span className="text-sm font-medium tabular">{n.count}×</span>
              <ChevronRight className="-ml-2 size-4 shrink-0 text-muted-foreground" />
            </Tap>
          ))}
        </div>
      </Vis>
      <Foot><span className="truncate">{first && every ? `${first.text}: ${every}` : "Notes matched ignoring case"}</span></Foot>
    </CardFrame>
  );
}

export function CalendarCard({ card }: Props<"calendar">) {
  const days = card.perDay;
  const max = Math.max(1, ...days.map((d) => d.amount));
  const busiest = days.find((d) => d.date === card.busiest) ?? days[0];
  return (
    <CardFrame kind="calendar">
      <Label>Your year, day by day</Label>
      <H>Busiest: {dayLabel(card.busiest)}</H>
      <Ctx className="truncate"><B><Money amount={busiest.amount} /></B> in {plural(busiest.count, "entry", "entries")}{card.busiestNotes.length ? ` · ${joinAnd(card.busiestNotes)}` : ""}</Ctx>
      <Vis>
        {/* one row per logical month, a cell per day: expense colour by share of the busiest day, grey when nothing was spent */}
        <div className="my-3 mb-1.5 grid grid-cols-[26px_1fr] items-center gap-y-0.5">
          {card.rows.map((row) => {
            const start = diffDays(days[0].date, row.from);
            return (
              <Fragment key={row.month}>
                <span className="text-[10px] leading-none text-muted-foreground">{MONTH_SHORT[parseMonthKey(row.month).m - 1]}</span>
                <span className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(31, minmax(0, 1fr))" }}>
                  {Array.from({ length: 31 }, (_, i) => {
                    const d = i < row.days ? days[start + i] : undefined;
                    if (!d) return <i key={i} className="invisible block aspect-square" />;
                    const zero = d.amount === 0;
                    return (
                      <Tap key={d.date} drill={{ kind: "day", date: d.date }} hint={d.date === card.busiest} label={dayLabel(d.date)} className="block aspect-square">
                        <i
                          className={cn("block size-full rounded-[2px]", zero ? "bg-foreground opacity-[0.07]" : "bg-expense", d.date === card.busiest && "outline-2 outline-offset-1 outline-foreground")}
                          style={zero ? undefined : { opacity: 0.18 + 0.82 * (d.amount / max) }}
                        />
                      </Tap>
                    );
                  })}
                </span>
              </Fragment>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <span>less</span>{[0.2, 0.45, 0.7, 1].map((o) => <i key={o} className="block size-2 rounded-[2px] bg-expense" style={{ opacity: o }} />)}<span>more</span>
        </div>
        <Tiles three>
          <Tile label="No-spend" value={plural(card.noSpend, "day")} />
          <Tile label="Longest streak" value={plural(card.streak, "day")} hint="logging daily" />
          <Tile label="Spend day" value={WEEKDAY_LONG[card.spendDay.weekday]} hint={`${pct(card.spendDay.share)} of the year`} />
        </Tiles>
      </Vis>
      <Foot><span>Darker days cost more · tap a day for its entries</span></Foot>
    </CardFrame>
  );
}

export function ClockCard({ card }: Props<"clock">) {
  const max = Math.max(1, ...card.perHour);
  return (
    <CardFrame kind="clock">
      <Vis>
        <Label>On the clock</Label>
        <H xl>{hourRange(card.peakHour)}</H>
        <Ctx className="mt-1.5">Your spending hour · <B>{pct(card.eveningShare)}</B> of entries after 7 pm</Ctx>
        <div className="my-2.5 mb-1 flex h-[110px] items-end gap-0.5">
          {card.perHour.map((v, h) => (
            <Tap key={h} drill={{ kind: "hour", hour: h }} hint={h === card.peakHour && BAR_FOOT} label={hourRange(h)} className="flex h-full min-w-0 flex-1 items-end">
              <i className={cn("block w-full rounded-t-[2px]", h === card.peakHour ? "opacity-100" : "opacity-35")} style={{ height: `${Math.max(2, Math.round((v / max) * 100))}%`, background: "var(--tint)" }} />
            </Tap>
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div>
        <Tiles>
          <Tile label="Mornings" value={pct(card.morningShare)} hint="before noon" />
          {card.first ? <Tile label="Earliest" value={timeLabel(card.first.time)} hint={`${card.first.note}, ${shortDay(card.first.date)}`} drill={{ kind: "day", date: card.first.date }} /> : null}
        </Tiles>
      </Vis>
      <Foot><span>Entries with a time ({card.timed.toLocaleString()} of {card.total.toLocaleString()}) · tap an hour</span></Foot>
    </CardFrame>
  );
}

export function MethodsCard({ card }: Props<"methods">) {
  const { fmt } = useApp();
  const lead = card.top[0];
  const max = Math.max(1, ...card.top.map((m) => m.amount));
  const most = card.mostEntries;
  const foot = !most ? "" : most.id !== lead.id ? `${most.name}: ${plural(most.count, "entry", "entries")}, ${fmt(most.avg)} each on average` : `${lead.name}: ${plural(most.count, "entry", "entries")}`;
  return (
    <CardFrame kind="methods">
      <Vis>
        <Label>Paid with</Label>
        <H xl className="line-clamp-2">{lead.name}</H>
        <Ctx className="mt-1.5"><B>{pct(card.share)}</B> of the year went through one method</Ctx>
        <div className="mt-2.5 grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          {card.top.map((m) => (
            <Tap key={m.id} drill={{ kind: "account", id: m.id }} hint={m === lead && "-left-2 top-1/2 -translate-y-1/2"} label={`${m.name}: see its entries`} className="col-span-2 -mx-1.5 grid grid-cols-subgrid items-center rounded px-1.5 py-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <i className="block h-2 shrink-0 rounded-[2px]" style={{ width: Math.max(4, Math.round((m.amount / max) * 150)), background: "var(--tint)" }} />
                <span className="truncate">{m.name}</span>
              </div>
              <span className="tabular">{fmt(m.amount)}</span>
            </Tap>
          ))}
        </div>
      </Vis>
      <Foot><span className="truncate">{foot}</span></Foot>
    </CardFrame>
  );
}

export function NewCard({ card, month }: Props<"new">) {
  const { fmt } = useApp();
  const first = card.items[0];
  const verb = first.kind === "account" ? "paying with" : "logging";
  return (
    <CardFrame kind="new">
      <Vis>
        <Label>New this year</Label>
        <H className="line-clamp-2">You started {verb} {first.name} in {MONTH_LONG[parts(first.first).m - 1]}</H>
        <Ctx><B>{plural(first.count, "entry", "entries")}</B> since · {fmt(first.amount)}</Ctx>
        <div className="mt-5 overflow-hidden rounded-lg border bg-card">
          {card.items.map((it) => (
            <Tap key={`${it.kind}-${it.id}`} hint={it === first && "top-1/2 left-1 -translate-y-1/2"} drill={it.kind === "account" ? { kind: "account", id: it.id } : { kind: "category", id: it.id }} label={`${it.name}: see its entries`} className="flex w-full items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1 text-sm">
                <span className="block truncate">{it.name}</span>
                <small className="block truncate text-xs text-muted-foreground">{it.kind === "account" ? "new method · " : ""}first on {shortDay(it.first)} · {plural(it.count, "entry", "entries")}</small>
              </div>
              <span className="text-sm tabular">{fmt(it.amount)}</span>
              <ChevronRight className="-ml-1.5 size-4 shrink-0 text-muted-foreground" />
            </Tap>
          ))}
        </div>
      </Vis>
      <Foot><span>Categories and methods with no entries before {month}</span></Foot>
    </CardFrame>
  );
}

export function PersonalityCard({ card }: Props<"personality">) {
  return (
    <CardFrame kind="personality">
      <Vis>
        <Label>Your spending personality</Label>
        <H xl>{card.archetype}</H>
        <Ctx className="mt-2">{card.why}</Ctx>
        <div className="mt-[22px]">
          {card.traits.map((t) => (
            <div key={t.label} className="flex items-center gap-2.5 border-b py-[7px] text-[13px] last:border-b-0">
              <i className="block size-2 shrink-0 rounded-[2px]" style={{ background: "var(--tint)", opacity: t.matched ? 1 : 0.3 }} />
              <span className={cn("min-w-0 flex-1 truncate", t.matched ? "text-foreground" : "text-muted-foreground")}>{t.label}</span>
              <b className="font-medium whitespace-nowrap">{t.value}</b>
            </div>
          ))}
        </div>
      </Vis>
      <Foot><span>Picked by fixed rules from these figures</span></Foot>
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
    case "months": return <MonthsCard card={card} month={month} />;
    case "top5": return <Top5Card card={card} month={month} />;
    case "calendar": return <CalendarCard card={card} month={month} />;
    case "clock": return <ClockCard card={card} month={month} />;
    case "methods": return <MethodsCard card={card} month={month} />;
    case "new": return <NewCard card={card} month={month} />;
    case "personality": return <PersonalityCard card={card} month={month} />;
  }
}
