/** One user on the superadmin dashboard: their use over the period, devices, what they store, latest sessions. */
import { useQuery } from "convex/react";
import { formatDistanceToNowStrict } from "date-fns";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar } from "@/components/shell/Avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { BarList, DayChart, SLOT, Tile } from "./charts";
import { addDays, daySeries, fmtBytes, fmtDuration, fmtNum, inRange, photoBytes, storageOf, streaks, totals, type Overview } from "./metrics";

const FEATURE_LABELS: Record<string, string> = {
  budgets: "Budgets", repeats: "Repeats", installments: "Installments", bookmarks: "Bookmarks", notes: "Notes", subCurrencies: "Sub-currencies",
  photos: "Photos", imports: "Imports", unsplit: "UnSplit", gmail: "Gmail", aiTidy: "AI tidy-up",
  tidyUp: "Tidy-up", iphoneShortcut: "iPhone shortcut", passcode: "Passcode", subcategories: "Subcategories", carryOver: "Carry-over", timeInput: "Time input",
};

export function UserSheet({ userId, onClose, data, today, days }: { userId: string | null; onClose: () => void; data: Overview; today: string; days: number }) {
  const user = data.users.find((u) => u.id === userId);
  return (
    <Sheet open={!!user} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {user ? <Body user={user} data={data} today={today} days={days} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ user, data, today, days }: { user: Overview["users"][number]; data: Overview; today: string; days: number }) {
  const sessions = useQuery(api.admin.userSessions, { userId: user.id as Id<"users">, limit: 30 });
  const from = addDays(today, -(days - 1));
  const daily = inRange(data.daily.filter((r) => r.userId === user.id), from, today);
  const stats = data.stats.find((s) => s.userId === user.id);
  const devices = data.devices.filter((d) => d.userId === user.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const t = totals(daily);
  const view = { users: [user], devices, daily, stats: stats ? [stats] : [] };
  const series = daySeries(view, from, today);
  const allDays = data.daily.filter((r) => r.userId === user.id).map((r) => r.day);
  const streak = streaks(allDays, today);
  const features = stats ? Object.entries(stats.features).filter(([k, on]) => on && FEATURE_LABELS[k]).map(([k]) => FEATURE_LABELS[k]) : [];
  return (
    <>
      <SheetHeader className="flex-row items-center gap-3 space-y-0">
        <Avatar seed={user.email || user.name || user.id} src={user.image ?? undefined} size={44} />
        <div className="min-w-0 pr-6">
          <SheetTitle className="truncate">{user.name || user.email || "Unnamed"}</SheetTitle>
          <SheetDescription>
            <span className="block truncate">{user.email}</span>
            Joined {formatDistanceToNowStrict(user.joinedAt, { addSuffix: true })}
            {stats?.firstEntryDate ? ` · entries back to ${stats.firstEntryDate}` : ""}
          </SheetDescription>
        </div>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-8">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile small label="Opens" value={fmtNum(t.opens)} sub={`${t.userDays} active days`} />
          <Tile small label="Time in app" value={fmtDuration(t.activeMs)} sub={t.opens ? `${fmtDuration(t.activeMs / t.opens)} a session` : undefined} />
          <Tile small label="Streak" value={`${streak.current}d`} sub={`Longest ${streak.longest}d`} />
          <Tile small label="Entries" value={fmtNum(stats?.tables.transactions?.count ?? 0)} sub={stats ? `${fmtNum(stats.entries.gmail)} from Gmail` : undefined} />
          <Tile small label="Storage" value={stats ? fmtBytes(storageOf(stats)) : "–"} sub={stats ? `${stats.files.count} files · ${fmtBytes(stats.files.bytes)}` : "Not counted yet"} />
          <Tile small label="Bandwidth" value={fmtBytes(t.bytesDown + t.bytesUp + photoBytes(daily, stats ? [stats] : []))} sub={`${fmtNum(t.opsSent)} changes synced`} />
        </div>

        <section>
          <h3 className="mb-2 text-sm font-medium">Minutes in app per day</h3>
          <DayChart data={series.map((p) => ({ day: p.day, value: p.activeMin }))} label="Minutes" format={(n) => fmtNum(Math.round(n))} />
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">Devices ({devices.length})</h3>
          <ul className="divide-y rounded-md border text-sm">
            {devices.map((d) => (
              <li key={d.deviceId} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{d.os} · {d.browser} · {d.formFactor}{d.standalone ? " · installed" : ""}</div>
                  <div className="text-xs text-muted-foreground">{d.sessions} sessions · build {d.appVersion} · UTC{d.tzOffset >= 0 ? "+" : "−"}{fmtOffset(Math.abs(d.tzOffset))}</div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDistanceToNowStrict(d.lastSeenAt, { addSuffix: true })}</span>
              </li>
            ))}
            {!devices.length ? <li className="px-3 py-3 text-muted-foreground">Not seen since usage counting began</li> : null}
          </ul>
        </section>

        {stats ? (
          <section>
            <h3 className="mb-2 text-sm font-medium">What they keep</h3>
            <BarList items={Object.entries(stats.tables).filter(([, x]) => x.count).map(([k, x]) => ({ label: <span className="font-mono text-xs">{k}</span>, value: x.bytes, hint: `${fmtNum(x.count)} ${x.count === 1 ? "doc" : "docs"}` })).sort((a, b) => b.value - a.value)} format={fmtBytes} limit={8} color={SLOT(1)} />
            {features.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {features.map((f) => <span key={f} className="rounded-full border px-2 py-0.5 text-xs">{f}</span>)}
              </div>
            ) : null}
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-sm font-medium">Latest sessions</h3>
          {sessions === undefined ? <Skeleton className="h-32" /> : (
            <ul className="divide-y rounded-md border text-sm">
              {sessions.map((s) => (
                <li key={s.sessionId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div>{new Date(s.startedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {fmtDuration(s.activeMs)}</div>
                    <div className="truncate text-xs text-muted-foreground">{Object.entries(s.screens).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 5).join(", ") || "–"}</div>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">↓ {fmtBytes(s.bytesDown)}</span>
                </li>
              ))}
              {!sessions.length ? <li className="px-3 py-3 text-muted-foreground">No sessions yet</li> : null}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

const fmtOffset = (min: number) => `${Math.floor(min / 60)}${min % 60 ? `:${String(min % 60).padStart(2, "0")}` : ""}`;
