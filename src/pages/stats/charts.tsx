import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, ReferenceLine, Sector, XAxis, YAxis, type MouseHandlerDataParam } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useApp } from "@/lib/app";
import { toMajor } from "../../../shared/money";
import { colorAt, colouredCount } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { play } from "@/lib/sound";
import { RollingNumber } from "@/components/motion/RollingNumber";

export { colorAt, colouredCount, SERIES_SLOTS } from "@/lib/theme";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const axisTick = (v: number) => (v === 0 ? "0" : compact.format(v));

/** One tooltip row: a swatch, the series name, and the amount in the app's money format. */
function Row({ color, name, value, hint }: { color: string; name: string; value: string; hint?: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="text-muted-foreground">{name}</span>
      {hint ? <span className="text-muted-foreground">· {hint}</span> : null}
      <span className="ml-auto pl-3 font-medium tabular text-foreground">{value}</span>
    </div>
  );
}

const pieConfig = { amount: { label: "Amount" } } satisfies ChartConfig;

export function CategoryPie({ items: all }: { items: { id: string; name: string; amount: number; pct: number }[] }) {
  // a category that refunds outweighed in the period has nothing to draw
  const items = all.filter((i) => i.amount > 0);
  const { fmt } = useApp();
  const n = colouredCount(items.length);
  const top = items.slice(0, n);
  const rest = items.slice(n).reduce((s, i) => s + i.amount, 0);
  // not "Other": that is also a default category, and two slices would share the name
  const data = rest ? [...top, { id: "rest", name: `${items.length - top.length} more`, amount: rest, pct: 0 }] : top;
  if (!data.length) return <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">Nothing recorded in this period</div>;
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <ChartContainer config={pieConfig} className="mx-auto aspect-square h-60 w-full max-w-60">
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel formatter={(_v, _n, item) => <Row color={item.payload?.fill} name={item.payload?.name} value={fmt(item.payload?.amount)} hint={`${Math.round(((item.payload?.amount ?? 0) / total) * 100)}%`} />} />}
        />
        {/* 12 o'clock, clockwise: the same order as the list below */}
        <Pie data={data} dataKey="amount" nameKey="name" startAngle={90} endAngle={-270} innerRadius={64} outerRadius={92} paddingAngle={data.length > 1 ? 2 : 0} cornerRadius={3} minAngle={3} strokeWidth={0} isAnimationActive={false}
          activeShape={({ outerRadius = 0, ...props }: PieSectorDataItem) => <Sector {...props} outerRadius={outerRadius + 6} />}>
          {data.map((d, i) => <Cell key={d.id} fill={colorAt(i, items.length)} />)}
          <Label content={({ viewBox }) => {
            if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
            const cx = Number(viewBox.cx), cy = Number(viewBox.cy);
            return (
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                <tspan x={cx} y={cy - 8} className="fill-muted-foreground text-[11px]">Total</tspan>
                <tspan x={cx} y={cy + 12} className="fill-foreground text-[15px] font-semibold">{fmt(total)}</tspan>
              </text>
            );
          }} />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

const barConfig = { major: { label: "Amount" } } satisfies ChartConfig;

/**
 * The column under a tap, from where it landed in the plot area. Not the chart's own active index:
 * on a touch screen the click arrives before the tooltip moves, so that index is the previous column.
 */
function pickColumn(e: React.MouseEvent<HTMLElement>, n: number, onPick: (index: number) => void) {
  const plot = e.currentTarget.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect();
  if (!plot || !plot.width || e.clientX < plot.left || e.clientX > plot.right) return;
  onPick(Math.min(n - 1, Math.floor(((e.clientX - plot.left) / plot.width) * n)));
}

/** `onPick`: tapping a bar (anywhere in its column, so a tiny bar is still easy to hit) opens that period. */
/** `limit` draws the dashed line; `limits` (one per bar, else `limit`) decides which bars are over. */
/** `selected`: the bar being looked at; the others are dimmed. */
/**
 * A figure above the chart follows your finger or pointer across the bars, rolling to each bar's
 * amount with a quiet tick, and dims the other bars; it rests on the selected bar, or the latest.
 * It takes a tooltip's place. Only a move to another bar changes state, so a drag redraws the chart
 * once per bar.
 */
export function TrendBars({ data, color = "var(--expense)", limit, limits, onPick, selected }: { data: { label: string; amount: number }[]; color?: string; limit?: number; limits?: number[]; onPick?: (index: number) => void; selected?: number }) {
  const { fmt, settings } = useApp();
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.map((d, i) => ({ ...d, major: toMajor(d.amount, settings.decimals), limit: limits?.[i] ?? limit }));
  const fillFor = (d: { amount: number; limit?: number }) => (d.limit === undefined ? color : d.amount > d.limit ? "var(--expense)" : "var(--income)");
  const track = (state: MouseHandlerDataParam) => {
    const i = state.activeTooltipIndex == null ? NaN : Number(state.activeTooltipIndex);
    if (Number.isNaN(i) || i === hover) return;
    setHover(i);
    play("tick");
  };
  const focus = hover !== null && hover < rows.length ? hover : selected;
  const shown = rows[focus ?? rows.length - 1];
  return (
    <div>
      {shown ? (
        <div className="flex items-baseline justify-between px-2 pb-1">
          <span className="text-xs text-muted-foreground">{shown.label}</span>
          <RollingNumber value={fmt(shown.amount)} className="text-xl font-semibold tracking-tight" />
        </div>
      ) : null}
      <ChartContainer config={barConfig} className={cn("h-48 w-full touch-pan-y", onPick && "cursor-pointer")} onClick={onPick ? (e) => pickColumn(e, rows.length, onPick) : undefined}>
        <BarChart accessibilityLayer data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%"
          onMouseMove={track} onTouchStart={track} onTouchMove={track} onMouseLeave={() => setHover(null)}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={axisTick} />
          <ChartTooltip cursor={{ fillOpacity: 0.5 }} content={() => null} />
          {limit !== undefined ? (
            <ReferenceLine y={toMajor(limit, settings.decimals)} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="extendDomain" />
          ) : null}
          {/* bars rise from the baseline on first view */}
          <Bar dataKey="major" fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} animationDuration={700} animationEasing="ease-out">
            {limit !== undefined || focus !== undefined ? rows.map((d, i) => <Cell key={i} fill={limit !== undefined ? fillFor(d) : color} fillOpacity={focus === undefined || focus === i ? 1 : 0.35} />) : null}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

const lineConfig = { major: { label: "Balance", color: "var(--chart-1)" } } satisfies ChartConfig;

export function BalanceLine({ data }: { data: { label: string; balance: number }[] }) {
  const { fmt, settings } = useApp();
  const rows = data.map((d) => ({ ...d, major: toMajor(d.balance, settings.decimals) }));
  return (
    <ChartContainer config={lineConfig} className="h-44 w-full">
      <AreaChart accessibilityLayer data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-major)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-major)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={axisTick} domain={["auto", "auto"]} />
        <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent formatter={(_v, _n, item) => <Row color="var(--color-major)" name="Balance" value={fmt(item.payload?.balance ?? 0)} />} />} />
        <Area type="monotone" dataKey="major" stroke="var(--color-major)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="url(#balance-fill)"
          dot={rows.length <= 12 ? { r: 3, fill: "var(--color-major)", stroke: "var(--background)", strokeWidth: 2 } : false}
          activeDot={{ r: 5, fill: "var(--color-major)", stroke: "var(--background)", strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  );
}
