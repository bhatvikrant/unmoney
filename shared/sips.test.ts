import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, OP_TABLES, restoreRowsFrom, TABLES, txScope, type Snapshot } from "./ops";
import { applyChanges } from "./changes";
import { buildCtx, computeBalances, sumKinds } from "./ledger";
import { backupExport, ledgerOf, statsByCategory } from "./views";
import { monthRecap, recapDrill, recapText } from "./recap";
import {
  gmailPayments, isSip, lateBy, newSipOf, onePerPayment, ordinal, perMonth, rhythmOf, schedulesOf, similarPayments, sipArgs, sipDrafts, sipFor, sipKey, sipsInRange, sipsList, sipsOf,
  sipSuggestions, usualDay,
} from "./sips";
import { recurringSuggestions } from "./upcoming";
import { addDays, make, weekday } from "./dates";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

function base() {
  const s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const other = s.categories.find((c) => c.name === "Other" && c.type === "expense")!._id;
  const bank = s.accounts.find((a) => a.kind === "bank")!._id;
  return { s, food, other, bank };
}

type MailOpts = { from?: string; subject?: string; status?: "open" | "dismissed"; account?: Id<"accounts"> | null; matched?: Id<"transactions"> };
let m = 0;
/** A draft Gmail made for a debit: waiting (or dismissed), with the bank account the mail named. */
function draft(s: Snapshot, date: string, note: string, amount: number, bank: Id<"accounts">, o: MailOpts = {}): { s: Snapshot; id: Id<"drafts"> } {
  const id = `d${++m}` as Id<"drafts">;
  const d = {
    _id: id, _creationTime: m, userId: "u", source: "gmail", messageId: `msg${m}`, extraMessageIds: [], threadId: `t${m}`, receivedAt: m,
    from: o.from ?? "HDFC Bank <alerts@hdfcbank.net>", subject: o.subject ?? "Debit alert", confidence: "high", how: "rule", status: o.status ?? "open",
    matchedTransactionId: o.matched,
    proposal: { type: "expense", date, amount, note, accountId: o.account === null ? undefined : o.account ?? bank },
  } as unknown as Doc<"drafts">;
  return { s: { ...s, drafts: [...s.drafts, d] }, id };
}
/** A debit Gmail read and the user saved: an entry with `source` pointing at its mail. */
function gmailEntry(s: Snapshot, date: string, note: string, amount: number, bank: Id<"accounts">, categoryId: Id<"categories">, o: MailOpts = {}) {
  const d = draft(s, date, note, amount, bank, o);
  const r = run(d.s, "drafts.accept", { id: d.id, type: "expense", date, amount, note, accountId: bank, categoryId, tags: [], photoIds: [] });
  return { s: r.snap, id: r.result as Id<"transactions"> };
}
const typed = (s: Snapshot, date: string, note: string, amount: number, accountId: Id<"accounts">, categoryId: Id<"categories">) => {
  const r = run(s, "transactions.create", { type: "expense", date, note, amount, accountId, categoryId, tags: [], photoIds: [] });
  return { s: r.snap, id: r.result as Id<"transactions"> };
};
const GROWW = { from: "Groww <noreply@groww.in>", subject: "SIP instalment processed" };

// ---------- rhythm ----------

test("rhythmOf: monthly with debits a few days off, weekly, fortnightly, quarterly", () => {
  expect(rhythmOf(["2026-09-08", "2026-10-10"])).toBe("monthly");
  expect(rhythmOf(["2026-06-05", "2026-07-06", "2026-08-05", "2026-09-07", "2026-10-06"])).toBe("monthly");
  expect(rhythmOf(["2026-09-01", "2026-09-08", "2026-09-16", "2026-09-22"])).toBe("weekly");
  expect(rhythmOf(Array.from({ length: 10 }, (_, i) => addDays("2026-07-06", 14 * i)))).toBe("fortnightly");
  expect(rhythmOf(["2026-01-10", "2026-04-09", "2026-07-12"])).toBe("quarterly");
});

/** The day a SIP due on `day` of each month goes out: the next working day when it falls on a weekend. */
function debits(day: number, from: [number, number], months: number): string[] {
  return Array.from({ length: months }, (_, i) => {
    const total = from[0] * 12 + from[1] - 1 + i;
    let d = make(Math.floor(total / 12), (total % 12) + 1, day);
    while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
    return d;
  });
}
const sorted = (...lists: string[][]) => lists.flat().sort();

