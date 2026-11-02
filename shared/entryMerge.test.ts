import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, OP_TABLES, txScope, type MergeRecord, type Snapshot } from "./ops";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: 1000 + n }, ctx).snap;

function draft(id: string, proposal: Partial<Doc<"drafts">["proposal"]> = {}, extra: Partial<Doc<"drafts">> = {}): Doc<"drafts"> {
  return {
    _id: id as Id<"drafts">, _creationTime: 1, userId: ctx.userId, source: "gmail", messageId: `msg-${id}`, extraMessageIds: [], threadId: "t", receivedAt: 1,
    from: "alerts@hdfcbank.net", subject: "Alert", confidence: "high", how: "rule", status: "open",
    proposal: { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", ...proposal }, ...extra,
  };
}

function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const transport = s.categories.find((c) => c.name === "Transport")!._id;
  const [cash, bank] = s.accounts.map((a) => a._id);
  const tx = (t: Record<string, unknown>) => { s = run(s, "transactions.create", { type: "expense", date: "2026-10-18", accountId: cash, categoryId: food, amount: 48000, note: "", tags: [], photoIds: [], ...t }); return s.transactions.at(-1)!._id; };
  const typed = tx({ note: "Dinner", tags: ["friends"], photoIds: ["p1"] });
  const imported = tx({ accountId: bank, amount: 48500, description: "HDFC alert", tags: ["friends", "card"], photoIds: ["p2"] });
  s = run(s, "bookmarks.create", { template: { type: "expense", accountId: bank, categoryId: food, amount: 48500, note: "", tags: [] }, transactionId: imported });
  return { s, food, transport, cash, bank, typed, imported };
}

test("merging two entries keeps one, with what the other adds, and points everything at it", () => {
  const { s, typed, imported, cash } = ledger();
  const withMail = { ...s, transactions: s.transactions.map((t) => (t._id === imported ? { ...t, source: { app: "gmail" as const, messageId: "m1" } } : t)), drafts: [draft("d1", {}, { status: "accepted", transactionId: imported })] };
  const m = run(withMail, "transactions.merge", { keepId: typed, removeId: imported });
  expect(m.transactions).toHaveLength(1);
  const kept = m.transactions[0];
  // its own amount, method and note stay; tags, photos, description and the mail are added
  expect([kept._id, kept.amount, kept.accountId, kept.note, kept.description]).toEqual([typed, 48000, cash, "Dinner", "HDFC alert"]);
  expect(kept.tags).toEqual(["friends", "card"]);
  expect(kept.photoIds).toEqual(["p1", "p2"]);
  expect(kept.source).toEqual({ app: "gmail", messageId: "m1" });
  expect(m.bookmarks[0].transactionId).toBe(typed);
  expect(m.drafts[0].transactionId).toBe(typed);
});

test("a merge is refused for one entry, a gone one, or more than 3 photos together", () => {
  const { s, typed, imported } = ledger();
  expect(() => run(s, "transactions.merge", { keepId: typed, removeId: typed })).toThrow(/two different/);
  expect(() => run(s, "transactions.merge", { keepId: typed, removeId: "nope" })).toThrow(/gone/);
  const full = { ...s, transactions: s.transactions.map((t) => (t._id === typed ? { ...t, photoIds: ["p1", "p3", "p4"] as Id<"_storage">[] } : t)) };
  expect(() => run(full, "transactions.merge", { keepId: typed, removeId: imported })).toThrow(/3 photos/);
});

test("the server loads both entries of a merge and the tables it repoints", () => {
  expect(txScope({ id: "x", kind: "transactions.merge", args: { keepId: "a", removeId: "b" }, at: 1 })).toEqual({ ids: ["a", "b"] });
  expect(OP_TABLES["transactions.merge"]).toEqual(expect.arrayContaining(["transactions", "bookmarks", "drafts"]));
});

test("linking a draft can keep the entry as typed or take what the mail says", () => {
  const { s, typed, bank, transport } = ledger();
  const d = draft("d1", { accountId: bank, note: "Swiggy", time: "21:05" });
  const base = { ...s, drafts: [d] };

  const kept = run(base, "drafts.link", { id: d._id, transactionId: typed });
  const k = kept.transactions.find((t) => t._id === typed)!;
  expect([k.amount, k.note, k.accountId === bank, k.source?.messageId]).toEqual([48000, "Dinner", false, "msg-d1"]);
  expect([kept.drafts[0].status, kept.drafts[0].transactionId]).toEqual(["accepted", typed]);

  const mailed = run(base, "drafts.link", { id: d._id, transactionId: typed, useMail: true });
  const u = mailed.transactions.find((t) => t._id === typed)!;
  // the mail's amount, method, note and time; the entry's category (the mail named none), tags and photos
  expect([u.amount, u.accountId, u.note, u.time, u.tags, u.photoIds]).toEqual([48500, bank, "Swiggy", "21:05", ["friends"], ["p1"]]);
  expect(u.categoryId).toBe(s.transactions.find((t) => t._id === typed)!.categoryId);

  // a category the mail names wins; a mail that is income needs one, since the entry's expense category cannot be used
  const named = run({ ...s, drafts: [draft("d2", { categoryId: transport })] }, "drafts.link", { id: "d2", transactionId: typed, useMail: true });
  expect(named.transactions.find((t) => t._id === typed)!.categoryId).toBe(transport);
  expect(() => run({ ...s, drafts: [draft("d3", { type: "income" })] }, "drafts.link", { id: "d3", transactionId: typed, useMail: true })).toThrow(/Pick a category/);
});

