/**
 * The superadmin dashboard's cards and charts. Colours come from the app's chart slots in a fixed
 * order (--chart-1, --chart-2, …); every chart with more than one series has a legend, and the
 * numbers are always in text beside or under the marks, so nothing is told by colour alone.
 */
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { InfoHint } from "@/components/shell/misc";
import { cn } from "@/lib/utils";
import { fmtNum, fmtPct, type Cohort } from "./metrics";

export const SLOT = (i: number) => `var(--chart-${(i % 8) + 1})`;

export function Card({ title, hint, info, right, children, className }: { title: ReactNode; hint?: ReactNode; info?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card p-3 sm:p-4 min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">{title}{info ? <InfoHint text={info} /> : null}</h2>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A headline number, with the change from the previous period when there is one. */
/** `small`: for a narrow column (the user sheet), where a long value would be cut. */
export function Tile({ label, value, sub, delta, info, small }: { label: string; value: ReactNode; sub?: ReactNode; delta?: number | null; info?: ReactNode; small?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5 sm:px-4 sm:py-3 min-w-0">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{label}{info ? <InfoHint text={info} /> : null}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={cn("font-semibold tabular-nums truncate", small ? "text-lg" : "text-xl sm:text-2xl")}>{value}</span>
        {delta != null && Number.isFinite(delta) ? (
          <span className={cn("inline-flex items-center text-xs tabular-nums", delta >= 0 ? "text-income" : "text-expense")}>
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {fmtPct(Math.abs(delta))}
          </span>
        ) : null}
      </div>
      {sub ? <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function TipRow({ color, name, value, dashed }: { color: string; name: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", dashed && "h-0.5 rounded-none")} style={{ background: color }} />
      <span className="text-muted-foreground">{name}</span>
      <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block", it.dashed ? "h-0 w-3 border-t-2 border-dashed" : "size-2.5 rounded-[3px]")} style={it.dashed ? { borderColor: it.color } : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * One measure per day as bars, with the previous period of the same length as a dashed line on the
 * same scale, so "is this up?" reads at a glance.
 */
export function DayChart({ data, label, format = fmtNum, color = SLOT(0) }: {
  data: { day: string; value: number; prev?: number; prevDay?: string }[]; label: string; format?: (n: number) => string; color?: string;
}) {
  const config = { value: { label, color }, prev: { label: "Previous period", color: "var(--muted-foreground)" } } satisfies ChartConfig;
  const hasPrev = data.some((d) => d.prev !== undefined);
  return (
    <>
      <ChartContainer config={config} className="h-56 w-full">
        <ComposedChart accessibilityLayer data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={shortDay} />
          <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
          <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent labelFormatter={(_l, p) => shortDay(p?.[0]?.payload?.day ?? "")} formatter={(_v, name, item) => name === "prev"
            ? <TipRow dashed color="var(--muted-foreground)" name={`Previous (${shortDay(item.payload?.prevDay ?? "")})`} value={format(item.payload?.prev ?? 0)} />
            : <TipRow color={color} name={label} value={format(item.payload?.value ?? 0)} />} />} />
          <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
          {hasPrev ? <Line dataKey="prev" type="monotone" stroke="var(--color-prev)" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={false} isAnimationActive={false} /> : null}
        </ComposedChart>
      </ChartContainer>
      {hasPrev ? <Legend items={[{ label, color }, { label: "Previous period", color: "var(--muted-foreground)", dashed: true }]} /> : null}
    </>
  );
}

/** Parts of one measure per day, stacked with a gap between them. */
export function StackedDayBars({ data, series, format = fmtNum }: {
  data: ({ day: string } & Record<string, number | string>)[]; series: { key: string; label: string }[]; format?: (n: number) => string;
}) {
  const config = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: SLOT(i) }])) satisfies ChartConfig;
  return (
    <>
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={shortDay} />
          <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => format(v)} />
          <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent labelFormatter={(_l, p) => shortDay(p?.[0]?.payload?.day ?? "")} formatter={(v, name) => {
            const i = series.findIndex((s) => s.key === name);
            return <TipRow color={SLOT(i)} name={series[i]?.label ?? String(name)} value={format(Number(v))} />;
          }} />} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="a" fill={`var(--color-${s.key})`} stroke="var(--card)" strokeWidth={1}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={20} isAnimationActive={false} />
          ))}
        </BarChart>
      </ChartContainer>
      <Legend items={series.map((s, i) => ({ label: s.label, color: SLOT(i) }))} />
    </>
  );
}