test("lateBy: how far a debit went out from its day of the month, across a month's end", () => {
  expect(lateBy(7, "2026-06-08")).toBe(1);
  expect(lateBy(28, "2026-03-30")).toBe(2);
  expect(lateBy(28, "2026-03-02")).toBe(2); // Sat 28 Feb went out on Mon 2 Mar
  expect(lateBy(31, "2026-09-30")).toBe(0);
  expect(lateBy(7, "2026-06-14")).toBeNull();
});

test("schedulesOf: SIPs on the 7th, 14th, 21st and 28th of every month are four monthly SIPs, not one weekly one", () => {
  // the recording: Mirae, ₹2,500, Mar–Oct 2026, a weekend's debit on the Monday after (Jun 8, Mar 30)
  const days = [7, 14, 21, 28];
  const dates = sorted(...days.map((d) => debits(d, [2026, 3], 8)));
  expect(dates).toContain("2026-06-08");
  expect(dates).toContain("2026-03-30");
  const got = schedulesOf(dates);
  expect(got.map((s) => [s.rhythm, s.day, s.dates.length])).toEqual(days.map((d) => ["monthly", d, 8]));
  expect(got.flatMap((s) => s.dates).sort()).toEqual(dates);
  // two months of it is already four
  expect(schedulesOf(sorted(...days.map((d) => debits(d, [2026, 9], 2)))).map((s) => s.day)).toEqual(days);
});

test("schedulesOf: two days a month are two SIPs; three months of one day is one", () => {
  expect(schedulesOf(["2026-08-05", "2026-08-25", "2026-09-05", "2026-09-25", "2026-10-06"]).map((s) => [s.rhythm, s.day, s.dates.length])).toEqual([["monthly", 5, 3], ["monthly", 25, 2]]);
  expect(schedulesOf(["2026-06-05", "2026-07-06", "2026-08-05", "2026-09-07", "2026-10-06"]).map((s) => [s.rhythm, s.day])).toEqual([["monthly", 5]]);
  // each day once: the earliest, as a debit only ever goes out later
  expect(schedulesOf(["2026-01-10", "2026-04-09", "2026-07-12"]).map((s) => [s.rhythm, s.day])).toEqual([["quarterly", 9]]);
});

test("schedulesOf: a real weekly or two-weekly SIP keeps its weekday through the month and stays one SIP", () => {
  // every Monday, Mar–Oct, two of them a day late (a holiday)
  const mondays = Array.from({ length: 35 }, (_, i) => addDays("2026-03-02", 7 * i)).map((d, i) => (i === 9 || i === 20 ? addDays(d, 1) : d));
  expect(schedulesOf(mondays)).toEqual([{ rhythm: "weekly", dates: mondays }]);
  const short = ["2026-09-01", "2026-09-08", "2026-09-16", "2026-09-22"];
  expect(schedulesOf(short)).toEqual([{ rhythm: "weekly", dates: short }]);
  const fortnights = Array.from({ length: 10 }, (_, i) => addDays("2026-07-06", 14 * i));
  expect(schedulesOf(fortnights)).toEqual([{ rhythm: "fortnightly", dates: fortnights }]);
  // a pause doesn't hand it to the days of the month
  const paused = [...mondays.slice(0, 8), ...mondays.slice(20)];
  expect(schedulesOf(paused).map((s) => s.rhythm)).toEqual(["weekly"]);
});

test("schedulesOf: a SIP whose date was changed (the 5th, then the 12th) is one SIP, on the new day; nothing repeating is none", () => {
  const moved = [...debits(5, [2026, 1], 5), ...debits(12, [2026, 7], 4)];
  expect(schedulesOf(moved).map((s) => [s.rhythm, s.day, s.dates.length])).toEqual([["monthly", 12, 9]]);
  expect(schedulesOf(["2026-09-08"])).toEqual([]);
  expect(schedulesOf(["2026-01-03", "2026-02-19", "2026-05-02"])).toEqual([]);
});

