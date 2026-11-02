/**
 * The superadmin dashboard (/admin): who uses UnMoney, how much, on what, and what it costs to keep
 * their data. Only the superadmin reaches this page (App.tsx) or its data (convex/admin.ts), and its
 * code is a chunk of its own that nobody else downloads. Filters live in the address, so a view can
 * be bookmarked.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNowStrict } from "date-fns";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { LENGTH_BUCKETS } from "../../../shared/admin";
import { useStore } from "@/lib/store";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/shell/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BarList, Card, CohortGrid, Columns, DayChart, Group, Heatmap, SLOT, StackedDayBars, Tile } from "./charts";
import { UserSheet } from "./UserSheet";
import {
  ALL, addDays, aiSeries, aiTotals, applyFilters, change, cohorts, dayKey, daySeries, fmtBytes, fmtDuration, fmtNum, fmtPct, fmtUsd, hourOfWeek, inRange,
  photoBytes, sumRecords, tally, totals, userRows, type DayPoint, type Filters, type Overview, type UserRow,
} from "./metrics";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "engagement", label: "Usage" },
  { value: "devices", label: "Devices" },
  { value: "features", label: "Features" },
  { value: "data", label: "Data" },
  { value: "users", label: "Users" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const RANGES = [{ days: 7, label: "7d" }, { days: 30, label: "30d" }, { days: 90, label: "90d" }, { days: 365, label: "1y" }];

const METRICS: { key: keyof DayPoint | "users"; label: string; format?: (n: number) => string }[] = [
  { key: "activeUsers", label: "Active users" },
  { key: "opens", label: "Opens" },
  { key: "activeMin", label: "Minutes in app", format: (n) => fmtNum(Math.round(n)) },
  { key: "entries", label: "Entries added" },
  { key: "opsSent", label: "Changes synced" },
  { key: "signups", label: "Sign-ups" },
  { key: "users", label: "Total users" },
];

const FEATURES: Record<string, string> = {
  budgets: "Budgets", repeats: "Repeats", installments: "Installments", bookmarks: "Bookmarks", notes: "Daily notes",
  subCurrencies: "Sub-currencies", photos: "Receipt photos", imports: "Imports", unsplit: "UnSplit", gmail: "Gmail sync", gmailBackfill: "Gmail read-back", sips: "SIPs", aiTidy: "AI tidy-up", tidyUp: "Category tidy-up", iphoneShortcut: "iPhone shortcut",
  passcode: "Passcode", subcategories: "Subcategories", carryOver: "Carry-over", timeInput: "Time input",
};

const KINDS: Record<string, string> = {
  cash: "Cash", bank: "Bank account", card: "Credit card", debitCard: "Debit card", upi: "UPI", savings: "Savings", prepaid: "Prepaid / wallet",
  investment: "Investment", overdraft: "Overdraft", loan: "Loan", insurance: "Insurance", other: "Other",
};
const GMAIL_STATUS: Record<string, string> = { ok: "Working", reauth: "Needs reconnecting", paused: "Paused" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const AI_FEATURES = [{ key: "gmail", label: "Gmail reading" }, { key: "tidy", label: "Category tidy-up" }] as const;

const SOURCES: { key: "manual" | "gmail" | "imported" | "repeat"; label: string }[] = [
  { key: "manual", label: "Typed in" }, { key: "gmail", label: "From Gmail" }, { key: "imported", label: "Imported" }, { key: "repeat", label: "Repeats" },
];

function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const [params, setParams] = useSearchParams();
  const f: Filters = {
    days: Number(params.get("days")) || 30,
    userId: params.get("user") ?? ALL,
    os: params.get("os") ?? ALL,
    mode: (params.get("mode") as Filters["mode"]) ?? "all",
    includeMe: params.get("me") === "1",
  };
  const set = (patch: Partial<Filters>) => {
    const next = { ...f, ...patch };
    const p = new URLSearchParams();
    // the open section stays where it is
    if (params.get("tab")) p.set("tab", params.get("tab")!);
    if (next.days !== 30) p.set("days", String(next.days));
    if (next.userId !== ALL) p.set("user", next.userId);
    if (next.os !== ALL) p.set("os", next.os);
    if (next.mode !== "all") p.set("mode", next.mode);
    if (next.includeMe) p.set("me", "1");
    setParams(p, { replace: true });
  };
  return [f, set];
}

export default function AdminPage() {
  const { userId: meId } = useStore();
  const [f, setF] = useFilters();
  // fixed for the page's life: a new day starts with a reload
  const [today] = useState(() => dayKey(new Date()));
  // twice the period, for "compared with the previous one"; at least 9 weeks, for the cohorts
  const fetchFrom = addDays(today, -(Math.max(f.days * 2, 63) - 1));
  const data = useQuery(api.admin.overview, { from: fetchFrom, to: today });
  const refresh = useMutation(api.admin.refresh);
  const [picked, setPicked] = useState<string | null>(null);
  const [metric, setMetric] = useState<(typeof METRICS)[number]["key"]>("activeUsers");

  const onRefresh = async () => {
    try {
      await refresh({});
      toast.success("Counting everyone's data again. The numbers update in a minute or so.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the count");
    }
  };

  const header = (
    <PageHeader title="Superadmin" back="/settings"
      right={<Button variant="ghost" size="icon" aria-label="Count storage again" title="Count storage again" onClick={() => void onRefresh()}><RefreshCw className="size-4" /></Button>} />
  );
  if (data === undefined) {
    return (
      <>
        {header}
        <div className="mx-auto max-w-6xl space-y-4 px-4 pt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-72" />
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <Dashboard data={data} f={f} setF={setF} meId={meId} today={today} metric={metric} setMetric={setMetric} onPick={setPicked} />
      <UserSheet userId={picked} onClose={() => setPicked(null)} data={data} today={today} days={f.days} />
    </>
  );
}

function Dashboard({ data, f, setF, meId, today, metric, setMetric, onPick }: {
  data: Overview;
  f: Filters; setF: (p: Partial<Filters>) => void; meId: string | null; today: string;
  metric: (typeof METRICS)[number]["key"]; setMetric: (m: (typeof METRICS)[number]["key"]) => void; onPick: (id: string) => void;
}) {
  const m = useMemo(() => {
    const view = applyFilters(data, f, meId);
    const from = addDays(today, -(f.days - 1));
    const prevFrom = addDays(from, -f.days);
    const prevTo = addDays(from, -1);
    const cur = inRange(view.daily, from, today);
    const prev = inRange(view.daily, prevFrom, prevTo);
    const tc = totals(cur);
    const tp = totals(prev);
    const series = daySeries(view, from, today);
    const prevSeries = daySeries(view, prevFrom, prevTo);
    const startMs = new Date(`${from}T00:00:00`).getTime();
    const prevStartMs = new Date(`${prevFrom}T00:00:00`).getTime();
    const signups = view.users.filter((u) => u.joinedAt >= startMs).length;
    const signupsPrev = view.users.filter((u) => u.joinedAt >= prevStartMs && u.joinedAt < startMs).length;
    const avgDau = series.reduce((s, p) => s + p.activeUsers, 0) / series.length;
    const avgDauPrev = prevSeries.reduce((s, p) => s + p.activeUsers, 0) / prevSeries.length;
    const entries = series.reduce((s, p) => s + p.entries, 0);
    const entriesPrev = prevSeries.reduce((s, p) => s + p.entries, 0);
    const bandwidth = tc.bytesDown + tc.bytesUp + photoBytes(cur, view.stats);
    const bandwidthPrev = tp.bytesDown + tp.bytesUp + photoBytes(prev, view.stats);
    const docsBytes = view.stats.reduce((s, x) => s + Object.values(x.tables).reduce((n, t) => n + t.bytes, 0), 0);
    const fileBytes = view.stats.reduce((s, x) => s + x.files.bytes, 0);
    const curAi = view.ai.filter((r) => r.day >= from && r.day <= today);
    const ai = aiTotals(curAi);
    const aiPrev = aiTotals(view.ai.filter((r) => r.day >= prevFrom && r.day <= prevTo));
    const aiDays = aiSeries(curAi, from, today);
    const aiCalls = Object.fromEntries(AI_FEATURES.map((x) => [x.key, curAi.filter((r) => r.feature === x.key).reduce((n, r) => n + r.calls, 0)]));
    const rows = userRows(view, cur, today, curAi);

    // devices seen in the period, and which build each is on (versions sort as text: YYYY.MM.DD-HH:MM)
    const activeKeys = new Set(cur.map((r) => `${r.userId}|${r.deviceId}`));
    const activeDevices = view.devices.filter((d) => activeKeys.has(`${d.userId}|${d.deviceId}`));
    const latest = activeDevices.reduce((v, d) => (d.appVersion > v ? d.appVersion : v), "");
    const behind = activeDevices.filter((d) => d.appVersion !== latest).length;

    const sum = (pick: (s: (typeof view.stats)[number]) => number) => view.stats.reduce((n, s) => n + pick(s), 0);
    const sources = SOURCES.map((s) => ({ key: s.key, label: s.label, value: sum((x) => x.entries[s.key]) })).filter((s) => s.value);
    const gmail = view.stats.filter((s) => s.gmail);
    const thisMonth = today.slice(0, 7);
    const drafts = { open: 0, accepted: 0, dismissed: 0, rule: 0, ai: 0 };
    for (const s of gmail) for (const k of Object.keys(drafts) as (keyof typeof drafts)[]) drafts[k] += s.gmail!.drafts[k];
    const tableBytes = sumRecords(view.stats.map((s) => Object.fromEntries(Object.entries(s.tables).map(([k, t]) => [k, t.bytes]))));
    const createdByHour = sumRecords(view.stats.map((s) => s.createdByHour));
    const lengths = sumRecords(cur.map((r) => r.lengths));
    const screens = sumRecords(cur.map((r) => r.screens));
    const usersBefore = view.users.filter((u) => u.joinedAt < startMs).length;
    const cumulative = series.map((_, i) => usersBefore + series.slice(0, i + 1).reduce((n, p) => n + p.signups, 0));
    const chartSeries = series.map((p, i) => {
      const value = metric === "users" ? cumulative[i] : (p[metric] as number);
      const pp = prevSeries[i];
      return { day: p.day, value, prev: metric === "users" ? undefined : (pp?.[metric] as number | undefined), prevDay: pp?.day };
    });

    return {
      view, cur, tc, tp, ai, aiPrev, aiDays, aiCalls, series, chartSeries, rows, signups, signupsPrev, avgDau, avgDauPrev, entries, entriesPrev, bandwidth, bandwidthPrev,
      docsBytes, fileBytes, activeDevices, latest, behind, sources, gmail, thisMonth, drafts, tableBytes, createdByHour, lengths, screens,
      heat: hourOfWeek(cur),
      cohorts: cohorts(view.users, view.daily, today, 8),
      features: Object.entries(FEATURES).map(([k, label]) => ({ key: k, label, value: view.stats.filter((s) => s.features[k]).length })).sort((a, b) => b.value - a.value),
      rejected: sum((s) => s.syncOps.rejected),
      applied: sum((s) => s.syncOps.applied),
      staleStats: view.stats.reduce((t, s) => Math.min(t, s.computedAt), Infinity),
    };
  }, [data, f, meId, today, metric]);

  const allOs = [...new Set(data.devices.map((d) => d.os))].sort();
  const metricDef = METRICS.find((x) => x.key === metric)!;
  const periodLabel = RANGES.find((r) => r.days === f.days)?.label ?? `${f.days}d`;
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.value === params.get("tab"))?.value ?? "overview";
  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === "overview") p.delete("tab");
    else p.set("tab", t);
    setParams(p, { replace: true });
    window.scrollTo(0, 0);
  };

  const tiles = (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
      <Tile label="Users" value={fmtNum(m.view.users.length)} sub={`${m.signups} new in ${periodLabel}`} delta={change(m.signups, m.signupsPrev)} info="Accounts that exist now. The change is in sign-ups against the period before." />
      <Tile label="Active users" value={fmtNum(m.tc.activeUsers)} sub={`${fmtNum(m.avgDau)} a day on average`} delta={change(m.tc.activeUsers, m.tp.activeUsers)} />
      <Tile label="Stickiness" value={m.tc.activeUsers ? fmtPct(m.avgDau / m.tc.activeUsers) : "–"} sub="Daily ÷ period users" delta={change(m.avgDau, m.avgDauPrev)} info="How many of the period's users come back on a typical day. 50% means a typical user opens it every other day." />
      <Tile label="Opens" value={fmtNum(m.tc.opens)} sub={m.tc.activeUsers ? `${fmtNum(m.tc.opens / m.tc.activeUsers)} per user` : undefined} delta={change(m.tc.opens, m.tp.opens)} info="A session starts when the app is opened, or comes back after 30 minutes away." />
      <Tile label="Avg session" value={m.tc.opens ? fmtDuration(m.tc.activeMs / m.tc.opens) : "–"} sub={`${fmtDuration(m.tc.activeMs)} in total`} delta={change(m.tc.opens ? m.tc.activeMs / m.tc.opens : 0, m.tp.opens ? m.tp.activeMs / m.tp.opens : 0)} info="Time the app was on screen, not just open in a background tab." />
      <Tile label="Entries added" value={fmtNum(m.entries)} sub={`${fmtNum(m.view.stats.reduce((n, s) => n + (s.tables.transactions?.count ?? 0), 0))} stored in all`} delta={change(m.entries, m.entriesPrev)} />
      <Tile label="Bandwidth" value={fmtBytes(m.bandwidth)} sub={`↓ ${fmtBytes(m.tc.bytesDown)} · ↑ ${fmtBytes(m.tc.bytesUp)}`} delta={change(m.bandwidth, m.bandwidthPrev)} info="Measured on each device: sync data as JSON, uploads by size, photo downloads estimated from each user's average photo. An estimate, not Convex's bill." />
      <Tile label="Storage" value={fmtBytes(m.docsBytes + m.fileBytes)} sub={`Docs ${fmtBytes(m.docsBytes)} · files ${fmtBytes(m.fileBytes)}`} info="Exact sizes of every document and file the users keep, counted daily (or with the refresh button)." />
    </div>
  );

  const overTime = (
    <Card title="Over time" hint={`${metricDef.label} per day, last ${periodLabel}`}
      right={(
        <Select value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
          <SelectTrigger aria-label="Measure" className="h-8 w-36 sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{METRICS.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
        </Select>
      )}>
      <DayChart data={m.chartSeries} label={metricDef.label} format={metricDef.format} />
    </Card>
  );

  const health = (
    <Card title="Health" hint="Things worth a look">
      <ul className="divide-y text-sm">
        <Health label="Sync ops rejected (30 days)" value={`${fmtNum(m.rejected)} of ${fmtNum(m.applied + m.rejected)}`} bad={m.rejected > 0} />
        <Health label="Gmail with an error" value={fmtNum(m.gmail.filter((s) => s.gmail!.hasError).length)} bad={m.gmail.some((s) => s.gmail!.hasError)} />
        <Health label="Gmail needing reconnect" value={fmtNum(m.gmail.filter((s) => s.gmail!.status === "reauth").length)} bad={m.gmail.some((s) => s.gmail!.status === "reauth")} />
        <Health label="Devices on an older build" value={fmtNum(m.behind)} bad={m.behind > 0} />
        <Health label="Never finished setup" value={fmtNum(m.view.stats.filter((s) => !s.features.onboarded).length)} />
        <Health label="Storage last counted" value={Number.isFinite(m.staleStats) ? `${formatDistanceToNowStrict(m.staleStats)} ago` : "Never: tap refresh"} bad={!Number.isFinite(m.staleStats) || data.now - m.staleStats > 2 * 86_400_000} />
      </ul>
    </Card>
  );

  const sections: Record<Tab, ReactNode> = {
    overview: (
      <>
        {tiles}
        {overTime}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Retention" hint="Share of each sign-up week back in each week after (W0: the sign-up week)">
            <CohortGrid cohorts={m.cohorts} />
          </Card>
          {health}
        </div>
      </>
    ),
    engagement: (
      <>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="When people open it" hint="Opens by weekday and hour, in each device's own time">
            <Heatmap grid={m.heat} />
          </Card>
          <Card title="When entries get logged" hint="Every stored entry, by the hour it was created (user's local time)">
            <Columns data={Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: m.createdByHour[`h${h}`] ?? 0 }))} label="Entries" color={SLOT(2)} />
          </Card>
          <Card title="Session length" hint="How long the app stays on screen per open">
            <Columns data={LENGTH_BUCKETS.map((b) => ({ label: b.label, value: m.lengths[b.key] ?? 0 }))} label="Sessions" height="h-48" color={SLOT(6)} />
          </Card>
          <Card title="Screens" hint="Visits in the period">
            <BarList items={Object.entries(m.screens).map(([label, value]) => ({ label: <span className="font-mono text-xs">{label}</span>, value })).sort((a, b) => b.value - a.value)} limit={8} color={SLOT(2)} />
          </Card>
        </div>
        <Leaderboards rows={m.rows} onPick={onPick} period={periodLabel} />
      </>
    ),
    devices: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Platforms" hint={`Devices used in the last ${periodLabel} · tap one to filter`}>
          <BarList items={tally(m.activeDevices, (d) => d.os).map((x) => ({ ...x, key: x.label }))} of={m.activeDevices.length} onPick={(os) => setF({ os })} />
        </Card>
        <Card title="Installed or browser" hint="How each device opens UnMoney">
          <Group title="Opens as"><BarList items={tally(m.activeDevices, (d) => (d.standalone ? "Installed app" : "Browser tab"))} of={m.activeDevices.length} /></Group>
          <Group title="Device type"><BarList items={tally(m.activeDevices, (d) => capital(d.formFactor))} of={m.activeDevices.length} color={SLOT(1)} /></Group>
        </Card>
        <Card title="Browsers">
          <BarList items={tally(m.activeDevices, (d) => d.browser)} of={m.activeDevices.length} color={SLOT(1)} />
        </Card>
        <Card title="App versions" hint={m.behind ? `${m.behind} of ${m.activeDevices.length} devices are not on the newest build` : "Every active device is on the newest build"}
          info="Builds older than the newest seen are devices that have not reloaded since a deploy. Worth knowing before a change that old clients cannot handle.">
          <BarList items={tally(m.activeDevices, (d) => d.appVersion).sort((a, b) => b.label.localeCompare(a.label)).map((x) => ({ ...x, hint: x.label === m.latest ? "newest" : undefined }))} of={m.activeDevices.length} limit={6} color={SLOT(6)} />
        </Card>
      </div>
    ),
    features: (
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Feature adoption" hint="Users with the feature set up" className="md:row-span-2">
          <BarList items={m.features} of={m.view.stats.length || 1} limit={18} color={SLOT(2)} />
        </Card>
        <Card title="How entries come in" hint="Every stored entry">
          <BarList items={m.sources} of={m.sources.reduce((s, x) => s + x.value, 0)} color={SLOT(3)} />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Mini label="with photos" value={fmtNum(m.view.stats.reduce((n, s) => n + s.entries.withPhotos, 0))} />
            <Mini label="on UnSplit" value={fmtNum(m.view.stats.reduce((n, s) => n + s.entries.split, 0))} />
            <Mini label="transfers" value={fmtNum(m.view.stats.reduce((n, s) => n + s.entries.transfers, 0))} />
          </div>
        </Card>
        <Card title="Gmail sync" hint={`${m.gmail.length} of ${m.view.stats.length} users connected`}>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="AI calls this month" value={fmtNum(m.gmail.reduce((n, s) => n + (s.gmail!.aiMonth === m.thisMonth ? s.gmail!.aiCalls : 0), 0))} />
            <Mini label="Drafts saved" value={m.drafts.accepted + m.drafts.dismissed ? fmtPct(m.drafts.accepted / (m.drafts.accepted + m.drafts.dismissed)) : "–"} />
            <Mini label="Read by rules" value={m.drafts.rule + m.drafts.ai ? fmtPct(m.drafts.rule / (m.drafts.rule + m.drafts.ai)) : "–"} />
          </div>
          <Group title="Drafts"><BarList items={[{ label: "Saved as entries", value: m.drafts.accepted }, { label: "Not an entry", value: m.drafts.dismissed }, { label: "Waiting", value: m.drafts.open }].filter((x) => x.value)} of={m.drafts.accepted + m.drafts.dismissed + m.drafts.open} color={SLOT(5)} empty="No drafts yet" /></Group>
          <Group title="Connections"><BarList items={tally(m.gmail, (s) => GMAIL_STATUS[s.gmail!.status] ?? s.gmail!.status)} of={m.gmail.length} color={SLOT(5)} empty="Nobody has connected Gmail" /></Group>
        </Card>
        <Card title="Payment methods" hint="Kinds users keep">
          <BarList items={Object.entries(sumRecords(m.view.stats.map((s) => s.accountKinds))).map(([k, value]) => ({ label: KINDS[k] ?? k, value })).sort((a, b) => b.value - a.value)} color={SLOT(3)} />
        </Card>
        <Card title="Preferences" hint="Main currency, theme, accent">
          <Group title="Main currency"><BarList items={tally(m.view.stats, (s) => s.prefs.currency)} of={m.view.stats.length} limit={4} color={SLOT(4)} /></Group>
          <Group title="Theme"><BarList items={tally(m.view.stats, (s) => s.prefs.theme && capital(s.prefs.theme))} of={m.view.stats.length} limit={3} color={SLOT(4)} /></Group>
          <Group title="Accent"><BarList items={tally(m.view.stats, (s) => s.prefs.accent && capital(s.prefs.accent))} of={m.view.stats.length} limit={4} color={SLOT(4)} /></Group>
        </Card>
      </div>
    ),
    data: (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bandwidth" hint="Sync data down and up per day" className="lg:col-span-2">
          <StackedDayBars data={m.series.map((p) => ({ day: p.day, down: p.bytesDown, up: p.bytesUp }))} series={[{ key: "down", label: "Downloaded" }, { key: "up", label: "Uploaded" }]} format={fmtBytes} />
        </Card>
        <Card title="Storage by user" hint="Documents and files each user keeps · tap for more">
          <BarList items={m.rows.filter((u) => u.storage).sort((a, b) => b.storage - a.storage).map((u) => ({ key: u.id, label: nameOf(u), value: u.storage, hint: `${fmtNum(u.entries)} entries` }))} format={fmtBytes} onPick={onPick} />
        </Card>
        <Card title="Storage by table" hint={`Across every user · files ${fmtBytes(m.fileBytes)}`}>
          <BarList items={Object.entries(m.tableBytes).filter(([, n]) => n).map(([label, value]) => ({ label: <span className="font-mono text-xs">{label}</span>, value })).sort((a, b) => b.value - a.value)} format={fmtBytes} limit={10} color={SLOT(1)} />
        </Card>
        <Card title="AI cost" hint={`What Claude cost per day, last ${periodLabel}`} className="lg:col-span-2"
          info="Each call is priced from the tokens Anthropic reports, at list prices (shared/aiCost.ts), when it is made. Counted from 2 Nov 2026; earlier calls are not in it.">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label={m.aiPrev.costUsd ? `spent · was ${fmtUsd(m.aiPrev.costUsd)}` : "spent"} value={fmtUsd(m.ai.costUsd)} />
            <Mini label="calls to Claude" value={fmtNum(m.ai.calls)} />
            <Mini label="per user who used it" value={m.ai.users ? fmtUsd(m.ai.costUsd / m.ai.users) : "–"} />
            <Mini label="tokens in · out" value={`${fmtNum(m.ai.inputTokens)} · ${fmtNum(m.ai.outputTokens)}`} />
          </div>
          <StackedDayBars data={m.aiDays} series={AI_FEATURES.map((x) => ({ key: x.key, label: x.label }))} format={fmtUsd} />
        </Card>
        <Card title="AI cost by user" hint={`Last ${periodLabel} · tap for more`}>
          <BarList items={m.rows.filter((u) => u.aiCost).sort((a, b) => b.aiCost - a.aiCost).map((u) => ({ key: u.id, label: nameOf(u), value: u.aiCost, hint: `${fmtNum(u.aiCalls)} ${u.aiCalls === 1 ? "call" : "calls"}` }))} format={fmtUsd} of={m.ai.costUsd} onPick={onPick} color={SLOT(3)} empty="No AI calls in the period" />
        </Card>
        <Card title="AI cost by feature" hint={`Last ${periodLabel}`}>
          <BarList items={AI_FEATURES.map((x) => ({ label: x.label, value: m.ai[x.key], hint: `${fmtNum(m.aiCalls[x.key])} ${m.aiCalls[x.key] === 1 ? "call" : "calls"}` })).filter((x) => x.value)} format={fmtUsd} of={m.ai.costUsd} color={SLOT(3)} empty="No AI calls in the period" />
        </Card>
      </div>
    ),
    users: <UsersTable rows={m.rows} onPick={onPick} period={periodLabel} now={data.now} />,
  };

  return (
    <>
      {/* sections, kept under the header while scrolling */}
      <div className="sticky top-12 z-20 border-b bg-background">
        <div className="mx-auto max-w-6xl">
          {/* all six share a phone's width, so none hides off the edge */}
          <div role="tablist" aria-label="Sections" className="flex sm:px-2">
            {TABS.map((t) => (
              <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
                className={cn("-mb-px flex-1 whitespace-nowrap border-b-2 px-1 py-2.5 text-[13px] transition-colors sm:flex-none sm:px-4 sm:text-sm",
                  tab === t.value ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-3 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pt-4">
        {/* filters: above everything they change; on a phone the period gets a row of its own */}
        <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
          <div role="radiogroup" aria-label="Period" className="flex rounded-md border p-0.5 sm:inline-flex">
            {RANGES.map((r) => (
              <button key={r.days} type="button" role="radio" aria-checked={f.days === r.days} onClick={() => setF({ days: r.days })}
                className={cn("flex-1 rounded px-2.5 py-1.5 text-sm sm:flex-none sm:py-1", f.days === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select value={f.userId} onValueChange={(v) => setF({ userId: v })}>
              <SelectTrigger aria-label="User" className="h-9 w-full sm:h-8 sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All users</SelectItem>
                {data.users.filter((u) => f.includeMe || u.id !== meId).map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email || u.id}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.os} onValueChange={(v) => setF({ os: v })}>
              <SelectTrigger aria-label="Platform" className="h-9 w-full sm:h-8 sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All platforms</SelectItem>
                {allOs.map((os) => <SelectItem key={os} value={os}>{os}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={f.mode} onValueChange={(v) => setF({ mode: v as Filters["mode"] })}>
              <SelectTrigger aria-label="Installed or browser" className="h-9 w-full sm:h-8 sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">App and browser</SelectItem>
                <SelectItem value="installed">Installed app</SelectItem>
                <SelectItem value="browser">Browser tab</SelectItem>
              </SelectContent>
            </Select>
            <label className="inline-flex items-center justify-end gap-2 text-sm text-muted-foreground sm:ml-auto">
              <Switch checked={f.includeMe} onCheckedChange={(v) => setF({ includeMe: v })} /> Include me
            </label>
          </div>
        </div>

        {data.truncated ? (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"><TriangleAlert className="size-4 shrink-0" />Too much usage to load at once: the oldest days of this period are left out.</p>
        ) : null}

        {sections[tab]}
      </div>
    </>
  );
}

const nameOf = (u: { name: string | null; email: string | null; id: string }) => u.name || u.email || u.id;

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Health({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <li className="flex items-center gap-2 py-2">
      {bad ? <TriangleAlert className="size-4 shrink-0 text-amber-600" aria-label="Needs a look" /> : <span className="size-4 shrink-0" />}
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-muted-foreground">{value}</span>
    </li>
  );
}

function Leaderboards({ rows, onPick, period }: { rows: UserRow[]; onPick: (id: string) => void; period: string }) {
  const boards: { title: string; hint: string; pick: (u: UserRow) => number; format: (n: number) => string; min?: (u: UserRow) => boolean }[] = [
    { title: "Most days in", hint: `Active days, last ${period}`, pick: (u) => u.activeDays, format: fmtNum },
    { title: "Longest streak", hint: "Days in a row, in the period", pick: (u) => u.longestStreak, format: (n) => `${n}d` },
    { title: "Night owls", hint: "Share of opens between midnight and 5am", pick: (u) => u.nightShare, format: fmtPct, min: (u) => u.opens >= 5 },
    { title: "Most time in app", hint: `Last ${period}`, pick: (u) => u.activeMs, format: fmtDuration },
    { title: "Biggest ledgers", hint: "Entries stored", pick: (u) => u.entries, format: fmtNum },
    { title: "Heaviest on bandwidth", hint: `Last ${period}`, pick: (u) => u.bandwidth, format: fmtBytes },
  ];
  const [picked, setPicked] = useState(boards[0].title);
  const list = (b: (typeof boards)[number]) => {
    const top = rows.filter((u) => b.pick(u) > 0 && (!b.min || b.min(u))).sort((x, y) => b.pick(y) - b.pick(x)).slice(0, 5);
    if (!top.length) return <p className="py-4 text-center text-sm text-muted-foreground">Nobody yet</p>;
    return (
      <ol className="space-y-1">
        {top.map((u, i) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent/50 active:bg-accent">
              <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <Avatar seed={u.email || u.name || u.id} src={u.image ?? undefined} size={24} />
              <span className="min-w-0 flex-1 truncate">{nameOf(u)}</span>
              <span className="tabular-nums font-medium">{b.format(b.pick(u))}</span>
            </button>
          </li>
        ))}
      </ol>
    );
  };
  const current = boards.find((b) => b.title === picked) ?? boards[0];
  return (
    <>
      {/* a phone: one board at a time, picked from a list, instead of six cards to scroll past */}
      <Card title="Leaderboards" hint={current.hint} className="md:hidden"
        right={(
          <Select value={current.title} onValueChange={setPicked}>
            <SelectTrigger aria-label="Leaderboard" className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{boards.map((b) => <SelectItem key={b.title} value={b.title}>{b.title}</SelectItem>)}</SelectContent>
          </Select>
        )}>
        {list(current)}
      </Card>
      <div className="hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {boards.map((b) => <Card key={b.title} title={b.title} hint={b.hint}>{list(b)}</Card>)}
      </div>
    </>
  );
}

type SortKey = "joinedAt" | "lastSeenAt" | "opens" | "activeDays" | "activeMs" | "entries" | "storage" | "bandwidth" | "aiCost" | "devices";
const SORTS: Record<SortKey, string> = {
  lastSeenAt: "Last seen", joinedAt: "Joined", opens: "Opens", activeDays: "Days", activeMs: "Time",
  entries: "Entries", storage: "Storage", bandwidth: "Bandwidth", aiCost: "AI cost", devices: "Devices",
};
/** The sorted-by value, for a phone row that has no column for it. */
function sortValue(u: UserRow, key: SortKey): string {
  if (key === "joinedAt") return new Date(u.joinedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (key === "activeMs") return fmtDuration(u.activeMs);
  if (key === "bandwidth") return fmtBytes(u.bandwidth);
  if (key === "aiCost") return fmtUsd(u.aiCost);
  return fmtNum(u[key] ?? 0);
}

function UsersTable({ rows, onPick, period, now }: { rows: UserRow[]; onPick: (id: string) => void; period: string; now: number }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "lastSeenAt", desc: true });
  const shown = rows
    .filter((u) => !q || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => ((a[sort.key] ?? 0) - (b[sort.key] ?? 0)) * (sort.desc ? -1 : 1));
  const th = (key: SortKey, label: string) => (
    <th className="px-2 py-2 text-right font-normal">
      <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))} className={cn("whitespace-nowrap hover:text-foreground", sort.key === key && "font-medium text-foreground")}
        aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined}>
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const ago = (ms: number | null) => (!ms ? "–" : now - ms < 60_000 ? "just now" : formatDistanceToNowStrict(ms, { addSuffix: true }));
  return (
    <Card title={`Users (${rows.length})`} hint={`Usage covers the last ${period}. Tap a user for more.`}>
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search users by name or email" className="h-9 pl-7 md:h-8" />
        </div>
        {/* a phone has no column headers to tap */}
        <Select value={sort.key} onValueChange={(v) => setSort({ key: v as SortKey, desc: true })}>
          <SelectTrigger aria-label="Sort by" className="h-9 w-36 md:hidden"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(SORTS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORTS[k]}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <ul className="-mx-3 divide-y border-t sm:-mx-4 md:hidden">
        {shown.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-accent sm:px-4">
              <Avatar seed={u.email || u.name || u.id} src={u.image ?? undefined} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(u)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(u.lastSeenAt)}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                  <span><b className="font-medium text-foreground">{fmtNum(u.opens)}</b> opens</span>
                  <span><b className="font-medium text-foreground">{u.activeDays}</b> {u.activeDays === 1 ? "day" : "days"}</span>
                  <span><b className="font-medium text-foreground">{fmtNum(u.entries)}</b> entries</span>
                  {u.storage ? <span><b className="font-medium text-foreground">{fmtBytes(u.storage)}</b></span> : null}
                  {sort.key !== "lastSeenAt" && !["opens", "activeDays", "entries", "storage"].includes(sort.key) ? <span><b className="font-medium text-foreground">{sortValue(u, sort.key)}</b> {SORTS[sort.key].toLowerCase()}</span> : null}
                </div>
              </div>
            </button>
          </li>
        ))}
        {!shown.length ? <li className="px-4 py-6 text-center text-sm text-muted-foreground">No users match</li> : null}
      </ul>
      <div className="-mx-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-sm tabular-nums">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-normal">User</th>
              {th("joinedAt", "Joined")}
              {th("lastSeenAt", "Last seen")}
              {th("opens", "Opens")}
              {th("activeDays", "Days")}
              {th("activeMs", "Time")}
              {th("entries", "Entries")}
              {th("storage", "Storage")}
              {th("bandwidth", "Bandwidth")}
              {th("aiCost", "AI cost")}
              {th("devices", "Devices")}
              <th className="px-2 py-2 text-left font-normal">Gmail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} onClick={() => onPick(u.id)} className="cursor-pointer border-b last:border-b-0 hover:bg-accent/50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar seed={u.email || u.name || u.id} src={u.image ?? undefined} size={28} />
                    <div className="min-w-0">
                      <button type="button" className="block max-w-[200px] truncate text-left font-medium" onClick={(e) => { e.stopPropagation(); onPick(u.id); }}>{nameOf(u)}</button>
                      <div className="max-w-[200px] truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">{new Date(u.joinedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" })}</td>
                <td className="px-2 py-2 text-right whitespace-nowrap">{ago(u.lastSeenAt)}</td>
                <td className="px-2 py-2 text-right">{fmtNum(u.opens)}</td>
                <td className="px-2 py-2 text-right">{u.activeDays}</td>
                <td className="px-2 py-2 text-right">{u.activeMs ? fmtDuration(u.activeMs) : "–"}</td>
                <td className="px-2 py-2 text-right">{fmtNum(u.entries)}</td>
                <td className="px-2 py-2 text-right">{u.storage ? fmtBytes(u.storage) : "–"}</td>
                <td className="px-2 py-2 text-right">{u.bandwidth ? fmtBytes(u.bandwidth) : "–"}</td>
                <td className="px-2 py-2 text-right">{u.aiCost ? fmtUsd(u.aiCost) : "–"}</td>
                <td className="px-2 py-2 text-right">{u.devices}{u.installed ? <span className="ml-1 text-xs text-muted-foreground">· app</span> : null}</td>
                <td className="px-2 py-2 text-xs text-muted-foreground">{u.gmail ?? "–"}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={12} className="px-4 py-6 text-center text-muted-foreground">No users match</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

