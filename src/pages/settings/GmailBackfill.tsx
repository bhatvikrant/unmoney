/**
 * Settings › Gmail, reading back to a year: the year field, the estimate before starting (how
 * much mail, how long, whether the AI reads last), and the progress while the server reads.
 * Reading runs on the server (convex/gmail.ts backfillStep), so every state says the app can close.
 */
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Clock, Cloud, History, Pause, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { countCapped, FIRST_YEAR, estimateMs, formatDuration, progressOf, remainingMs, yearProblem, yearStart } from "../../../shared/gmail/backfill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** "1 Jan 2023". */
export const longDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
/** "Mar 2025". */
const monthYear = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const count = (n: number) => n.toLocaleString();

/** The typed year, when it is one that can be read back to. */
export function validYear(text: string): number | null {
  const y = Number(text);
  return /^\d{4}$/.test(text) && !yearProblem(y, Date.now()) ? y : null;
}

/** A four-digit field with the last few years one tap away. */
export function YearField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const thisYear = new Date().getFullYear();
  const problem = value.length === 4 ? yearProblem(Number(value), Date.now()) : null;
  const recent = Array.from({ length: 5 }, (_, i) => thisYear - i).filter((y) => y >= FIRST_YEAR);
  return (
    <div>
      <label className="flex items-center gap-3">
        <span className="text-sm">Read mail since 1 January</span>
        <Input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder={String(thisYear - 1)} aria-label="Year to read back to"
          aria-invalid={!!problem} className="h-9 w-24 text-center text-sm tabular" />
      </label>
      {problem ? <div className="mt-1.5 text-xs text-destructive" role="alert">{problem}</div> : null}
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Recent years">
        {recent.map((y) => (
          <button key={y} type="button" onClick={() => onChange(String(y))} aria-pressed={value === String(y)}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs tabular transition-colors", value === String(y) ? "border-primary bg-accent/40 font-medium text-foreground" : "text-muted-foreground hover:bg-accent/40")}>
            {y === thisYear ? "This year" : y}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A line with a small icon, for the facts under an estimate or a progress bar. */
function Fact({ icon: Icon, children, tone }: { icon: typeof Clock; children: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={cn("mt-px size-3.5 shrink-0", tone === "good" ? "text-income" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")} />
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

/** Said wherever reading back is mentioned: the one thing people worry about with a long wait. */
export function CanClose({ starting }: { starting?: boolean }) {
  return (
    <Fact icon={Cloud} tone="good">
      <span className="text-foreground">You can close UnMoney{starting ? " once it starts" : ""}.</span> It reads on UnMoney's servers, so it keeps going with the app closed or your phone locked. Entries it finds wait in From Gmail; nothing is added before you review it.
    </Fact>
  );
}

type Estimate = { count: number; capped: boolean; ms: number; aiShort: boolean; aiResumesAt: number };

/**
 * Before starting (connected): counts the money mail since the year, debounced and once per year,
 * then says how long reading it takes. Counting lists ids only, about one Gmail call per 500 mails.
 */
export function BackfillEstimate({ year, busy, onStart }: { year: number | null; busy: boolean; onStart: (year: number) => void }) {
  const estimate = useAction(api.gmail.estimateBackfill);
  const cache = useRef(new Map<number, Estimate>());
  const [got, setGot] = useState<{ year: number; e?: Estimate; failed?: boolean } | null>(null);

  useEffect(() => {
    if (year === null) return;
    const hit = cache.current.get(year);
    if (hit) { setGot({ year, e: hit }); return; }
    setGot({ year });
    let live = true;
    const timer = setTimeout(() => {
      estimate({ from: yearStart(year) }).then(
        (e) => { cache.current.set(year, e); if (live) setGot({ year, e }); },
        () => { if (live) setGot({ year, failed: true }); },
      );
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [year, estimate]);

  if (year === null) return null;
  const mine = got?.year === year ? got : null;
  const e = mine?.e;
  return (
    <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3" aria-live="polite">
      <div className="text-sm"><span className="font-medium">{longDay(yearStart(year))}</span> to today</div>
      {!e && !mine?.failed ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="size-3.5 animate-spin" />Counting your money mail since then…</div>
      ) : null}
      {mine?.failed ? <Fact icon={Clock}>Couldn't count the mail just now. You can still start; progress and time left show once it's going.</Fact> : null}
      {e ? (
        <>
          <Fact icon={History}>
            {e.count === 0
              ? "No unread money mail in that time: everything there was already read. Starting finishes in moments."
              : <><span className="text-foreground">{e.capped ? `Over ${count(e.count)}` : `About ${count(e.count)}`} money {e.count === 1 ? "email" : "emails"}</span> UnMoney hasn't read yet.</>}
          </Fact>
          {e.count ? <Fact icon={Clock}>Takes <span className="text-foreground">{formatDuration(e.ms)}{e.capped ? " or more" : ""}</span>, depending on how much needs AI to read.</Fact> : null}
          {e.aiShort ? (
            <Fact icon={Sparkles} tone="warn">Mail no rule can read uses AI, which has a monthly allowance. If it runs out, the rest is read from {longDay(e.aiResumesAt)} on its own. Some is always kept for new mail.</Fact>
          ) : null}
        </>
      ) : null}
      <CanClose starting />
      <Button className="mt-1 w-full" disabled={busy} onClick={() => onStart(year)}>
        <History className="size-4" />{busy ? "Starting…" : `Start reading back to ${year}`}
      </Button>
    </div>
  );
}

type Backfill = { year: number; from: number; state: "running" | "waiting-ai" | "done"; startedAt: number; cursor: number; total: number | null; read: number; found: number; finishedAt: number | null; aiResumesAt: number };

/** While the server reads back: how far, how long left, and that the app can close. */
export function BackfillProgress({ b, paused, onStop, onReview, stopping }: { b: Backfill; paused: boolean; onStop: () => void; onReview: () => void; stopping: boolean }) {
  // the time left counts down between the server's updates
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const waitingAi = b.state === "waiting-ai";
  const counting = b.total === null;
  // never 100% before the server says done
  const pct = Math.min(99, Math.floor(progressOf(b) * 100));
  const capped = countCapped(b.total);
  const left = remainingMs(b, now);
  return (
    <div className="mx-4 mt-4 rounded-lg border bg-card p-3 md:mx-4" role="status">
      <div className="flex items-start gap-3">
        {paused || waitingAi
          ? <Pause className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          : <RefreshCw className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {paused ? "Reading old mail is paused" : waitingAi ? "Waiting for next month's AI reads" : `Reading your mail back to ${longDay(b.from)}`}
          </div>
          <Progress value={counting && !paused && !waitingAi ? 4 : pct} className={cn("mt-2 h-1.5", counting && !paused && !waitingAi && "animate-pulse")} aria-label="Progress reading old mail" />
          <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground tabular">
            <span>
              {counting ? "Counting emails…" : capped ? <>{count(b.read)} of {count(b.total!)}+ emails · {pct}%</> : <>{count(Math.min(b.read, b.total!))} of ~{count(b.total!)} emails · {pct}%</>}
            </span>
            {!paused && !waitingAi && left !== null ? <span className="text-foreground">{formatDuration(left)} left</span> : null}
          </div>
          <div className="mt-2 space-y-1.5">
            {paused ? <Fact icon={Pause}>Paused along with Gmail checks. Resume below to carry on from {monthYear(b.cursor)}.</Fact> : null}
            {waitingAi ? (
              <Fact icon={Sparkles} tone="warn">This month's AI reads for old mail are used up (some are kept for your new mail). It carries on by itself on {longDay(b.aiResumesAt)}, from {monthYear(b.cursor)}.</Fact>
            ) : null}
            {!paused && !waitingAi && !counting ? <Fact icon={History}>Now at {monthYear(b.cursor)}, working back to {monthYear(b.from)}.</Fact> : null}
            {!paused ? <CanClose /> : null}
          </div>
          <div className="mt-3 flex gap-2">
            {b.found ? <Button size="sm" onClick={onReview}>Review {count(b.found)} found</Button> : null}
            <Button size="sm" variant="outline" disabled={stopping} onClick={onStop}>{stopping ? "Stopping…" : "Stop"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Before connecting there is nothing to count yet: how long it takes, roughly, and what happens next. */
export function BackfillPreview({ year }: { year: number | null }) {
  if (year === null) return null;
  const years = Math.max(1, new Date().getFullYear() - year + 1);
  return (
    <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-sm"><span className="font-medium">{longDay(yearStart(year))}</span> to today · {years} {years === 1 ? "year" : "years"} of mail</div>
      <Fact icon={Clock}>Usually a few minutes for every few hundred money emails ({formatDuration(estimateMs(500))} for 500). Right after you connect you'll see how many there are, how long is left, and a progress bar.</Fact>
      <CanClose starting />
    </div>
  );
}