test("rhythmOf: nothing from one payment, two months apart, or no pattern", () => {
  expect(rhythmOf(["2026-09-08"])).toBeNull();
  expect(rhythmOf(["2026-08-08", "2026-10-08"])).toBeNull();
  expect(rhythmOf(["2026-01-03", "2026-02-19", "2026-05-02"])).toBeNull();
});

test("rhythmOf: a SIP paused for months is still a SIP; a missed instalment doesn't break it", () => {
  const twoYears = Array.from({ length: 24 }, (_, i) => `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-10`);
  expect(rhythmOf([...twoYears, "2025-07-10", "2025-08-11"])).toBe("monthly");
  expect(rhythmOf(["2026-05-05", "2026-06-05", "2026-08-05", "2026-09-05"])).toBe("monthly");
});

test("usualDay: the most common day, a tie going to the earlier one", () => {
  expect(usualDay([5, 6, 5, 7, 6])).toBe(5);
  expect(usualDay([7, 7, 5])).toBe(7);
});

// ---------- detection: Gmail only ----------

test("only what Gmail read is a SIP candidate: entries typed by hand never are", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  for (const d of ["2026-08-10", "2026-09-10", "2026-10-10"]) s = typed(s, d, "Groww", 1000000, bank, other).s;
  expect(gmailPayments(s)).toEqual([]);
  expect(sipSuggestions(s)).toEqual([]);
});

test("Gmail entries, waiting drafts and dismissed drafts of one name and amount on a rhythm are one suggestion", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-07-10", "Groww", 1000000, bank, other, GROWW).s;
  s = draft(s, "2026-08-08", "Groww", 1000000, bank, { ...GROWW, status: "dismissed" }).s;
  s = draft(s, "2026-09-10", "Groww", 1000000, bank, GROWW).s;
  s = draft(s, "2026-10-12", "Groww", 1000000, bank, GROWW).s;
  const [sug, ...more] = sipSuggestions(s);
  expect(more).toEqual([]);
  expect(sug).toMatchObject({ name: "Groww", amount: 1000000, rhythm: "monthly", likely: true });
  expect(sug.payments.map((p) => p.date)).toEqual(["2026-10-12", "2026-09-10", "2026-08-08", "2026-07-10"]);
  expect(sug.transactionIds).toHaveLength(1);
  expect(sug.draftIds).toHaveLength(3);
  expect(sug.why).toBe("Mail from Groww · 4 payments, monthly around the 10th, since Jul 2026");
});

test("the amount has to match exactly to be suggested together; two SIPs on one platform are two", () => {
  const { s: s0, bank } = base();
  let s = s0;
  for (const d of ["2026-08-05", "2026-09-05", "2026-10-05"]) s = draft(s, d, "Groww", 500000, bank, GROWW).s;
  for (const d of ["2026-08-20", "2026-09-21", "2026-10-20"]) s = draft(s, d, "Groww", 200000, bank, GROWW).s;
  s = draft(s, "2026-10-25", "Groww", 520000, bank, GROWW).s; // a one-off near the first: on its own
  expect(sipSuggestions(s).map((x) => [x.amount, x.payments.length])).toEqual([[500000, 3], [200000, 3]]);
});

test("likely when the mail reads like an investment; other regular debits are only 'maybe', after them", () => {
  const { s: s0, bank } = base();
  let s = s0;
  for (const d of ["2026-08-01", "2026-09-01", "2026-10-01"]) s = draft(s, d, "Rent", 2500000, bank).s;
  for (const d of ["2026-09-05", "2026-10-06"]) s = draft(s, d, "Payment", 300000, bank, { from: "CAMS <donotreply@camsonline.com>", subject: "SIP Purchase - Mirae Asset" }).s;
  const sug = sipSuggestions(s);
  expect(sug.map((x) => [x.name, x.likely])).toEqual([["CAMS", true], ["Rent", false]]);
});

test("the bank alert and the fund's mail for one debit count once", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-10", "Groww", 1000000, bank, other).s;
  s = draft(s, "2026-09-11", "Groww", 1000000, bank, { ...GROWW, status: "dismissed" }).s;
  s = draft(s, "2026-10-10", "Groww", 1000000, bank, GROWW).s;
  const [sug] = sipSuggestions(s);
  expect(sug.payments.map((p) => [p.date, !!p.entry])).toEqual([["2026-10-10", false], ["2026-09-10", true]]);
  expect(onePerPayment(gmailPayments(s))).toHaveLength(2);
});

