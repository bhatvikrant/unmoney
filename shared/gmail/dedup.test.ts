import { expect, test } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { foldDrafts, matchEntry, samePayment, type DraftCandidate } from "./dedup";

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
