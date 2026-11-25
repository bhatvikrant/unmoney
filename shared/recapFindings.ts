/**
 * What stands out in a month against the ones before it, found by the code: a category that keeps
 * climbing or shot up, the few entries behind a jump, a habit that grew, money going out earlier
 * than usual. Each finding carries its figures (Claude names them by path, shared/recapAi.ts) and
 * the chart the recap draws for it. Claude chooses among them and writes the words; it never makes
 * a finding, so a card can only say what the ledger shows.
 */
import { WEEKDAY_SHORT, diffDays, weekday } from "./dates";
import type { Range } from "./period";
import type { Snapshot } from "./ops";
import { notesByCount, rankedByTx } from "./recap";
import { settingsOf, statsEntries } from "./views";

export type Figure = { v: number; u: "money" | "count" | "pct" };
/** Bars read left to right (months oldest first); a split is a part of a whole with what is in the part; a line is the share of the month gone by each day. */
export type FindingChart =
  | { kind: "bars"; unit: "money" | "count"; bars: { label: string; value: number; on: boolean }[] }
  | { kind: "split"; part: number; total: number; items: { label: string; amount: number }[] }
  | { kind: "line"; now: number[]; usual: number[] };
export type FindingType = "climb" | "spike" | "low" | "drivers" | "without" | "pace" | "habit" | "weekday" | "missing";
export type Finding = {
  type: FindingType;
  /** The category, note or weekday it is about, as the person named it. */
  subject?: string;
  /** The notes of the entries behind it. */
  names?: string[];
  /** Money in minor units, never negative: the words say which way it went. */
  figures: Record<string, Figure>;
  chart: FindingChart;
  /** The entries behind it, as the recap's ?drill= value (src/pages/recap/drill.ts): "c:<id>", "n:<note>". */
  drill?: string;
  /** Roughly the share of the month's spending it is about: the most telling findings are kept. */
  score: number;
};

export const MAX_FINDINGS = 8;
/** A category's move counts when it is at least this share of the month's spending. */
const MATERIAL = 0.03;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const sum = (ns: number[]) => ns.reduce((a, n) => a + n, 0);
const mean = (ns: number[]) => (ns.length ? sum(ns) / ns.length : 0);
const money = (v: number): Figure => ({ v: Math.round(Math.abs(v)), u: "money" });
const count = (v: number): Figure => ({ v: Math.round(v), u: "count" });
const pct = (share: number): Figure => ({ v: Math.round(share * 100), u: "pct" });

/**
 * The findings for a month. `periods[0]` is the month itself and the rest the months before it,
 * newest first, each with a short label ("Oct"); `cats` is what went out under each category in
 * each of them, as Stats counts it.
 */
