import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { foldDrafts, laterMatches, matchEntry, samePayment, type DraftCandidate } from "./dedup";

const ALERT = "HDFC Bank <alerts@hdfcbank.net>";
const RECEIPT = "Swiggy <noreply@swiggy.in>";
type Short = { id: string; from?: string; subject?: string; at?: number; amount?: number; date?: string; note?: string; last4?: string; accountId?: string; type?: "income" | "expense" | "transfer"; categoryId?: string };

function cand(s: Short): DraftCandidate {
  return {
    source: "gmail", messageId: s.id, extraMessageIds: [], threadId: `t-${s.id}`, receivedAt: s.at ?? 0, from: s.from ?? ALERT, subject: s.subject ?? "Alert",
    proposal: {
      type: s.type ?? "expense", date: s.date ?? "2026-10-18", amount: s.amount ?? 48500, note: s.note ?? "", accountId: s.accountId as Id<"accounts"> | undefined,
      categoryId: s.categoryId as Id<"categories"> | undefined, accountHint: s.last4 ? { last4: s.last4 } : undefined,
    },
    confidence: "high", how: "rule",
  };
}
const open = (s: Short, status: Doc<"drafts">["status"] = "open"): Doc<"drafts"> => ({ ...cand(s), _id: `d-${s.id}` as Id<"drafts">, _creationTime: 0, userId: "u" as Id<"users">, status });
const alert = (id: string, extra: Partial<Short> = {}) => cand({ id, from: ALERT, note: "Swiggy Upi", last4: "1234", ...extra });
const receipt = (id: string, extra: Partial<Short> = {}) => cand({ id, from: RECEIPT, subject: "Your order", note: "Swiggy", categoryId: "food", at: 10, ...extra });

test("a bank alert and the shop's receipt for the same amount on the same day are one draft, with the shop's name", () => {
  const r = foldDrafts([alert("a"), receipt("b")], []);
  expect(r.updates).toEqual([]);
  expect(r.inserts.map((d) => [d.messageId, d.extraMessageIds, d.proposal.note, d.proposal.categoryId, d.proposal.accountHint?.last4])).toEqual([["a", ["b"], "Swiggy", "food", "1234"]]);
});

test("the alert stays whichever mail came first, and a day's difference is allowed", () => {
  const r = foldDrafts([receipt("b", { at: 1, date: "2026-10-19" }), alert("a", { at: 2 })], []);
  expect(r.inserts.map((d) => [d.messageId, d.extraMessageIds, d.proposal.date])).toEqual([["a", ["b"], "2026-10-18"]]);
});

test("two alerts on the same card for the same amount fold only when they name the same shop", () => {
  const twoCoffees = foldDrafts([alert("a", { note: "Starbucks" }), alert("b", { note: "Third Wave" })], []);
  expect(twoCoffees.inserts.length).toBe(2);
  const twice = foldDrafts([alert("a"), alert("b")], []);
  expect(twice.inserts.map((d) => [d.messageId, d.extraMessageIds])).toEqual([["a", ["b"]]]);
  const otherCard = foldDrafts([alert("a"), alert("b", { last4: "9999" })], []);
  expect(otherCard.inserts.length).toBe(2);
});

test("two receipts, a different amount, a different kind or two days apart stay apart", () => {
  expect(foldDrafts([receipt("a"), receipt("b")], []).inserts.length).toBe(2);
  expect(foldDrafts([alert("a"), receipt("b", { amount: 48600 })], []).inserts.length).toBe(2);
  expect(foldDrafts([alert("a"), receipt("b", { date: "2026-10-20" })], []).inserts.length).toBe(2);
  expect(foldDrafts([alert("a", { type: "income" }), receipt("b")], []).inserts.length).toBe(2);
  expect(samePayment(alert("a"), receipt("b"))).toBe(true);
});

test("a receipt arriving after its alert was already a draft folds into that draft", () => {
  const existing = open({ id: "a", note: "Swiggy Upi", last4: "1234" });
  const r = foldDrafts([receipt("b")], [existing]);
  expect(r.inserts).toEqual([]);
  expect(r.updates).toEqual([{ id: existing._id, extraMessageIds: ["b"], note: "Swiggy", categoryId: "food", subcategoryId: undefined }]);
  // a draft the user already handled is not a target
  expect(foldDrafts([receipt("b")], [open({ id: "a", note: "Swiggy Upi", last4: "1234" }, "accepted")]).inserts.length).toBe(1);
});

