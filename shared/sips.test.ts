import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, OP_TABLES, restoreRowsFrom, TABLES, txScope, type Snapshot } from "./ops";
import { applyChanges } from "./changes";
import { buildCtx, computeBalances, sumKinds } from "./ledger";
import { ledgerOf, backupExport, statsByCategory } from "./views";
import { isSip, sipDrafts, sipFor, sipKey, sipsInRange, sipsList, sipsOf, sipSuggestions, usualDay } from "./sips";
import { recurringSuggestions } from "./upcoming";

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

function add(s: Snapshot, f: { date: string; note: string; amount: number; accountId: Id<"accounts">; categoryId: Id<"categories">; description?: string }) {
  const r = run(s, "transactions.create", { type: "expense", tags: [], photoIds: [], ...f });
  return { s: r.snap, id: r.result as Id<"transactions"> };
}

/** Monthly payments with this note on the 5th, from `from` (YYYY-MM) for `count` months. */
function monthly(s: Snapshot, note: string, amount: number, months: string[], accountId: Id<"accounts">, categoryId: Id<"categories">) {
  for (const m of months) s = add(s, { date: `${m}-05`, note, amount, accountId, categoryId }).s;
  return s;
}

test("sipKey: case, spacing and reference numbers don't matter", () => {
  expect(sipKey("ACH D- ICCL-2398472")).toBe(sipKey("ach d-  iccl-9938473"));
  expect(sipKey("Groww")).not.toBe(sipKey("Netflix"));
});

test("suggestions: an investment word is enough, even once; rent without one is never a SIP", () => {
  const { s: s0, food, other, bank } = base();
  let s = add(s0, { date: "2026-10-07", note: "Groww", amount: 500000, accountId: bank, categoryId: other }).s;
  s = monthly(s, "Rent", 2500000, ["2026-07", "2026-08", "2026-09", "2026-10"], bank, other);
  s = add(s, { date: "2026-10-09", note: "Swiggy", amount: 45000, accountId: bank, categoryId: food }).s;
  const sug = sipSuggestions(s);
  expect(sug.map((x) => x.name)).toEqual(["Groww"]);
  expect(sug[0].why).toBe("The note reads like a SIP · 1 payment");
});

test("suggestions: a weak word needs payments about a month apart", () => {
  const { s: s0, other, bank } = base();
  let s = add(s0, { date: "2026-10-03", note: "NACH debit", amount: 300000, accountId: bank, categoryId: other }).s;
  expect(sipSuggestions(s)).toEqual([]);
  s = add(s, { date: "2026-11-03", note: "NACH debit", amount: 300000, accountId: bank, categoryId: other }).s;
  const [one] = sipSuggestions(s);
  expect(one.monthly).toBe(true);
  expect(one.day).toBe(3);
  expect(one.why).toBe("The note reads like an investment · 2 payments, monthly around the 3rd");
});

test("suggestions: the mail an entry was read from counts, and two SIPs on one platform are two suggestions", () => {
  const { s: s0, other, bank } = base();
  let s = s0;
  const ids: Id<"transactions">[] = [];
  for (const [date, amount] of [["2026-08-05", 100000], ["2026-08-10", 500000], ["2026-09-05", 100000], ["2026-09-10", 500000]] as const) {
    const r = add(s, { date, note: "Payment", amount, accountId: bank, categoryId: other });
    s = r.s;
    ids.push(r.id);
  }
  // the bank's alert only says "Payment"; the mail it came in with was Groww's
  s = { ...s, drafts: ids.map((id, i) => ({ _id: `d${i}`, transactionId: id, status: "accepted", from: "Groww <noreply@groww.in>", subject: "SIP instalment processed" }) as unknown as Doc<"drafts">) };
  const sug = sipSuggestions(s);
  expect(sug.map((x) => [x.amount, x.entries.length])).toEqual([[500000, 2], [100000, 2]]);
  expect(sug[0].why).toBe("Mail from Groww · 2 payments, monthly around the 10th");
  // the bank's note says nothing, so it is named after who sent the mail
  expect(sug[0].name).toBe("Groww");
});

test("suggestions: a category named for investments counts; dismissed merchants are left out", () => {
  const { s: s0, bank } = base();
  let s = run(s0, "categories.create", { type: "expense", name: "Investments" }).snap;
  const inv = s.categories.find((c) => c.name === "Investments")!._id;
  s = add(s, { date: "2026-10-05", note: "Kotak", amount: 200000, accountId: bank, categoryId: inv }).s;
  expect(sipSuggestions(s)[0].why).toBe("Filed under Investments · 1 payment");
  s = run(s, "settings.update", { patch: { dismissedSips: [sipKey("Kotak")] } }).snap;
  expect(sipSuggestions(s)).toEqual([]);
});