test("names the user said are not SIPs are not suggested again", () => {
  const { s: s0, bank } = base();
  let s = s0;
  for (const d of ["2026-09-01", "2026-10-01"]) s = draft(s, d, "Rent", 2500000, bank).s;
  s = run(s, "settings.update", { patch: { dismissedSips: [sipKey("Rent")] } }).snap;
  expect(sipSuggestions(s)).toEqual([]);
});

// ---------- accepting ----------

test("accepting files the Gmail entries and saves the drafts (waiting and dismissed) into the SIP, under Investments, on the bank the mail named", () => {
  const { s: s0, other, food, bank } = base();
  const savings = run(s0, "accounts.create", { name: "Savings", kind: "bank", initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false });
  let s = savings.snap;
  const sav = savings.result as Id<"accounts">;
  s = gmailEntry(s, "2026-07-10", "Groww", 1000000, bank, other, GROWW).s;
  s = draft(s, "2026-08-08", "Groww", 1000000, bank, { ...GROWW, status: "dismissed" }).s;
  s = draft(s, "2026-09-10", "Groww", 1000000, sav, GROWW).s;
  s = draft(s, "2026-10-12", "Groww", 1000000, bank, { ...GROWW, account: null }).s; // the mail named no account: the SIP's
  s = typed(s, "2026-10-12", "Swiggy", 45000, bank, food).s;
  const [sug] = sipSuggestions(s);
  const r = run(s, "sips.create", { name: sug.name, transactionIds: sug.transactionIds, draftIds: sug.draftIds, draftDates: sug.draftDates, rhythm: sug.rhythm });
  s = r.snap;
  const sip = sipsOf(s)[0];
  expect(sip).toMatchObject({ id: r.result, name: "Groww", rhythm: "monthly", amount: 1000000, lastDate: "2026-10-12", accountId: bank });
  const paid = s.transactions.filter(isSip).sort((a, b) => a.date.localeCompare(b.date));
  expect(paid.map((t) => [t.date, t.accountId === sav ? "savings" : "bank"])).toEqual([["2026-07-10", "bank"], ["2026-08-08", "bank"], ["2026-09-10", "savings"], ["2026-10-12", "bank"]]);
  const investments = s.categories.find((c) => c.name === "Investments")!;
  expect(paid.slice(1).every((t) => t.categoryId === investments._id && t.source?.app === "gmail")).toBe(true);
  expect(s.drafts.every((d) => d.status === "accepted")).toBe(true);
  expect(sipSuggestions(s)).toEqual([]);
  // out of spending, still out of the bank
  const oct = s.transactions.filter((t) => t.date >= "2026-10-01");
  expect(sumKinds(oct, ledgerOf(s)).expense).toBe(45000);
  expect(statsByCategory(s, "2026-10-01", "2026-10-31", "expense").total).toBe(45000);
  expect(computeBalances(s.transactions, buildCtx(s.accounts, s.accountGroups, { cardExpenseDisplay: "atTime" })).get(bank)).toBe(-(3 * 1000000 + 45000));
  expect(recurringSuggestions(s, "2026-10-20")).toEqual([]);
});

test("a draft flagged as an entry already typed, or with an entry already saved for it, is never saved twice", () => {
  const { s: s0, other, bank } = base();
  let s = typed(s0, "2026-09-10", "Groww", 1000000, bank, other).s; // typed by hand
  const typedId = s.transactions[0]._id;
  s = gmailEntry(s, "2026-08-10", "Groww", 1000000, bank, other, GROWW).s;
  const flagged = draft(s, "2026-09-10", "Groww", 1000000, bank, { ...GROWW, matched: typedId });
  s = flagged.s;
  const late = draft(s, "2026-10-10", "Groww", 1000000, bank, GROWW);
  s = late.s;
  s = typed(s, "2026-10-11", "Groww", 1000000, bank, other).s; // and this one too, a day later
  s = run(s, "sips.create", { name: "Groww", transactionIds: [s.transactions.find((t) => t.date === "2026-08-10")!._id], draftIds: [flagged.id, late.id], draftDates: ["2026-09-10", "2026-10-10"] }).snap;
  expect(s.transactions.filter((t) => t.amount === 1000000)).toHaveLength(3);
  expect(s.drafts.find((d) => d._id === flagged.id)!.status).toBe("open");
  expect(s.drafts.find((d) => d._id === late.id)!.status).toBe("open");
});