test("an entry the user typed in is matched by amount, a day's distance and method", () => {
  const tx = (id: string, extra: Partial<Doc<"transactions">> = {}): Doc<"transactions"> => ({
    _id: id as Id<"transactions">, _creationTime: Number(id.replace(/\D/g, "")), userId: "u" as Id<"users">, type: "expense", date: "2026-10-18", accountId: "gpay" as Id<"accounts">, amount: 48500, note: "Swiggy", tags: [], photoIds: [], ...extra,
  });
  const draft = cand({ id: "a", accountId: "gpay" });
  expect(matchEntry(draft, [tx("t1")])).toBe("t1");
  expect(matchEntry(draft, [tx("t1", { date: "2026-10-19" })])).toBe("t1");
  expect(matchEntry(draft, [tx("t1", { date: "2026-10-20" })])).toBeUndefined();
  expect(matchEntry(draft, [tx("t1", { amount: 48400 })])).toBeUndefined();
  expect(matchEntry(draft, [tx("t1", { accountId: "cash" as Id<"accounts"> })])).toBeUndefined();
  // the closest day wins, then the most recent
  expect(matchEntry(draft, [tx("t1", { date: "2026-10-17" }), tx("t2"), tx("t3")])).toBe("t3");
  // an entry that came from a draft is never matched again
  expect(matchEntry(draft, [tx("t1", { source: { app: "gmail", messageId: "x" } })])).toBeUndefined();
  // a draft without a method matches any method; a schedule's entry counts too
  expect(matchEntry(cand({ id: "b" }), [tx("t1", { accountId: "cash" as Id<"accounts">, repeatId: "r" as Id<"repeats"> })])).toBe("t1");
});

test("a bank account, its debit card and its linked UPIs are the same money when matching", () => {
  const acc = (id: string, extra: Partial<Doc<"accounts">> = {}) => ({ _id: id as Id<"accounts">, kind: "bank", ...extra }) as Doc<"accounts">;
  const accounts = [
    acc("hdfc"), acc("phonepe", { kind: "upi", linkedAccountId: "hdfc" as Id<"accounts"> }), acc("gpay", { kind: "upi", linkedAccountId: "hdfc" as Id<"accounts"> }),
    acc("debit", { kind: "debitCard", linkedAccountId: "hdfc" as Id<"accounts"> }), acc("wallet", { kind: "upi" }), acc("card", { kind: "card" }), acc("icici"),
  ];
  const tx = (id: string, accountId: string, extra: Partial<Doc<"transactions">> = {}): Doc<"transactions"> => ({
    _id: id as Id<"transactions">, _creationTime: Number(id.replace(/\D/g, "")), userId: "u" as Id<"users">, type: "expense", date: "2026-10-18", accountId: accountId as Id<"accounts">, amount: 48500, note: "Swiggy", tags: [], photoIds: [], ...extra,
  });
  // read as the bank, typed in under a UPI that draws from it (and the other way round)
  expect(matchEntry(cand({ id: "a", accountId: "hdfc" }), [tx("t1", "phonepe")], accounts)).toBe("t1");
  expect(matchEntry(cand({ id: "a", accountId: "gpay" }), [tx("t1", "phonepe")], accounts)).toBe("t1");
  expect(matchEntry(cand({ id: "a", accountId: "debit" }), [tx("t1", "hdfc")], accounts)).toBe("t1");
  // other money stays apart: another bank, a credit card, a UPI wallet with its own balance
  expect(matchEntry(cand({ id: "a", accountId: "hdfc" }), [tx("t1", "icici")], accounts)).toBeUndefined();
  expect(matchEntry(cand({ id: "a", accountId: "hdfc" }), [tx("t1", "card")], accounts)).toBeUndefined();
  expect(matchEntry(cand({ id: "a", accountId: "hdfc" }), [tx("t1", "wallet")], accounts)).toBeUndefined();
  // on the same day, the exact method wins over a sibling, even an older one
  expect(matchEntry(cand({ id: "a", accountId: "gpay" }), [tx("t1", "gpay"), tx("t2", "phonepe")], accounts)).toBe("t1");
});

test("open drafts find an entry typed in after them, unless already matched or kept as new", () => {
  const accounts = [{ _id: "hdfc", kind: "bank" }, { _id: "gpay", kind: "upi", linkedAccountId: "hdfc" }] as unknown as Doc<"accounts">[];
  const tx = (id: string, extra: Partial<Doc<"transactions">> = {}): Doc<"transactions"> => ({
    _id: id as Id<"transactions">, _creationTime: 1, userId: "u" as Id<"users">, type: "expense", date: "2026-10-18", accountId: "gpay" as Id<"accounts">, amount: 48500, note: "Swiggy", tags: [], photoIds: [], ...extra,
  });
  const drafts = [
    open({ id: "a", accountId: "hdfc" }),
    { ...open({ id: "b" }), matchedTransactionId: "t0" as Id<"transactions"> },
    { ...open({ id: "c" }), keptNew: true },
    open({ id: "d" }, "dismissed"),
    open({ id: "e", amount: 9900 }),
  ];
  const typed = [tx("t1"), tx("t2", { amount: 9900, source: { app: "gmail", messageId: "x" } })];
  expect([...laterMatches(drafts, typed, accounts)]).toEqual([["d-a", "t1"]]);
  expect(laterMatches(drafts, [], accounts).size).toBe(0);
});