test("sips.create files the payments; they leave spending but still leave the account", () => {
  const { s: s0, other, food, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-08", "2026-09", "2026-10"], bank, other);
  s = add(s, { date: "2026-10-09", note: "Swiggy", amount: 45000, accountId: bank, categoryId: food }).s;
  const [sug] = sipSuggestions(s);
  const r = run(s, "sips.create", { name: "Parag Parikh Flexi Cap", transactionIds: sug.entries.map((t) => t._id) });
  s = r.snap;
  const sip = sipsOf(s)[0];
  expect(sip).toMatchObject({ name: "Parag Parikh Flexi Cap", keys: [sipKey("Groww SIP")], amount: 500000, lastDate: "2026-10-05", accountId: bank });
  expect(s.transactions.filter(isSip)).toHaveLength(3);
  expect(sipSuggestions(s)).toEqual([]);

  const ledger = ledgerOf(s);
  const oct = s.transactions.filter((t) => t.date >= "2026-10-01");
  expect(sumKinds(oct, ledger).expense).toBe(45000);
  expect(statsByCategory(s, "2026-10-01", "2026-10-31", "expense").total).toBe(45000);
  const ctxL = buildCtx(s.accounts, s.accountGroups, { cardExpenseDisplay: "atTime" });
  expect(computeBalances(s.transactions, ctxL).get(bank)).toBe(-(3 * 500000 + 45000));
  // a SIP is not a bill either
  expect(recurringSuggestions(s, "2026-10-20")).toEqual([]);

  const [row] = sipsList(s, "2026-10-01", "2026-10-31");
  expect(row).toMatchObject({ total: 1500000, inRange: 500000, next: "2026-11-05" });
  expect(sipsInRange(s, "2026-10-01", "2026-10-31")).toEqual({ total: 500000, count: 1 });
});

test("a later expense with the SIP's note and about its amount is filed as it is saved; a step-up moves the amount", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi cap", transactionIds: [s.transactions[0]._id] }).snap;
  const sipId = sipsOf(s)[0].id;

  let r = add(s, { date: "2026-10-05", note: "groww  sip", amount: 550000, accountId: bank, categoryId: other });
  s = r.s;
  expect(s.transactions.find((t) => t._id === r.id)!.sipId).toBe(sipId);
  expect(sipsOf(s)[0]).toMatchObject({ amount: 550000, lastDate: "2026-10-05" });

  // a lumpsum far from the usual amount stays in the ledger
  r = add(s, { date: "2026-10-20", note: "Groww SIP", amount: 5000000, accountId: bank, categoryId: other });
  s = r.s;
  expect(s.transactions.find((t) => t._id === r.id)!.sipId).toBeUndefined();

  // an older payment entered late does not move the amount back
  r = add(s, { date: "2026-08-05", note: "Groww SIP", amount: 480000, accountId: bank, categoryId: other });
  s = r.s;
  expect(s.transactions.find((t) => t._id === r.id)!.sipId).toBe(sipId);
  expect(sipsOf(s)[0].amount).toBe(550000);

  // stopped: no new payments
  s = run(s, "sips.update", { id: sipId, stopped: true }).snap;
  r = add(s, { date: "2026-11-05", note: "Groww SIP", amount: 550000, accountId: bank, categoryId: other });
  expect(r.s.transactions.find((t) => t._id === r.id)!.sipId).toBeUndefined();
});

test("every op that writes entries reads the SIPs, so the server files them like the device", () => {
  for (const k of ["transactions.create", "drafts.accept", "drafts.acceptMany", "transactions.importRows", "repeats.catchUp", "repeats.addNext"] as const) {
    expect(OP_TABLES[k]).toContain("settings");
  }
  expect(txScope({ id: "x", kind: "sips.remove", args: { id: "s1" }, at: 0 })).toEqual({ sipIds: ["s1"] });
  expect(txScope({ id: "x", kind: "sips.create", args: { name: "a", transactionIds: ["t1"] }, at: 0 })).toEqual({ ids: ["t1"] });
});

