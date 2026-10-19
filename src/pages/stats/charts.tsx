import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart, CartesianGrid } from "recharts";
import { CATEGORY_COLORS } from "../../../shared/defaults";
import { useApp } from "@/lib/app";
import { toMajor } from "../../../shared/money";

export function colorAt(i: number) {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
}

/** Slices below this share get no label or leader line, so a line never points at nothing. */
const LABEL_MIN = 0.05;

export function CategoryPie({ items }: { items: { id: string; name: string; amount: number; pct: number }[] }) {
  const { fmt } = useApp();
  const top = items.slice(0, 9);
  const rest = items.slice(9).reduce((s, i) => s + i.amount, 0);
  // not "Other": that is also a default category, and two slices would share the name
  const data = rest ? [...top, { id: "rest", name: `${items.length - top.length} more`, amount: rest, pct: 0 }] : top;
  if (!data.length) return <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">Nothing recorded in this period</div>;
  const total = data.reduce((s, d) => s + d.amount, 0);
  return (
    <div className="h-64 relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 16, bottom: 16, left: 24, right: 24 }}>
          {/* 12 o'clock, clockwise: the same order as the list below */}
          <Pie data={data} dataKey="amount" nameKey="name" startAngle={90} endAngle={-270} innerRadius={46} outerRadius={78} paddingAngle={data.length > 1 ? 1 : 0} minAngle={2} stroke="none" isAnimationActive={false}
            label={({ name, percent }) => ((percent ?? 0) >= LABEL_MIN ? `${name} ${Math.round((percent ?? 0) * 100)}%` : "")}
            labelLine={(props: { percent?: number; points?: { x: number; y: number }[] }) => {
              const pts = props.points;
              if ((props.percent ?? 0) < LABEL_MIN || !pts?.length) return <g />;
              return <polyline points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="currentColor" strokeOpacity={0.3} />;
            }}
            fontSize={11}>
            {data.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
          </Pie>
          <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[10px] text-muted-foreground">Total</span>
        <span className="text-[11px] font-medium tabular">{fmt(total)}</span>
      </div>
    </div>
  );
}

export function TrendBars({ data, color = "var(--expense)", limit }: { data: { label: string; amount: number }[]; color?: string; limit?: number }) {
  const { fmt, settings } = useApp();
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.map((d) => ({ ...d, major: toMajor(d.amount, settings.decimals) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.15} />
          <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(v) => fmt(Math.round(Number(v) * 10 ** settings.decimals))} contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fillOpacity: 0.08 }} />
          <Bar dataKey="major" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {limit !== undefined ? data.map((d, i) => <Cell key={i} fill={d.amount > limit ? "var(--expense)" : "var(--income)"} />) : null}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceLine({ data }: { data: { label: string; balance: number }[] }) {
  const { fmt, settings } = useApp();
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.map((d) => ({ ...d, major: toMajor(d.balance, settings.decimals) }))} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.15} />
          <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis fontSize={10} tickLine={false} axisLine={false} width={48} />
          <Tooltip formatter={(v) => fmt(Math.round(Number(v) * 10 ** settings.decimals))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Line type="monotone" dataKey="major" stroke="var(--primary)" strokeWidth={2} dot={data.length <= 31} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