export function monthFindings(snap: Snapshot, periods: { label: string; range: Range }[], cats: Map<string, { name: string; per: number[] }>): Finding[] {
  const entries = periods.map((p) => statsEntries(snap, p.range.from, p.range.to, "expense"));
  const totals = entries.map((es) => sum(es.map((e) => e.amount)));
  const total = totals[0];
  const P = periods.length;
  if (!total || P < 3) return [];
  const usualTotal = mean(totals.slice(1));
  // oldest first, as a chart reads
  const bars = (per: number[], unit: "money" | "count", on: (i: number) => boolean): FindingChart =>
    ({ kind: "bars", unit, bars: per.map((value, i) => ({ label: periods[i].label, value, on: on(i) })).reverse() });
  const noteOf = (e: (typeof entries)[number][number]) => e.t.note.trim() || cats.get(e.bucket)?.name || "No note";
  const out: Finding[] = [];

  // a category that keeps climbing, shot past its usual, or had its lightest month
  let jumped: { id: string; score: number } | undefined;
  for (const [id, { name, per }] of cats) {
    const usual = mean(per.slice(1));
    const diff = per[0] - usual;
    const score = Math.abs(diff) / total;
    // the months in a row it rose, this one included
    let run = 1;
    while (run < P && per[run - 1] > per[run] && per[run] > 0) run++;
    const base = { subject: name, drill: `c:${id}` };
    if (run >= 3 && per[0] - per[run - 1] >= total * MATERIAL) {
      out.push({ ...base, type: "climb", figures: { now: money(per[0]), start: money(per[run - 1]), months: count(run) }, chart: bars(per, "money", (i) => i < run), score: score + 0.05 });
    } else if (usual > 0 && per[0] >= 2 * usual && diff >= total * MATERIAL) {
      out.push({ ...base, type: "spike", figures: { now: money(per[0]), usual: money(usual), times: count(Math.floor(per[0] / usual)) }, chart: bars(per, "money", (i) => i === 0), score });
    } else if (P >= 4 && per[0] > 0 && per[0] < Math.min(...per.slice(1)) && -diff >= total * MATERIAL) {
      out.push({ ...base, type: "low", figures: { now: money(per[0]), usual: money(usual), months: count(P) }, chart: bars(per, "money", (i) => i === 0), score });
      continue;
    } else continue;
    if (!jumped || score > jumped.score) jumped = { id, score };
  }

  // what is behind the biggest jump: a few large entries that made up most of it
  if (jumped) {
    const { id, score } = jumped;
    const ranked = rankedByTx(entries[0].filter((e) => e.bucket === id));
    const k = ranked.length >= 6 ? 3 : 1;
    const top = ranked.slice(0, k);
    const whole = sum(ranked.map((e) => e.amount)), part = sum(top.map((e) => e.amount));
    if (ranked.length > k && part >= whole * 0.5) {
      out.push({
        type: "drivers", subject: cats.get(id)!.name, names: top.map(noteOf), drill: `c:${id}`,
        figures: { total: money(whole), top: money(part), share: pct(part / whole), biggest: count(k), entries: count(ranked.length) },
        chart: { kind: "split", part, total: whole, items: top.map((e) => ({ label: noteOf(e), amount: e.amount })) },
        score: score - 0.001,
      });
    }
  }

  // A dear month set beside a usual one with its one-offs taken out: the largest entries that are not
  // scheduled and whose note did not come up in the months before (rent is large every month; a wedding gift is not).
  const notes = entries.map((es) => new Map(notesByCount(es).map((n) => [n.text.toLowerCase(), n])));
  const before = new Set(notes.slice(1).flatMap((m) => [...m.keys()]));
  const oneOffs = rankedByTx(entries[0]).filter((e) => !e.t.repeatId && e.t.note.trim() && !before.has(e.t.note.trim().toLowerCase())).slice(0, 3);
  const topSum = sum(oneOffs.map((e) => e.amount));
  if (topSum >= total * 0.2 && total >= usualTotal * 1.15) {
    out.push({
      type: "without", names: oneOffs.map(noteOf),
      figures: { total: money(total), top: money(topSum), rest: money(total - topSum), usual: money(usualTotal), share: pct(topSum / total), entries: count(oneOffs.length) },
      chart: { kind: "bars", unit: "money", bars: [{ label: "Usual", value: Math.round(usualTotal), on: false }, { label: periods[0].label, value: total, on: true }, { label: "Without them", value: total - topSum, on: false }] },
      score: topSum / total - 0.1,
    });
  }

  // the day half the month's money had gone, against the months before
  const curve = (i: number) => {
    const days = diffDays(periods[i].range.from, periods[i].range.to) + 1;
    const daily = Array.from({ length: days }, () => 0);
    for (const e of entries[i]) daily[diffDays(periods[i].range.from, e.t.date)] += e.amount;
    let gone = 0;
    return daily.map((d) => (gone += d) / totals[i]);
  };
  const halfDay = (c: number[]) => c.findIndex((share) => share >= 0.5) + 1;
  const now = curve(0);
  const earlier = periods.map((_, i) => i).slice(1).filter((i) => totals[i] > 0).map(curve);
  if (earlier.length >= 2) {
    const usual = now.map((_, d) => mean(earlier.map((c) => c[Math.min(d, c.length - 1)])));
    const day = halfDay(now), usualDay = halfDay(usual);
    if (Math.abs(day - usualDay) >= 4) {
      const round = (c: number[]) => c.map((s) => Math.round(s * 1000) / 1000);
      out.push({ type: "pace", figures: { day: count(day), usualDay: count(usualDay) }, chart: { kind: "line", now: round(now), usual: round(usual) }, score: Math.abs(day - usualDay) / 30 + 0.05 });
    }
  }

  // a note logged again and again: more often than before, dearer each time, or new
  for (const n of [...notes[0].values()].filter((x) => x.count >= 3).slice(0, 3)) {
    const earlier = notes.slice(1).map((m) => m.get(n.text.toLowerCase()));
    const counts = earlier.map((b) => b?.count ?? 0);
    const usualCount = mean(counts);
    const each = n.amount / n.count;
    const usualEach = sum(counts) ? sum(earlier.map((b) => b?.amount ?? 0)) / sum(counts) : 0;
    const more = n.count >= 1.5 * usualCount && n.count - usualCount >= 2;
    if (!more && !(usualEach > 0 && each >= 1.25 * usualEach)) continue;
    out.push({
      type: "habit", subject: n.text, drill: `n:${n.text}`,
      figures: { count: count(n.count), amount: money(n.amount), each: money(each), ...(Math.round(usualCount) ? { usualCount: count(usualCount) } : {}), ...(usualEach ? { usualEach: money(usualEach) } : {}) },
      chart: bars([n.count, ...counts], "count", (i) => i === 0),
      score: n.amount / total + 0.03,
    });
  }

  // one weekday that took far more than its seventh, on several dates and not on the back of one of them
  const byDay = new Map<string, number>();
  for (const e of entries[0]) byDay.set(e.t.date, (byDay.get(e.t.date) ?? 0) + e.amount);
  const week = Array.from({ length: 7 }, () => ({ amount: 0, dates: 0, most: 0 }));
  for (const [date, amount] of byDay) { const w = week[weekday(date)]; w.amount += amount; w.dates += 1; w.most = Math.max(w.most, amount); }
  const dearest = week.reduce((best, w, i) => (w.amount > week[best].amount ? i : best), 0);
  const w = week[dearest];
  if (entries[0].length >= 15 && w.amount >= total * 0.3 && w.dates >= 3 && w.most <= w.amount * 0.6) {
    const start = settingsOf(snap)?.weekStartDay ?? 0;
    const order = Array.from({ length: 7 }, (_, i) => (i + start) % 7);
    out.push({
      type: "weekday", subject: WEEKDAY_LONG[dearest], figures: { share: pct(w.amount / total), amount: money(w.amount) },
      chart: { kind: "bars", unit: "money", bars: order.map((d) => ({ label: WEEKDAY_SHORT[d], value: week[d].amount, on: d === dearest })) },
      score: w.amount / total - 0.14,
    });
  }

  // a note in each of the three months before, and not in this one: cancelled, or not logged?
  if (P >= 4) {
    const gone = [...notes[1].values()]
      .filter((n) => !notes[0].has(n.text.toLowerCase()) && notes[2].has(n.text.toLowerCase()) && notes[3].has(n.text.toLowerCase()))
      .map((n) => {
        const per = notes.map((m) => m.get(n.text.toLowerCase())?.amount ?? 0);
        let run = 0;
        while (run + 1 < P && per[run + 1] > 0) run++;
        return { text: n.text, per, run, usual: mean(per.slice(1, run + 1)) };
      })
      .sort((a, b) => b.usual - a.usual)[0];
    if (gone && gone.usual >= total * 0.005) {
      out.push({ type: "missing", subject: gone.text, figures: { usual: money(gone.usual), months: count(gone.run) }, chart: bars(gone.per, "money", (i) => i === 0), score: gone.usual / total });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, MAX_FINDINGS);
}