test("sips.mark adds payments and their notes; unmark and remove put entries back in the ledger", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  let r = add(s, { date: "2026-10-05", note: "ACH D- ICCL-1234", amount: 500000, accountId: bank, categoryId: other });
  s = run(r.s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  const sipId = sipsOf(s)[0].id;
  s = run(s, "sips.mark", { id: sipId, transactionIds: [r.id] }).snap;
  expect(sipsOf(s)[0].keys).toEqual([sipKey("Groww SIP"), sipKey("ACH D- ICCL-1234")]);
  // next month's bank narration matches the new key
  r = add(s, { date: "2026-11-05", note: "ACH D- ICCL-9876", amount: 500000, accountId: bank, categoryId: other });
  s = r.s;
  expect(s.transactions.find((t) => t._id === r.id)!.sipId).toBe(sipId);

  s = run(s, "sips.unmark", { ids: [r.id] }).snap;
  expect(s.transactions.find((t) => t._id === r.id)!.sipId).toBeUndefined();
  s = run(s, "sips.remove", { id: sipId }).snap;
  expect(sipsOf(s)).toEqual([]);
  expect(s.transactions.some((t) => t.sipId)).toBe(false);
});

test("only expenses can be SIPs", () => {
  const { s: s0, bank } = base();
  const salary = s0.categories.find((c) => c.name === "Salary")!._id;
  const r = run(s0, "transactions.create", { type: "income", date: "2026-10-01", note: "Salary", amount: 100, accountId: bank, categoryId: salary, tags: [], photoIds: [] });
  expect(() => run(r.snap, "sips.create", { name: "x", transactionIds: [r.result] })).toThrow("Only expenses can be SIPs");
});

test("open drafts a SIP will take are found, so the ledger can leave them out", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  const draft = { _id: "d1", status: "open", proposal: { type: "expense", note: "Groww SIP", amount: 510000, date: "2026-10-05" } } as unknown as Doc<"drafts">;
  s = { ...s, drafts: [draft] };
  expect(sipDrafts(s).get("d1" as Id<"drafts">)?.id).toBe(sipsOf(s)[0].id);
  expect(sipFor(sipsOf(s), { type: "expense", note: "Netflix", amount: 510000 })).toBeUndefined();
});

test("backups keep SIPs and which entries are filed under them", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09", "2026-10"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  const data = JSON.parse(JSON.stringify(backupExport(s)));
  const restored = run(s, "backup.restore", { data }).snap;
  expect(sipsOf(restored)).toHaveLength(1);
  // restored as it was: the October payment the user never filed stays out
  expect(restored.transactions.filter((t) => t.sipId === sipsOf(restored)[0].id).map((t) => t.date)).toEqual(["2026-09-05"]);

  const r = run(s, "backup.restore", { data, entries: false });
  const rows = restoreRowsFrom(data, r.result as never);
  expect(rows.filter((t) => t.sipId === sipsOf(r.snap)[0].id)).toHaveLength(1);
});

test("SIPs live on settings, never in a table of their own: an older app on another device is never sent a table it doesn't know", () => {
  expect(TABLES as readonly string[]).not.toContain("sips");
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  expect(s.settings[0].sips).toHaveLength(1);
  // an older copy (no "sips" key at all) takes the changed settings and entries without trouble
  const older = { ...s0 } as Record<string, unknown>;
  delete older.sips;
  const next = applyChanges(older as Snapshot, { rev: 2, docs: { settings: s.settings, transactions: s.transactions }, deleted: [] });
  expect(next.transactions[0].sipId).toBe(sipsOf(s)[0].id);
});

test("sip ids come from the op, so the device and the server agree on them", () => {
  const { s: s0, other, bank } = base();
  const s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  const op = { id: "op-fixed", kind: "sips.create" as const, args: { name: "Flexi", transactionIds: [s.transactions[0]._id] }, at: 1 };
  const a = applyOp(s, op, ctx);
  const b = applyOp(s, op, ctx);
  expect(a.result).toBe("sip_op-fixed");
  expect(sipsOf(a.snap)).toEqual(sipsOf(b.snap));
});

test("changing the main currency or its decimals rescales what later payments are matched against", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  s = run(s, "settings.changeDecimals", { decimals: 0 }).snap;
  expect(sipsOf(s)[0].amount).toBe(5000);
  // a new payment at the new scale is still filed
  const r = add(s, { date: "2026-10-05", note: "Groww SIP", amount: 5000, accountId: bank, categoryId: other });
  expect(r.s.transactions.find((t) => t._id === r.id)!.sipId).toBe(sipsOf(s)[0].id);
  // a new currency without keeping the data starts over
  s = run(s, "settings.changeMainCurrency", { code: "USD", keepData: false }).snap;
  expect(sipsOf(s)).toEqual([]);
});

