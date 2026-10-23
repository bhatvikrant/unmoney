import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { accountsList } from "./views";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx).snap;

function setup() {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const cash = s.accounts.find((a) => a.name === "Cash")!;
  const bank = s.accounts.find((a) => a.name === "Bank")!;
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-01", accountId: cash._id, categoryId: food, amount: 700, note: "Lunch", tags: [], photoIds: [] });
  s = run(s, "transactions.create", { type: "transfer", date: "2026-10-02", accountId: bank._id, toAccountId: cash._id, amount: 2000, note: "ATM", tags: [], photoIds: [] });
  s = run(s, "settings.setDefaultAccount", { id: cash._id });
  return { s, cash, bank };
}

test("archiving leaves entries, balances and totals alone, and only moves the method out of the groups", () => {
  const { s: before, cash } = setup();
  const s = run(before, "accounts.setArchived", { ids: [cash._id], archived: true });

  expect(s.transactions).toEqual(before.transactions);
  const was = accountsList(before, "2026-10-19");
  const now = accountsList(s, "2026-10-19");
  expect(now.accounts.find((a) => a._id === cash._id)!.balance).toBe(was.accounts.find((a) => a._id === cash._id)!.balance);
  expect([now.assets, now.liabilities, now.total]).toEqual([was.assets, was.liabilities, was.total]);

  expect(now.groups.flatMap((g) => g.accounts).some((a) => a._id === cash._id)).toBe(false);
  expect(now.archived.map((a) => a._id)).toEqual([cash._id]);
  // still in its group, for when it comes back
  expect(s.accounts.find((a) => a._id === cash._id)!.groupId).toBe(cash.groupId);
});

test("an archived method stops being the default, cannot be made default, and can still take entries", () => {
  const { s: start, cash, bank } = setup();
  const s = run(start, "accounts.setArchived", { ids: [cash._id], archived: true });
  expect(s.settings[0].defaultAccountId).toBeUndefined();
  expect(() => run(s, "settings.setDefaultAccount", { id: cash._id })).toThrow(/archived/);
  // editing an old entry on it, or importing more, keeps working
  const food = s.categories.find((c) => c.name === "Food")!._id;
  const t = run(s, "transactions.create", { type: "expense", date: "2026-10-03", accountId: cash._id, categoryId: food, amount: 100, note: "", tags: [], photoIds: [] });
  expect(t.transactions).toHaveLength(3);
  // unarchiving brings it back into its group; the default is not restored by itself
  const back = run(s, "accounts.setArchived", { ids: [cash._id], archived: false });
  expect(back.accounts.find((a) => a._id === cash._id)!.archivedAt).toBeUndefined();
  expect(accountsList(back, "2026-10-19").groups.flatMap((g) => g.accounts).map((a) => a._id)).toContain(cash._id);
  expect(accountsList(back, "2026-10-19").archived).toEqual([]);
  void bank;
});

test("archiving a category leaves its entries, budgets and stats alone and can be undone", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const pets = s.categories.find((c) => c.name === "Pets")!._id;
  const cash = s.accounts.find((a) => a.name === "Cash")!._id;
  s = run(s, "categories.create", { type: "expense", name: "Vet", parentId: pets });
  const vet = s.categories.find((c) => c.name === "Vet")!._id;
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-01", accountId: cash, categoryId: pets, subcategoryId: vet, amount: 4500, note: "Checkup", tags: [], photoIds: [] });
  s = run(s, "budgets.upsert", { categoryId: pets, period: "monthly", amount: 10000 });

  const after = run(s, "categories.setArchived", { ids: [pets], archived: true });
  expect(after.transactions).toEqual(s.transactions);
  expect(after.budgets).toEqual(s.budgets);
  expect(after.categories.find((c) => c._id === pets)!.archivedAt).toBeDefined();
  // the subcategory is not changed itself; it goes out of sight with its parent
  expect(after.categories.find((c) => c._id === vet)).toEqual(s.categories.find((c) => c._id === vet));
  // an old entry on it can still be edited
  const tx = after.transactions[0];
  expect(() => run(after, "transactions.update", { ...tx, id: tx._id, note: "Checkup and shots" })).not.toThrow();

  const back = run(after, "categories.setArchived", { ids: [pets], archived: false });
  expect(back.categories.find((c) => c._id === pets)!.archivedAt).toBeUndefined();
});

test("a deleted category can be restored, with the subcategories that went with it", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const pets = s.categories.find((c) => c.name === "Pets")!._id;
  const cash = s.accounts.find((a) => a.name === "Cash")!._id;
  s = run(s, "categories.create", { type: "expense", name: "Vet", parentId: pets });
  s = run(s, "categories.create", { type: "expense", name: "Toys", parentId: pets });
  const vet = s.categories.find((c) => c.name === "Vet")!._id;
  const toys = s.categories.find((c) => c.name === "Toys")!._id;
  s = run(s, "transactions.create", { type: "expense", date: "2026-10-01", accountId: cash, categoryId: pets, subcategoryId: vet, amount: 4500, note: "Checkup", tags: [], photoIds: [] });
  // Toys goes first on its own; then Pets takes Vet with it
  s = run(s, "categories.remove", { id: toys });
  const gone = run(s, "categories.remove", { id: pets });
  expect(gone.categories.filter((c) => [pets, vet, toys].includes(c._id)).every((c) => c.deletedAt)).toBe(true);

  const back = run(gone, "categories.restore", { id: pets });
  expect(back.categories.find((c) => c._id === pets)!.deletedAt).toBeUndefined();
  expect(back.categories.find((c) => c._id === vet)!.deletedAt).toBeUndefined();
  expect(back.categories.find((c) => c._id === toys)!.deletedAt).toBeDefined();
  expect(back.transactions).toEqual(s.transactions);
  // restoring what is not deleted changes nothing
  expect(run(back, "categories.restore", { id: pets }).categories).toEqual(back.categories);
  // a live category that took the name blocks it, as does a main category still deleted
  const taken = run(gone, "categories.create", { type: "expense", name: "pets" });
  expect(() => run(taken, "categories.restore", { id: pets })).toThrow(/already exists/);
  expect(() => run(gone, "categories.restore", { id: vet })).toThrow(/main category first/);
});