test("a merge keeps what both entries were, and unmerging puts them back with their bookmarks and drafts", () => {
  const { s, typed, imported } = ledger();
  const before = s.transactions.map(({ _id, _creationTime, ...t }) => (void _id, void _creationTime, t));
  const withDraft = { ...s, drafts: [draft("d1", {}, { status: "accepted", transactionId: imported })] };
  const m = run(withDraft, "transactions.merge", { keepId: typed, removeId: imported });
  const rec = m.transactions[0].merged as MergeRecord;
  expect([rec.kept.note, rec.kept.amount, rec.removed?.amount, rec.removed?.description]).toEqual(["Dinner", 48000, 48500, "HDFC alert"]);

  const u = run(m, "transactions.unmerge", { id: typed });
  expect(u.transactions).toHaveLength(2);
  // the kept entry is exactly as it was, under the same id; the other comes back as a new entry
  const kept = u.transactions.find((t) => t._id === typed)!;
  const again = u.transactions.find((t) => t._id !== typed)!;
  const strip = ({ _id, _creationTime, ...t }: Doc<"transactions">) => (void _id, void _creationTime, t);
  expect([strip(kept), strip(again)]).toEqual(before);
  expect(u.bookmarks[0].transactionId).toBe(again._id);
  expect(u.drafts[0].transactionId).toBe(again._id);
  expect(() => run(u, "transactions.unmerge", { id: typed })).toThrow(/not merged/);
});

test("merging a merged entry again unmerges one step at a time", () => {
  let { s, typed, imported, cash } = ledger();
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-18", accountId: cash, categoryId: s.transactions[0].categoryId, amount: 100, note: "Tip", tags: ["tip"], photoIds: [] });
  const tip = s.transactions.at(-1)!._id;
  s = run(s, "transactions.merge", { keepId: typed, removeId: imported });
  s = run(s, "transactions.merge", { keepId: tip, removeId: typed });
  expect(s.transactions.map((t) => t.note)).toEqual(["Tip"]);
  // the entry removed by the second merge comes back still merged, and can be unmerged in turn
  s = run(s, "transactions.unmerge", { id: tip });
  const back = s.transactions.find((t) => t.note === "Dinner")!;
  expect((back.merged as MergeRecord).removed?.amount).toBe(48500);
  s = run(s, "transactions.unmerge", { id: back._id });
  expect(s.transactions.map((t) => t.note).sort()).toEqual(["", "Dinner", "Tip"]);
});

test("unmerging copes with a payment method gone since, and a change of decimals scales what it records", () => {
  let { s, typed, imported, bank, cash } = ledger();
  s = run(s, "transactions.merge", { keepId: typed, removeId: imported });
  // Bank (the removed entry's method) is merged into Cash meanwhile: the entry comes back on the entry's method
  s = run(s, "accounts.merge", { sourceIds: [bank], targetId: cash });
  s = run(s, "settings.changeDecimals", { decimals: 3 });
  s = run(s, "transactions.unmerge", { id: typed });
  const again = s.transactions.find((t) => t._id !== typed)!;
  expect([again.accountId, again.amount]).toEqual([cash, 485000]);
  expect(s.transactions.find((t) => t._id === typed)!.amount).toBe(480000);
});

test("merging with a Gmail draft links the entry to the mail, and unmerging takes the mail off again", () => {
  const { s, typed } = ledger();
  const before = s.transactions.find((t) => t._id === typed)!;
  const linked = run({ ...s, drafts: [draft("d1")] }, "drafts.link", { id: "d1", transactionId: typed, useMail: true });
  const t = linked.transactions.find((x) => x._id === typed)!;
  expect([t.source?.messageId, (t.merged as MergeRecord).draftId, (t.merged as MergeRecord).kept.amount]).toEqual(["msg-d1", "d1", 48000]);
  const back = run(linked, "transactions.unmerge", { id: typed });
  expect(back.transactions.find((x) => x._id === typed)).toEqual(before);
  expect([back.drafts[0].status, back.drafts[0].transactionId, back.drafts[0].keptNew]).toEqual(["open", undefined, true]);
});

test("a copy of a merged entry is a plain entry", () => {
  const { s, typed, imported } = ledger();
  const m = run(s, "transactions.merge", { keepId: typed, removeId: imported });
  const c = run(m, "transactions.copy", { id: typed, useToday: false });
  expect(c.transactions.at(-1)!.merged).toBeUndefined();
});