test("wiping everything removes the SIPs too", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  s = run(s, "backup.wipeAll", { confirm: "DELETE" }).snap;
  expect(sipsOf(s)).toEqual([]);
  // and nothing new is filed under a SIP that is gone
  const r = add(s, { date: "2026-10-05", note: "Groww SIP", amount: 500000, accountId: bank, categoryId: other });
  expect(r.s.transactions.find((t) => t._id === r.id)!.sipId).toBeUndefined();
});

test("a restored backup's SIPs point at the restored payment method; a backup without SIPs leaves none behind", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  const data = JSON.parse(JSON.stringify(backupExport(s)));
  const restored = run(s, "backup.restore", { data }).snap;
  const newBank = restored.accounts.find((a) => a.kind === "bank")!._id;
  expect(newBank).not.toBe(bank);
  expect(sipsOf(restored)[0]).toMatchObject({ name: "Flexi", accountId: newBank });

  const old = JSON.parse(JSON.stringify(backupExport(s0)));
  expect(sipsOf(run(s, "backup.restore", { data: old }).snap)).toEqual([]);
});

test("a SIP debited on whichever working day it lands (from Gmail) is found, filed, and its next date stays on the usual day", () => {
  const { s: s0, other, bank } = base();
  // the 5th each month, moved by weekends and holidays: Sat 5 Sep → Mon 7, Sun 5 Oct → Mon 6
  const days = ["2026-06-05", "2026-07-06", "2026-08-05", "2026-09-07", "2026-10-06"];
  const draft = (i: number, date: string) => ({
    _id: `d${i}`, _creationTime: i, userId: "u", source: "gmail", messageId: `m${i}`, extraMessageIds: [], threadId: `t${i}`, receivedAt: i,
    from: "Groww <noreply@groww.in>", subject: "SIP instalment processed", confidence: "high", how: "rule", status: "open",
    proposal: { type: "expense", date, amount: 500000, note: "Groww", accountId: bank, categoryId: other },
  }) as unknown as Doc<"drafts">;
  let s: Snapshot = { ...s0, drafts: days.map((d, i) => draft(i, d)) };
  const save = (snap: Snapshot, i: number) => run(snap, "drafts.accept", {
    id: `d${i}`, type: "expense", date: days[i], amount: 500000, note: "Groww", accountId: bank, categoryId: other, tags: [], photoIds: [],
  }).snap;
  for (let i = 0; i < 3; i++) s = save(s, i);
  const [sug] = sipSuggestions(s);
  expect(sug.monthly).toBe(true);
  expect(sug.day).toBe(5);
  s = run(s, "sips.create", { name: "Groww Flexi", transactionIds: sug.entries.map((t) => t._id) }).snap;
  // the later debits, on the 7th and the 6th, are filed as they are saved from Gmail
  s = save(save(s, 3), 4);
  expect(s.transactions.filter(isSip).map((t) => t.date).sort()).toEqual(days);
  // the next one is due around the usual 5th, not a month after the 6th
  const [row] = sipsList(s, "2026-10-01", "2026-10-31");
  expect(row.day).toBe(5);
  expect(row.next).toBe("2026-11-05");
  // and the open draft for it would be filed too, whatever day it lands on
  s = { ...s, drafts: [...s.drafts, draft(9, "2026-11-06")] };
  expect(sipDrafts(s).has("d9" as Id<"drafts">)).toBe(true);
});

test("usualDay: the most common day, a tie going to the earlier one", () => {
  expect(usualDay([5, 6, 5, 7, 6])).toBe(5);
  expect(usualDay([7, 7, 5])).toBe(7);
  expect(usualDay([10])).toBe(10);
});

test("an entry the user took out of a SIP stays out when an unmerge puts it back", () => {
  const { s: s0, other, bank } = base();
  let s = monthly(s0, "Groww SIP", 500000, ["2026-09"], bank, other);
  s = run(s, "sips.create", { name: "Flexi", transactionIds: [s.transactions[0]._id] }).snap;
  // a lump sum the same size, filed on save, then taken out by the user
  let r = add(s, { date: "2026-10-20", note: "Groww SIP", amount: 500000, accountId: bank, categoryId: other });
  const lump = r.id;
  s = run(r.s, "sips.unmark", { ids: [lump] }).snap;
  r = add(s, { date: "2026-10-20", note: "Coffee", amount: 500000, accountId: bank, categoryId: other });
  s = run(r.s, "transactions.merge", { keepId: r.id, removeId: lump }).snap;
  s = run(s, "transactions.unmerge", { id: r.id }).snap;
  const back = s.transactions.find((t) => t._id !== r.id && t.date === "2026-10-20")!;
  expect(back.note).toBe("Groww SIP");
  expect(back.sipId).toBeUndefined();
});
