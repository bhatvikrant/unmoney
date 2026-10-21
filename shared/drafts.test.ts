import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, OP_TABLES, txScope, type Snapshot } from "./ops";
import { draftMatches, draftsRange } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: 1000 + n }, ctx);
}

/** A draft as the sync would insert it (the reducer never makes drafts, only resolves them). */
function draft(id: string, proposal: Partial<Doc<"drafts">["proposal"]> = {}, extra: Partial<Doc<"drafts">> = {}): Doc<"drafts"> {
  return {
    _id: id as Id<"drafts">, _creationTime: 1, userId: ctx.userId, source: "gmail", messageId: `msg-${id}`, extraMessageIds: [], threadId: "t", receivedAt: 1,
    from: "alerts@hdfcbank.net", subject: "Alert", confidence: "high", how: "rule", status: "open",
    proposal: { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", ...proposal }, ...extra,
  };
}

function ledger() {
  const s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const salary = s.categories.find((c) => c.name === "Salary")!._id;
  const [cash, bank] = s.accounts;
  const d = draft("d1", { accountId: cash._id, categoryId: food });
  return { s: { ...s, drafts: [d, draft("d2", { date: "2026-10-19" }), draft("d3", {}, { status: "dismissed" })] }, food, salary, cash, bank, d };
}

const fields = (d: Doc<"drafts">, extra: Record<string, unknown> = {}) => ({ id: d._id, type: d.proposal.type, date: d.proposal.date, amount: d.proposal.amount, note: d.proposal.note, accountId: d.proposal.accountId, categoryId: d.proposal.categoryId, tags: [], photoIds: [], ...extra });

test("saving a draft makes an entry that points back at the mail and closes the draft", () => {
  const { s, d, cash, food } = ledger();
  const r = run(s, "drafts.accept", fields(d, { note: "Swiggy dinner" }));
  const tx = r.snap.transactions.find((t) => t._id === r.result)!;
  expect([tx.type, tx.date, tx.amount, tx.note, tx.accountId, tx.categoryId, tx.source]).toEqual(["expense", "2026-10-18", 48500, "Swiggy dinner", cash._id, food, { app: "gmail", messageId: "msg-d1" }]);
  const after = r.snap.drafts.find((x) => x._id === d._id)!;
  expect([after.status, after.transactionId, after.resolvedAt]).toEqual(["accepted", r.result, r.snap.transactions.length && 1000 + n]);
  // a second save of the same draft is refused, so a retry cannot double the entry
  expect(() => run(r.snap, "drafts.accept", fields(d))).toThrow(/already handled/);
  expect(() => run(s, "drafts.accept", fields(d, { id: "nope" }))).toThrow(/gone/);
});

test("a save is checked like a new entry: method and category must exist and match", () => {
  const { s, d, salary, cash } = ledger();
  expect(() => run(s, "drafts.accept", fields(d, { categoryId: salary }))).toThrow(/Category type/);
  expect(() => run(s, "drafts.accept", fields(d, { categoryId: undefined }))).toThrow(/Pick a category/);
  const gone = run(s, "accounts.remove", { id: cash._id }).snap;
  expect(() => run(gone, "drafts.accept", fields(d))).toThrow(/deleted/);
  expect(() => run(s, "drafts.accept", fields(d, { amount: 12.5 }))).toThrow(/whole number/);
  // nothing was written by the refused saves
  expect(s.transactions.length).toBe(0);
});

test("dismissing closes open drafts and leaves the rest alone", () => {
  const { s } = ledger();
  const r = run(s, "drafts.dismiss", { ids: ["d1", "d3", "missing"] }).snap;
  expect(r.drafts.map((d) => [d._id, d.status, d.resolvedAt])).toEqual([["d1", "dismissed", 1000 + n], ["d2", "open", undefined], ["d3", "dismissed", undefined]]);
  expect(r.transactions.length).toBe(0);
});

test("linking marks an entry the user typed in as the one the mail was about", () => {
  const { s, cash, food, d } = ledger();
  let r = run(s, "transactions.create", { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: cash._id, categoryId: food, tags: [], photoIds: [] });
  const txId = r.result as Id<"transactions">;
  r = run({ ...r.snap, drafts: [{ ...d, matchedTransactionId: txId }, ...r.snap.drafts.slice(1)] }, "drafts.link", { id: d._id, transactionId: txId });
  expect(r.snap.transactions[0].source).toEqual({ app: "gmail", messageId: "msg-d1" });
  const after = r.snap.drafts[0];
  expect([after.status, after.transactionId, after.matchedTransactionId]).toEqual(["accepted", txId, undefined]);
  expect(r.snap.transactions.length).toBe(1);
  expect(() => run(s, "drafts.link", { id: d._id, transactionId: "nope" })).toThrow(/entry is gone/);
  expect(() => run(r.snap, "drafts.link", { id: d._id, transactionId: txId })).toThrow(/already handled/);
});

test("\"no, it's new\" drops the match and the draft is back on the ledger", () => {
  const { s, d } = ledger();
  const snap = { ...s, drafts: [{ ...d, matchedTransactionId: "t1" as Id<"transactions"> }, ...s.drafts.slice(1)] };
  expect(draftsRange(snap, "2026-10-01", "2026-10-31").map((x) => x._id)).toEqual(["d2"]);
  const r = run(snap, "drafts.unmatch", { id: d._id });
  expect(r.snap.drafts[0].matchedTransactionId).toBeUndefined();
  expect(r.snap.drafts[0].keptNew).toBe(true);
  expect(draftsRange(r.snap, "2026-10-01", "2026-10-31").map((x) => x._id)).toEqual(["d2", "d1"]);
  expect(() => run(snap, "drafts.unmatch", { id: "nope" })).toThrow(/draft is gone/);
});

test("an entry typed in after the draft hides its faded row at once, and \"no, it's new\" sticks", () => {
  const { s, cash, food, d } = ledger();
  let r = run(s, "transactions.create", { type: "expense", date: "2026-10-17", amount: 48500, note: "Dinner", accountId: cash._id, categoryId: food, tags: [], photoIds: [] });
  const txId = r.result as Id<"transactions">;
  // d1 is a day from the entry; d2 is two days off and stays on the ledger
  expect([...draftMatches(r.snap)]).toEqual([[d._id, txId]]);
  expect(draftsRange(r.snap, "2026-10-01", "2026-10-31").map((x) => x._id)).toEqual(["d2"]);
  r = run(r.snap, "drafts.unmatch", { id: d._id });
  expect(draftMatches(r.snap).size).toBe(0);
  expect(draftsRange(r.snap, "2026-10-01", "2026-10-31").map((x) => x._id)).toEqual(["d2", "d1"]);
  // the check's own match still counts, even for an entry the replica does not hold
  const stored = { ...s, drafts: [{ ...d, matchedTransactionId: "t9" as Id<"transactions"> }] };
  expect([...draftMatches(stored)]).toEqual([[d._id, "t9"]]);
});

test("a copy of a mail-sourced entry is not itself from the mail, and an edit keeps the link", () => {
  const { s, d, cash, food } = ledger();
  const r = run(s, "drafts.accept", fields(d));
  const copy = run(r.snap, "transactions.copy", { id: r.result as Id<"transactions">, useToday: false });
  expect(copy.snap.transactions.find((t) => t._id === copy.result)!.source).toBeUndefined();
  const edited = run(r.snap, "transactions.update", { id: r.result as Id<"transactions">, type: "expense", date: "2026-10-18", amount: 48600, note: "Swiggy", accountId: cash._id, categoryId: food, tags: [], photoIds: [] });
  expect(edited.snap.transactions[0].source).toEqual({ app: "gmail", messageId: "msg-d1" });
});

test("the ledger sees open, unmatched drafts in its range", () => {
  const { s } = ledger();
  const snap = { ...s, drafts: [...s.drafts, draft("d4", { date: "2026-10-18" }, { matchedTransactionId: "t" as Id<"transactions"> }), draft("d5", { date: "2026-11-01" })] };
  // newest day first, as the ledger lists them
  expect(draftsRange(snap, "2026-10-01", "2026-10-31").map((d) => d._id)).toEqual(["d2", "d1"]);
  expect(draftsRange(snap, "2026-11-01", "2026-11-30").map((d) => d._id)).toEqual(["d5"]);
});

test("the server loads the tables the drafts ops need, and just the linked entry", () => {
  expect(OP_TABLES["drafts.accept"]).toEqual(["drafts", "transactions", "accounts", "categories"]);
  expect(OP_TABLES["drafts.dismiss"]).toEqual(["drafts"]);
  expect(OP_TABLES["drafts.link"]).toEqual(["drafts", "transactions"]);
  expect(OP_TABLES["drafts.unmatch"]).toEqual(["drafts"]);
  expect(txScope({ id: "x", kind: "drafts.link", args: { id: "d1", transactionId: "t9" }, at: 1 })).toEqual({ ids: ["t9"] });
  expect(txScope({ id: "x", kind: "drafts.accept", args: { id: "d1" }, at: 1 })).toEqual({});
});

test("reopening undoes an import or a dismiss, and never deletes an entry a draft was only linked to", () => {
  const { s, d, cash } = ledger();
  const imported = run(s, "drafts.accept", fields(d));
  const txId = imported.result as Id<"transactions">;
  const undone = run(imported.snap, "drafts.reopen", { ids: [d._id], transactionIds: [txId] }).snap;
  expect(undone.transactions.length).toBe(0);
  const back = undone.drafts.find((x) => x._id === d._id)!;
  expect([back.status, back.transactionId, back.resolvedAt]).toEqual(["open", undefined, undefined]);
  expect(txScope({ id: "x", kind: "drafts.reopen", args: { ids: [d._id], transactionIds: [txId] }, at: 1 })).toEqual({ ids: [txId] });
  expect(OP_TABLES["drafts.reopen"]).toEqual(expect.arrayContaining(["drafts", "transactions"]));

  // a linked entry was the user's own: reopening keeps it
  const typed = run(s, "transactions.create", { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: cash._id, categoryId: d.proposal.categoryId, tags: [], photoIds: [] });
  const linked = run(typed.snap, "drafts.link", { id: d._id, transactionId: typed.result }).snap;
  expect(run(linked, "drafts.reopen", { ids: [d._id] }).snap.transactions.length).toBe(1);

  const dismissed = run(s, "drafts.dismiss", { ids: ["d1"] }).snap;
  expect(run(dismissed, "drafts.reopen", { ids: ["d1"] }).snap.drafts.find((x) => x._id === "d1")!.status).toBe("open");
});