test("typed entries are never filed, even when they match a SIP; Gmail ones are, on whichever working day", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 1000000, bank, other, GROWW).s;
  s = run(s, "sips.create", { name: "Groww", transactionIds: [s.transactions[0]._id] }).snap;
  let r = typed(s, "2026-10-05", "Groww", 1000000, bank, other);
  expect(r.s.transactions.find((t) => t._id === r.id)!.sipId).toBeUndefined();
  r = gmailEntry(s, "2026-10-07", "Groww", 1050000, bank, other, GROWW);
  expect(r.s.transactions.find((t) => t._id === r.id)!.sipId).toBe(sipsOf(s)[0].id);
  expect(sipsOf(r.s)[0]).toMatchObject({ amount: 1050000, lastDate: "2026-10-07" });
});

test("sips.saveDrafts saves new debits of a running SIP as they arrive; others stay waiting", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 1000000, bank, other, GROWW).s;
  s = run(s, "sips.create", { name: "Groww", transactionIds: [s.transactions[0]._id] }).snap;
  const sipDraft = draft(s, "2026-10-06", "Groww", 1000000, bank, GROWW);
  const swiggy = draft(sipDraft.s, "2026-10-06", "Swiggy", 45000, bank);
  s = swiggy.s;
  expect(sipDrafts(s).has(sipDraft.id)).toBe(true);
  const r = run(s, "sips.saveDrafts", { draftIds: [sipDraft.id, swiggy.id], draftDates: ["2026-10-06", "2026-10-06"] });
  expect(r.result).toBe(1);
  expect(r.snap.drafts.find((d) => d._id === sipDraft.id)!.status).toBe("accepted");
  expect(r.snap.drafts.find((d) => d._id === swiggy.id)!.status).toBe("open");
  expect(sipDrafts(r.snap).size).toBe(0);
});

test("the server loads what saving drafts needs", () => {
  for (const k of ["sips.create", "sips.mark", "sips.saveDrafts"] as const) expect(OP_TABLES[k]).toEqual(expect.arrayContaining(["settings", "transactions", "drafts", "categories", "accounts"]));
  for (const k of ["transactions.create", "drafts.accept", "drafts.acceptMany", "transactions.importRows", "repeats.catchUp"] as const) expect(OP_TABLES[k]).toContain("settings");
  expect(txScope({ id: "x", kind: "sips.saveDrafts", args: { draftIds: ["d1"], draftDates: ["2026-10-06"] }, at: 0 })).toEqual({ dates: ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"] });
  expect(txScope({ id: "x", kind: "sips.remove", args: { id: "s1" }, at: 0 })).toEqual({ sipIds: ["s1"] });
});

// ---------- pause, cancel, resume ----------

test("a SIP with no debit for a while reads as paused, nothing changes, and the next debit goes straight in", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  for (const d of ["2026-03-10", "2026-04-10", "2026-05-11"]) s = gmailEntry(s, d, "Groww", 1000000, bank, other, GROWW).s;
  s = run(s, "sips.create", { name: "Groww", transactionIds: s.transactions.map((t) => t._id), rhythm: "monthly" }).snap;
  expect(sipsList(s, "2026-05-01", "2026-05-31", "2026-06-12")[0]).toMatchObject({ status: "running", next: "2026-06-10" });
  const [paused] = sipsList(s, "2026-11-01", "2026-11-30", "2026-11-02");
  expect(paused.status).toBe("paused");
  expect(perMonth([paused])).toBe(0);
  s = gmailEntry(s, "2026-11-10", "Groww", 1000000, bank, other, GROWW).s;
  expect(sipsList(s, "2026-11-01", "2026-11-30", "2026-11-12")[0]).toMatchObject({ status: "running", next: "2026-12-10" });
  expect(s.transactions.filter(isSip)).toHaveLength(4);
});

test("a cancelled SIP keeps its payments and takes no new ones; if debits come again it is offered back to resume", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  for (const d of ["2026-04-10", "2026-05-10"]) s = gmailEntry(s, d, "Groww", 1000000, bank, other, GROWW).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: s.transactions.map((t) => t._id) }).snap;
  const id = sipsOf(s)[0].id;
  s = run(s, "sips.update", { id, stopped: true }).snap;
  expect(sipsList(s, "2026-05-01", "2026-05-31", "2026-11-02")[0].status).toBe("cancelled");
  const back = draft(s, "2026-11-10", "Groww", 1000000, bank, GROWW);
  s = back.s;
  expect(sipFor(sipsOf(s), back.s.drafts.at(-1)!.proposal)).toBeUndefined();
  const [sug] = sipSuggestions(s);
  expect(sug.sip?.id).toBe(id);
  expect(sug.why).toMatch(/^Flexi is marked cancelled, but payments came again/);
  s = run(s, "sips.mark", { id, transactionIds: [], draftIds: sug.draftIds, draftDates: sug.draftDates, resume: true }).snap;
  expect(sipsOf(s)[0].stoppedAt).toBeUndefined();
  expect(s.transactions.filter((t) => t.sipId === id)).toHaveLength(3);
});

