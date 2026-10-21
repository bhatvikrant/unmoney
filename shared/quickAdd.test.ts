import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { linkEntry, parseEntryLink, quickItems } from "./quickAdd";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
function run(snap: Snapshot, kind: string, args: unknown) {
  return applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);
}

function ledger() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" }).snap;
  const food = s.categories.find((c) => c.name === "Food" && c.type === "expense")!._id;
  s = run(s, "categories.create", { type: "expense", name: "Coffee", parentId: food }).snap;
  const [cash, bank] = s.accounts;
  return { s, food, coffee: s.categories.find((c) => c.name === "Coffee")!._id, cash: cash._id, bank: bank._id };
}
const link = (q: string) => new URLSearchParams(q);

test("a link names things by name or id, with a subcategory as Food/Coffee or sub=", () => {
  const { s, food, coffee, bank } = ledger();
  expect(parseEntryLink(link("amount=120.50&category=food/coffee&account=bank&note=Chai&tags=office,%23team"), s)).toEqual({
    unknown: [], type: "expense", amount: 12050, categoryId: food, subcategoryId: coffee, accountId: bank, note: "Chai", tags: ["office", "team"],
  });
  expect(parseEntryLink(link(`category=${food}&sub=Coffee`), s)).toMatchObject({ categoryId: food, subcategoryId: coffee, unknown: [] });
  // a unique start of a name is enough
  expect(parseEntryLink(link("account=Ba"), s).accountId).toBe(bank);
});

test("amounts: decimal comma from a phone's locale, thousands separators, and no sign", () => {
  const { s } = ledger();
  expect(parseEntryLink(link("amount=1,50"), s).amount).toBe(150);
  expect(parseEntryLink(link("amount=1,250"), s).amount).toBe(125000);
  expect(parseEntryLink(link("amount=-80"), s).amount).toBe(8000);
  expect(parseEntryLink(link("amount=abc"), s).unknown).toEqual(['amount "abc"']);
});

test("the type comes from the category or a to-account when the link doesn't say", () => {
  const { s, cash, bank } = ledger();
  expect(parseEntryLink(link("category=Salary"), s).type).toBe("income");
  expect(parseEntryLink(link("to=Cash&account=Bank&amount=500"), s)).toMatchObject({ type: "transfer", accountId: bank, toAccountId: cash });
  // "Other" is both an income and an expense category: expense wins unless the link says income
  expect(s.categories.find((c) => c._id === parseEntryLink(link("category=Other"), s).categoryId)!.type).toBe("expense");
  expect(s.categories.find((c) => c._id === parseEntryLink(link("type=income&category=Other"), s).categoryId)!.type).toBe("income");
});

test("save=1 needs an amount, a method (or the default) and a category, and nothing it couldn't find", () => {
  const { s, cash, food } = ledger();
  const ok = linkEntry(parseEntryLink(link("amount=40&category=Food&note=Tea"), s), cash, "2026-10-21");
  expect(ok).toEqual({ fields: { type: "expense", date: "2026-10-21", accountId: cash, categoryId: food, amount: 4000, note: "Tea", tags: [], photoIds: [] } });
  expect(linkEntry(parseEntryLink(link("amount=40&category=Fod"), s), cash, "2026-10-21")).toEqual({ missing: 'Couldn\'t find category "Fod"' });
  expect(linkEntry(parseEntryLink(link("category=Food"), s), cash, "2026-10-21")).toEqual({ missing: "No amount" });
  expect(linkEntry(parseEntryLink(link("amount=40"), s), cash, "2026-10-21")).toEqual({ missing: "No category" });
  expect(linkEntry(parseEntryLink(link("amount=40&type=transfer"), s), cash, "2026-10-21")).toEqual({ missing: "No account to transfer to" });
  // a link's date wins over today
  expect(linkEntry(parseEntryLink(link("amount=40&category=Food&date=2026-10-01"), s), cash, "2026-10-21")).toMatchObject({ fields: { date: "2026-10-01" } });
});

test("quick items: the first bookmarks that can be saved as they are, then the last entry added by hand", () => {
  const { s: base, food, cash, bank } = ledger();
  let s = base;
  const tpl = (note: string, amount: number) => ({ type: "expense", accountId: cash, categoryId: food, amount, note, tags: [] });
  for (const [note, amount] of [["Coffee", 12000], ["No amount", 0], ["Lunch", 25000], ["Metro", 4000], ["Bus", 2000], ["Tea", 1500]] as const) {
    s = run(s, "bookmarks.create", { template: tpl(note, amount) }).snap;
  }
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-20", accountId: bank, categoryId: food, amount: 48500, note: "Swiggy", tags: [], photoIds: [] }).snap;
  // a schedule's entry is not "the last one you added"
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-21", accountId: bank, categoryId: food, amount: 99, note: "Rent", tags: [], photoIds: [], repeat: { frequency: "monthly" } }).snap;
  const items = quickItems(s);
  expect(items.map((i) => [i.label, i.template.note])).toEqual([["bookmark", "Coffee"], ["bookmark", "Lunch"], ["bookmark", "Metro"], ["bookmark", "Bus"], ["last", "Swiggy"]]);
  // the last entry is left out when a bookmark offered is the same thing
  const again = run(s, "transactions.create", { type: "expense", date: "2026-10-21", accountId: cash, categoryId: food, amount: 12000, note: "coffee", tags: [], photoIds: [] }).snap;
  expect(quickItems(again).map((i) => i.label)).toEqual(["bookmark", "bookmark", "bookmark", "bookmark"]);
  // a bookmark on a deleted method is skipped
  const gone = run(s, "accounts.remove", { id: cash }).snap;
  expect(quickItems(gone).map((i) => i.template.note)).toEqual(["Swiggy"]);
});