/** Counts in categories along the x axis (hours of the day, session lengths). */
export function Columns({ data, label, format = fmtNum, color = SLOT(0), height = "h-44" }: {
  data: { label: string; value: number }[]; label: string; format?: (n: number) => string; color?: string; height?: string;
}) {
  const config = { value: { label, color } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn(height, "w-full")}>
      <BarChart accessibilityLayer data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="15%">
        <CartesianGrid vertical={false} />
        {/* a few named buckets: every one labelled, smaller on a phone; 24 hours: as many as fit */}
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} interval={data.length <= 8 ? 0 : "preserveEnd"} fontSize={data.length <= 8 ? 10 : undefined} />
        <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
        <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent formatter={(_v, _n, item) => <TipRow color={color} name={label} value={format(item.payload?.value ?? 0)} />} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/**
 * A ranked list with a bar under each row: the label and number are text, the bar only shows the
 * proportion. `of` turns the bar into a share of that total and shows the percentage too.
 */
export function BarList({ items, format = fmtNum, of, limit = 8, color = SLOT(0), empty = "Nothing yet", onPick }: {
  items: { label: ReactNode; value: number; key?: string; hint?: ReactNode }[]; format?: (n: number) => string; of?: number;
  limit?: number; color?: string; empty?: string; onPick?: (key: string) => void;
}) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = of ?? Math.max(...items.map((i) => i.value), 1);
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <ul className="space-y-2">
      {shown.map((it, i) => {
        const inner = (
          <>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint ? <span className="text-xs text-muted-foreground">{it.hint}</span> : null}
              <span className="tabular-nums font-medium">{format(it.value)}</span>
              {of ? <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{fmtPct(it.value / (of || 1))}</span> : null}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (it.value / max) * 100)}%`, background: color }} />
            </div>
          </>
        );
        return (
          <li key={it.key ?? i}>
            {onPick && it.key ? <button type="button" className="block w-full text-left hover:opacity-80" onClick={() => onPick(it.key!)}>{inner}</button> : inner}
          </li>
        );
      })}
      {rest.length ? <li className="text-xs text-muted-foreground">+ {rest.length} more ({format(rest.reduce((s, i) => s + i.value, 0))})</li> : null}
    </ul>
  );
}

/** A named part of a card that holds more than one list. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Opens by weekday and hour: one hue, darker for more. Fits a phone's width: 24 narrow columns, every sixth hour labelled. */
export function Heatmap({ grid, unit = "opens" }: { grid: number[][]; unit?: string }) {
  const max = Math.max(1, ...grid.flat());
  const shade = (p: number) => `color-mix(in oklab, var(--chart-1) ${p}%, var(--card))`;
  return (
    <div>
      <div className="grid gap-px sm:gap-[2px]" style={{ gridTemplateColumns: "26px repeat(24, minmax(0, 1fr))" }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center text-[10px] text-muted-foreground">
            {h % 6 === 0 ? h : h % 3 === 0 ? <span className="hidden sm:inline">{h}</span> : null}
          </span>
        ))}
        {grid.map((row, w) => (
          <div key={w} className="contents">
            <span className="text-[10px] leading-4 text-muted-foreground sm:leading-5">{WEEKDAYS[w].slice(0, 2)}</span>
            {row.map((n, h) => (
              <span key={h} title={`${WEEKDAYS[w]} ${String(h).padStart(2, "0")}:00 · ${n} ${unit}`}
                className="h-4 rounded-[2px] bg-muted sm:h-5 sm:rounded-[3px]"
                style={n ? { background: shade(Math.round(18 + (n / max) * 82)) } : undefined} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        Fewer
        {[18, 45, 72, 100].map((p) => <span key={p} className="size-3 rounded-[3px]" style={{ background: shade(p) }} />)}
        More · busiest hour {max} {unit}
      </div>
    </div>
  );
}

/** Sign-up weeks down the side, weeks since across: the share of each week's users who came back. */
export function CohortGrid({ cohorts }: { cohorts: Cohort[] }) {
  const weeks = cohorts[0]?.weeks.length ?? 0;
  const shown = cohorts.filter((c) => c.size);
  if (!shown.length) return <p className="py-6 text-center text-sm text-muted-foreground">No sign-ups in these weeks</p>;
  return (
    <div>
      <table className="w-full table-fixed border-separate border-spacing-[2px] text-[10px] tabular-nums sm:text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="w-11 text-left font-normal sm:w-16">Week</th>
            <th className="w-6 font-normal sm:w-10">N</th>
            {Array.from({ length: weeks }, (_, i) => <th key={i} className="font-normal">W{i}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.week}>
              <td className="whitespace-nowrap pr-2 text-muted-foreground">{shortDay(c.week)}</td>
              <td className="text-center">{c.size}</td>
              {c.weeks.map((x, i) => (
                <td key={i} className="h-6 rounded-[3px] text-center sm:h-7"
                  style={x == null ? undefined : { background: `color-mix(in oklab, var(--chart-1) ${Math.round(10 + x * 90)}%, var(--card))`, color: x > 0.55 ? "white" : undefined }}>
                  {x == null ? "" : fmtPct(x)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