test("every month: what the running SIPs put in, by rhythm", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  for (const d of ["2026-10-01", "2026-10-08"]) s = gmailEntry(s, d, "Kuvera", 100000, bank, other).s;
  s = run(s, "sips.create", { name: "Weekly", transactionIds: s.transactions.map((t) => t._id), rhythm: "weekly" }).snap;
  expect(perMonth(sipsList(s, "2026-10-01", "2026-10-31", "2026-10-10"))).toBe(Math.round(100000 * 52 / 12));
});

// ---------- mark as SIP ----------

test("Mark as SIP lists every Gmail payment with the same name and amount; typed ones, other amounts and flagged drafts are left out", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-10-10", "Groww", 1000000, bank, other).s;
  const picked = s.transactions[0];
  s = gmailEntry(s, "2026-09-09", "Groww", 1000000, bank, other).s;
  s = draft(s, "2026-08-10", "Groww", 1000000, bank, { status: "dismissed" }).s;
  s = draft(s, "2025-08-10", "groww", 1000000, bank).s;
  s = gmailEntry(s, "2026-07-10", "Groww", 1100000, bank, other).s; // another amount
  s = typed(s, "2026-06-10", "Groww", 1000000, bank, other).s; // typed
  s = draft(s, "2026-06-11", "Groww", 1000000, bank, { matched: s.transactions.at(-1)!._id }).s; // flagged
  const list = similarPayments(s, [picked]);
  expect(list.map((p) => p.date)).toEqual(["2026-10-10", "2026-09-09", "2026-08-10", "2025-08-10"]);
  const args = sipArgs(list);
  s = run(s, "sips.create", { name: "Flexi", ...args }).snap;
  expect(s.transactions.filter(isSip)).toHaveLength(4);
});