// ---- money moved between the user's own methods ----

const HDFC = "acc-hdfc" as Id<"accounts">, ICICI = "acc-icici" as Id<"accounts">, GPAY = "acc-gpay" as Id<"accounts">, CARD = "acc-card" as Id<"accounts">;
const accounts = [
  { _id: HDFC, kind: "bank" }, { _id: ICICI, kind: "bank" }, { _id: GPAY, kind: "upi", linkedAccountId: HDFC }, { _id: CARD, kind: "card" },
] as Pick<Doc<"accounts">, "_id" | "kind" | "linkedAccountId">[];
const ICICI_ALERT = "ICICI <alerts@icicibank.com>";

test("a debit from one account and a credit into another for the same amount are one transfer draft", () => {
  const out = alert("a", { note: "NEFT ICICI", accountId: HDFC, amount: 2500000 });
  const inn = cand({ id: "b", from: ICICI_ALERT, type: "income", accountId: ICICI, amount: 2500000, note: "NEFT from Vikrant", at: 5, date: "2026-10-19" });
  const r = foldDrafts([inn, out], [], accounts);
  expect(r.inserts).toHaveLength(1);
  const d = r.inserts[0];
  expect([d.messageId, d.extraMessageIds, d.proposal.type, d.proposal.accountId, d.proposal.toAccountId, d.proposal.categoryId, d.confidence]).toEqual(["a", ["b"], "transfer", HDFC, ICICI, undefined, "medium"]);
  expect(d.proposal.description).toContain("paired with the other side's mail");
});

test("not paired: the same money (a bank and its UPI), a shop's receipt, other amounts or days, refunds, or unknown methods", () => {
  const out = (x: Partial<Short> = {}) => alert("a", { accountId: HDFC, ...x });
  const inn = (x: Partial<Short> = {}) => cand({ id: "b", from: ICICI_ALERT, type: "income", accountId: ICICI, at: 5, ...x });
  expect(foldDrafts([out(), inn({ accountId: GPAY })], [], accounts).inserts).toHaveLength(2);
  expect(foldDrafts([out(), cand({ id: "b", from: RECEIPT, type: "income", accountId: ICICI })], [], accounts).inserts).toHaveLength(2);
  expect(foldDrafts([out(), inn({ amount: 1 })], [], accounts).inserts).toHaveLength(2);
  expect(foldDrafts([out(), inn({ date: "2026-10-21" })], [], accounts).inserts).toHaveLength(2);
  expect(foldDrafts([out({ amount: -48500 }), inn({ amount: -48500 })], [], accounts).inserts).toHaveLength(2);
  expect(foldDrafts([out({ accountId: undefined }), inn()], [], accounts).inserts).toHaveLength(2);
  // without the user's methods nothing pairs (older callers)
  expect(foldDrafts([out(), inn()], []).inserts).toHaveLength(2);
});

test("a bank's 'debited towards your card' folds into the card's 'payment received' transfer, from the account the bank names", () => {
  const debit = alert("a", { accountId: ICICI, note: "Credit card payment", amount: 1400000 });
  const paid = cand({ id: "b", from: "HDFC Card <cards@hdfcbank.net>", type: "transfer", accountId: HDFC, amount: 1400000, at: 5 });
  paid.proposal.toAccountId = CARD;
  const r = foldDrafts([debit, paid], [], accounts);
  expect(r.inserts.map((d) => [d.messageId, d.extraMessageIds, d.proposal.type, d.proposal.accountId, d.proposal.toAccountId])).toEqual([["a", ["b"], "transfer", ICICI, CARD]]);
});

test("the other side arriving after the first was already a draft turns that draft into the transfer", () => {
  const existing = open({ id: "a", accountId: HDFC, amount: 2500000, note: "NEFT ICICI" });
  const r = foldDrafts([cand({ id: "b", from: ICICI_ALERT, type: "income", accountId: ICICI, amount: 2500000 })], [existing], accounts);
  expect(r.inserts).toEqual([]);
  expect(r.updates).toEqual([{ id: existing._id, extraMessageIds: ["b"], transfer: { accountId: HDFC, toAccountId: ICICI } }]);
  // and the other way round: the credit was the draft
  const credit = open({ id: "c", from: ICICI_ALERT, type: "income", accountId: ICICI, amount: 2500000 });
  expect(foldDrafts([alert("d", { accountId: HDFC, amount: 2500000 })], [credit], accounts).updates[0].transfer).toEqual({ accountId: HDFC, toAccountId: ICICI });
});