test("SIPs on four days of the month: four suggestions named by day; each accepted one takes only its day's debits, now and later", () => {
  const { s: s0, bank } = base();
  let s = s0;
  const MIRAE = { from: "Mirae Asset Mutual Fund <mf@miraeasset.com>", subject: "SIP instalment processed" };
  const days = [7, 14, 21, 28];
  for (const d of sorted(...days.map((x) => debits(x, [2026, 3], 8)))) s = draft(s, d, "Mirae Asset Mutual Fund", 250000, bank, MIRAE).s;
  const sug = sipSuggestions(s);
  expect(sug.map((x) => [x.name, x.rhythm, x.day, x.payments.length])).toEqual(days.map((d) => [`Mirae Asset Mutual Fund · ${ordinal(d)}`, "monthly", d, 8]));
  expect(sug[0].why).toContain("monthly around the 7th");

  // Review from a suggestion, or Mark as SIP on one payment: only that day's payments
  const fourteenth = sug[1];
  expect(similarPayments(s, [{ note: fourteenth.payments[0].note, amount: 250000, date: fourteenth.payments[0].date }]).map((p) => p.date)).toEqual(fourteenth.payments.map((p) => p.date));
  expect(newSipOf(s, fourteenth.payments)).toEqual({ name: "Mirae Asset Mutual Fund · 14th", rhythm: "monthly", day: 14 });

  const seventh = sug[0];
  s = run(s, "sips.create", { name: seventh.name, transactionIds: [], draftIds: seventh.draftIds, draftDates: seventh.draftDates, rhythm: seventh.rhythm, day: seventh.day }).snap;
  const sip = sipsOf(s)[0];
  expect(sip.day).toBe(7);
  expect(s.transactions.filter((t) => t.sipId === sip.id).map((t) => t.date)).toEqual(seventh.payments.map((p) => p.date).reverse());
  // the other three are still offered, still named by day
  expect(sipSuggestions(s).map((x) => [x.name, x.payments.length])).toEqual([14, 21, 28].map((d) => [`Mirae Asset Mutual Fund · ${ordinal(d)}`, 8]));

  // November: Sat 7th goes out Mon 9th and is saved into the 7th's SIP; Sat 14th (Mon 16th) is not
  const nov9 = draft(s, "2026-11-09", "Mirae Asset Mutual Fund", 250000, bank, MIRAE);
  const nov16 = draft(nov9.s, "2026-11-16", "Mirae Asset Mutual Fund", 250000, bank, MIRAE);
  s = run(nov16.s, "sips.saveDrafts", { draftIds: [nov9.id, nov16.id], draftDates: ["2026-11-09", "2026-11-16"] }).snap;
  expect(s.drafts.find((d) => d._id === nov9.id)!.status).toBe("accepted");
  expect(s.transactions.find((t) => t._id === s.drafts.find((d) => d._id === nov9.id)!.transactionId)!.sipId).toBe(sip.id);
  expect(s.drafts.find((d) => d._id === nov16.id)!.status).toBe("open");
  expect(sipFor(sipsOf(s), { type: "expense", note: "Mirae Asset Mutual Fund", amount: 250000, date: "2026-11-16" })).toBeUndefined();
  expect(sipSuggestions(s).find((x) => x.day === 14)!.payments).toHaveLength(9);

  // "Not a SIP" on the 28th's leaves the 14th's and the 21st's
  const not28 = sipSuggestions(s).find((x) => x.day === 28)!;
  s = run(s, "settings.update", { patch: { dismissedSips: [not28.key] } }).snap;
  expect(sipSuggestions(s).map((x) => x.day)).toEqual([14, 21]);
});

test("a SIP saved before days of the month were read keeps taking its debits on any day", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  for (const d of ["2026-09-10", "2026-10-10"]) s = gmailEntry(s, d, "Groww", 1000000, bank, other, GROWW).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: s.transactions.map((t) => t._id), rhythm: "monthly" }).snap;
  expect(sipsOf(s)[0].day).toBeUndefined();
  expect(sipFor(sipsOf(s), { type: "expense", note: "Groww", amount: 1000000, date: "2026-11-23" })?.name).toBe("Flexi");
  expect(() => run(s, "sips.create", { name: "X", transactionIds: [s.transactions[0]._id], day: 32 })).toThrow("Bad day");
});

// ---------- recaps ----------

test("recaps: an Invested card for the month with each SIP, kept out of spending, and on the closer", () => {
  const { s: s0, other, food, bank } = base();
  let s = s0;
  for (const d of ["2026-09-05", "2026-10-06"]) s = gmailEntry(s, d, "Groww", 1000000, bank, other, GROWW).s;
  for (const d of ["2026-09-20", "2026-10-20"]) s = gmailEntry(s, d, "Kuvera", 200000, bank, other).s;
  for (let i = 1; i <= 6; i++) s = typed(s, `2026-10-${String(i + 10).padStart(2, "0")}`, "Lunch", 30000, bank, food).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: s.transactions.filter((t) => t.note === "Groww").map((t) => t._id) }).snap;
  s = run(s, "sips.create", { name: "Index", transactionIds: s.transactions.filter((t) => t.note === "Kuvera").map((t) => t._id) }).snap;
  const recap = monthRecap(s, "2026-10")!;
  const card = recap.cards.find((c) => c.kind === "invested");
  expect(card).toMatchObject({ kind: "invested", total: 1200000, count: 2, prev: 1200000, prevLabel: "September", sips: [{ name: "Flexi", amount: 1000000, count: 1 }, { name: "Index", amount: 200000, count: 1 }] });
  const total = recap.cards.find((c) => c.kind === "total");
  expect(total).toMatchObject({ amount: 180000 });
  const closer = recap.cards.find((c) => c.kind === "closer");
  expect(closer && closer.kind === "closer" && closer.summary.invested).toBe(1200000);
  expect(recapDrill(s, recap.range, { kind: "sip", id: sipsOf(s)[0].id }).amount).toBe(1000000);
  expect(recapDrill(s, recap.range, { kind: "sip" }).txs).toHaveLength(2);
  expect(recapText((closer as { summary: Parameters<typeof recapText>[0] }).summary, "October 2026", (x) => `₹${x / 100}`)).toContain("Invested ₹12000");
  expect(sipsInRange(s, "2026-10-01", "2026-10-31").bySip.map((b) => b.name)).toEqual(["Flexi", "Index"]);
});

// ---------- the rest of the app ----------

test("SIPs live on settings, never in a table of their own: an older app on another device is never sent a table it doesn't know", () => {
  expect(TABLES as readonly string[]).not.toContain("sips");
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 1000000, bank, other).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  const next = applyChanges(s0, { rev: 2, docs: { settings: s.settings, transactions: s.transactions }, deleted: [] });
  expect(next.transactions[0].sipId).toBe(sipsOf(s)[0].id);
});

test("sip ids come from the op, so the device and the server agree on them", () => {
  const { s: s0, other, bank } = base();
  const s = gmailEntry(s0, "2026-09-05", "Groww", 1000000, bank, other).s;
  const op = { id: "op-fixed", kind: "sips.create" as const, args: { name: "Flexi", transactionIds: [s.transactions[0]._id] }, at: 1 };
  expect(applyOp(s, op, ctx).result).toBe("sip_op-fixed");
  expect(sipsOf(applyOp(s, op, ctx).snap)).toEqual(sipsOf(applyOp(s, op, ctx).snap));
});

test("unmark and remove put entries back in the ledger", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 1000000, bank, other).s;
  s = gmailEntry(s, "2026-10-05", "Groww", 1000000, bank, other).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: s.transactions.map((t) => t._id) }).snap;
  const id = sipsOf(s)[0].id;
  s = run(s, "sips.unmark", { ids: [s.transactions[1]._id] }).snap;
  expect(s.transactions.filter(isSip)).toHaveLength(1);
  s = run(s, "sips.remove", { id }).snap;
  expect(sipsOf(s)).toEqual([]);
  expect(s.transactions.some((t) => t.sipId)).toBe(false);
});

test("changing decimals rescales SIP amounts; a currency reset or a wipe drops the SIPs", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 500000, bank, other).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  expect(sipsOf(run(s, "settings.changeDecimals", { decimals: 0 }).snap)[0].amount).toBe(5000);
  expect(sipsOf(run(s, "settings.changeMainCurrency", { code: "USD", keepData: false }).snap)).toEqual([]);
  expect(sipsOf(run(s, "backup.wipeAll", { confirm: "DELETE" }).snap)).toEqual([]);
});

test("backups keep SIPs and which entries are filed under them; restored SIPs point at the restored bank", () => {
  const { s: s0, other, bank } = base();
  let s = gmailEntry(s0, "2026-09-05", "Groww", 500000, bank, other).s;
  s = gmailEntry(s, "2026-10-05", "Groww", 500000, bank, other).s;
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  s = run(s, "sips.unmark", { ids: [] }).snap;
  const data = JSON.parse(JSON.stringify(backupExport(s)));
  const restored = run(s, "backup.restore", { data }).snap;
  expect(sipsOf(restored)[0]).toMatchObject({ name: "Flexi", accountId: restored.accounts.find((a) => a.kind === "bank")!._id });
  expect(restored.transactions.filter((t) => t.sipId).map((t) => t.date)).toEqual(["2026-09-05"]);
  const r = run(s, "backup.restore", { data, entries: false });
  expect(restoreRowsFrom(data, r.result as never).filter((t) => t.sipId === sipsOf(r.snap)[0].id)).toHaveLength(1);
});
