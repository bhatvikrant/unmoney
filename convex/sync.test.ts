/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Op } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");

/** A signed-in user who finished onboarding, with Convex's real per-transaction limits enforced. */
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  let n = 0;
  const apply = async (kind: Op["kind"], args: unknown) => {
    const [r] = await as.mutation(api.sync.apply, { ops: [{ id: `op${++n}`, kind, args, at: Date.now() }] });
    return r;
  };
  await apply("settings.completeOnboarding", { currency: "USD" });
  const accounts = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const categories = (await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[];
  const food = categories.find((c) => c.type === "expense" && c.name === "Food")!;
  const tx = (extra: Partial<Doc<"transactions">> = {}) => ({
    userId, type: "expense" as const, date: "2026-01-15", accountId: accounts[0]._id, categoryId: food._id, amount: 100, note: "", tags: [], photoIds: [], ...extra,
  });
  /** Insert entries directly, in chunks that stay under the per-transaction write limit. */
  const seed = async (count: number, make: (i: number) => Partial<Doc<"transactions">> = () => ({})) => {
    for (let start = 0; start < count; start += 10_000) {
      await t.run(async (ctx) => {
        for (let i = start; i < Math.min(count, start + 10_000); i++) await ctx.db.insert("transactions", tx(make(i)));
      });
    }
  };
  const all = () => t.run((ctx) => ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect());
  return { t, as, apply, userId, accounts, food, tx, seed, all };
}

const BIG = 33_000; // past Convex's 32,000-documents-read limit per function

describe("a ledger past Convex's read limit", () => {
  test("adding, editing and deleting an entry still sync", async () => {
    const { t, userId, apply, accounts, food, seed } = await setup();
    await seed(BIG, (i) => ({ date: `20${10 + (i % 16)}-0${1 + (i % 9)}-1${i % 10}` }));
    const created = await apply("transactions.create", { type: "expense", date: "2026-10-18", accountId: accounts[0]._id, categoryId: food._id, amount: 4200, note: "Lunch", tags: [], photoIds: [] });
    expect(created.status).toBe("applied");
    const id = Object.values(created.status === "applied" ? created.idMap : {})[0] as Id<"transactions">;
    expect((await apply("transactions.update", { id, type: "expense", date: "2026-10-18", accountId: accounts[0]._id, categoryId: food._id, amount: 5000, note: "Lunch", tags: [], photoIds: [] })).status).toBe("applied");
    expect((await apply("transactions.copy", { id, useToday: false })).status).toBe("applied");
    expect((await apply("transactions.remove", { id })).status).toBe("applied");
    // only the copy is left on that day
    const day = await t.run((ctx) => ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", "2026-10-18")).collect());
    expect(day.map((d) => d.amount)).toEqual([5000]);
  }, 120_000);

  test("the paginated subscription reads it a page at a time", async () => {
    const { as, seed } = await setup();
    await seed(BIG);
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const res: { page: unknown[]; isDone: boolean; continueCursor: string } = await as.query(api.sync.transactionsPage, { paginationOpts: { numItems: 2000, cursor } });
      total += res.page.length;
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(total).toBe(BIG);
  }, 120_000);

  test("the old whole-table query fails there, which is why the client moved off it", async () => {
    const { as, seed } = await setup();
    await seed(BIG);
    await expect(as.query(api.sync.table, { table: "transactions" })).rejects.toThrow();
  }, 120_000);

  test("an import that skips duplicates reads only the days it imports", async () => {
    const { apply, seed } = await setup();
    await seed(BIG, (i) => ({ date: `2015-01-${String(1 + (i % 28)).padStart(2, "0")}` }));
    await seed(1, () => ({ date: "2026-03-04", amount: 1250, note: "Coffee" }));
    const r = await apply("transactions.importRows", {
      rows: [
        { date: "2026-03-04", account: "Cash", category: "Food", amount: "12.50", type: "Expense", note: "Coffee" },
        { date: "2026-03-05", account: "Cash", category: "Food", amount: "3", type: "Expense", note: "Tea" },
      ],
      skipDuplicates: true,
    });
    expect(r.status).toBe("applied");
  }, 120_000);
});

describe("devices follow what changed, not whole tables", () => {
  const create = (accountId: Id<"accounts">, categoryId: Id<"categories">, note: string) =>
    ({ type: "expense", date: "2026-10-18", accountId, categoryId, amount: 4200, note, tags: [], photoIds: [] });

  test("a save sends only what it wrote, a delete sends its id, and nothing changed sends nothing", async () => {
    const { as, apply, accounts, food, seed } = await setup();
    await seed(500);
    const start = (await as.query(api.sync.head))!;
    expect(await as.query(api.sync.changes, { since: start })).toEqual({ rev: start, docs: {}, deleted: [] });

    const created = await apply("transactions.create", create(accounts[0]._id, food._id, "Lunch"));
    if (created.status !== "applied") throw new Error("not applied");
    const id = Object.values(created.idMap)[0];
    // the outcome says how far a device must have followed to have the save
    expect(created.rev).toBe(start + 1);
    const after = await as.query(api.sync.changes, { since: start });
    if (!after || after.reset) throw new Error("expected changes");
    expect(after.rev).toBe(start + 1);
    expect(Object.keys(after.docs)).toEqual(["transactions"]);
    expect(after.docs.transactions!.map((d) => [d._id, d.note])).toEqual([[id, "Lunch"]]);

    expect((await apply("transactions.remove", { id })).status).toBe("applied");
    const gone = await as.query(api.sync.changes, { since: start + 1 });
    if (!gone || gone.reset) throw new Error("expected changes");
    expect(gone.docs).toEqual({});
    expect(gone.deleted).toEqual([{ table: "transactions", id }]);
  });

  test("ops that change nothing hand out no number", async () => {
    const { as, apply } = await setup();
    const before = (await as.query(api.sync.head))!;
    const r = await apply("transactions.remove", { id: "kd7000000000000000000000000000000" });
    expect(r.status).toBe("rejected");
    expect(await as.query(api.sync.head)).toBe(before);
  });

  test("a device ahead of the server, or behind the deletes still kept, is told to load everything", async () => {
    const { t, as, apply, accounts, food } = await setup();
    const created = await apply("transactions.create", create(accounts[0]._id, food._id, "Tea"));
    if (created.status !== "applied") throw new Error("not applied");
    await apply("transactions.remove", { id: Object.values(created.idMap)[0] });
    const now = (await as.query(api.sync.head))!;
    expect(await as.query(api.sync.changes, { since: now + 5 })).toEqual({ rev: now, reset: true });
    // the tombstone is dropped: a device that last looked before it cannot hear about the delete
    await t.mutation(internal.sync.pruneTombstones, { cutoff: Date.now() + 1000 });
    expect(await as.query(api.sync.changes, { since: 1 })).toEqual({ rev: now, reset: true });
    expect(await as.query(api.sync.changes, { since: now })).toEqual({ rev: now, docs: {}, deleted: [] });
  });

  test("writes from the server's own jobs reach devices too", async () => {
    const { t, as, userId, apply, accounts, food } = await setup();
    await apply("transactions.create", { ...create(accounts[0]._id, food._id, "Rent"), date: "2026-01-01", repeat: { frequency: "monthly" } });
    const before = (await as.query(api.sync.head))!;
    await t.mutation(internal.repeats.materialiseUser, { userId, today: "2026-03-15" });
    const got = await as.query(api.sync.changes, { since: before });
    if (!got || got.reset) throw new Error("expected changes");
    expect(got.docs.transactions?.length).toBeGreaterThan(0);
    expect(got.docs.repeats?.length).toBe(1);
  });
});

describe("scoped ops behave as before", () => {
  test("editing 'this and future' changes only the later entries of that series", async () => {
    const { apply, accounts, food, all } = await setup();
    const base = { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 1000, note: "Rent", tags: [], photoIds: [] };
    await apply("transactions.create", { ...base, date: "2026-01-01", installment: { count: 3 } });
    await apply("transactions.create", { ...base, date: "2026-01-01", note: "Other" });
    const series = (await all()).filter((d) => d.repeatId).sort((a, b) => a.date.localeCompare(b.date));
    const r = await apply("transactions.update", { ...base, id: series[1]._id, date: series[1].date, amount: series[1].amount, note: "Rent (new)", scope: "future" });
    expect(r.status).toBe("applied");
    const after = await all();
    expect(after.filter((d) => d.note === "Rent (new)").map((d) => d.date).sort()).toEqual(["2026-02-01", "2026-03-01"]);
    expect(after.find((d) => d.note === "Other")).toBeTruthy();
  });

  test("deleting a whole series removes every entry of it and nothing else", async () => {
    const { apply, accounts, food, all } = await setup();
    const base = { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 1200, note: "TV", tags: [], photoIds: [], date: "2026-01-10" };
    await apply("transactions.create", { ...base, installment: { count: 4 } });
    await apply("transactions.create", { ...base, note: "Keep" });
    const first = (await all()).find((d) => d.installmentIndex === 3)!;
    expect((await apply("transactions.remove", { id: first._id, scope: "all" })).status).toBe("applied");
    expect((await all()).map((d) => d.note)).toEqual(["Keep"]);
  });

  test("a series created earlier in the same batch can be deleted in that batch", async () => {
    const { as, accounts, food, all } = await setup();
    const args = { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 900, note: "Phone", tags: [], photoIds: [], date: "2026-01-10", installment: { count: 3 } };
    // the client sends the second op with the first entry's temporary id
    const res = await as.mutation(api.sync.apply, {
      ops: [
        { id: "a", kind: "transactions.create", args, at: 1 },
        { id: "b", kind: "transactions.remove", args: { id: "tmp_a_2", scope: "all" }, at: 2 },
      ],
    });
    expect(res.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(await all()).toEqual([]);
  });

  test("deleting an account for good removes entries to and from it", async () => {
    const { apply, accounts, food, all } = await setup();
    const [cash, bank] = accounts;
    await apply("transactions.create", { type: "expense", accountId: cash._id, categoryId: food._id, amount: 100, note: "a", tags: [], photoIds: [], date: "2026-01-01" });
    await apply("transactions.create", { type: "transfer", accountId: bank._id, toAccountId: cash._id, amount: 100, note: "b", tags: [], photoIds: [], date: "2026-01-01" });
    await apply("transactions.create", { type: "expense", accountId: bank._id, categoryId: food._id, amount: 100, note: "c", tags: [], photoIds: [], date: "2026-01-01" });
    await apply("accounts.remove", { id: cash._id });
    expect((await apply("accounts.permanentlyDelete", { id: cash._id })).status).toBe("applied");
    expect((await all()).map((d) => d.note)).toEqual(["c"]);
  });

  test("another user's entry cannot be edited or deleted by id", async () => {
    const mine = await setup();
    const theirs = await setup();
    void theirs;
    const other = await mine.t.run(async (ctx) => {
      const otherUser = await ctx.db.insert("users", { email: "b@example.com" });
      return ctx.db.insert("transactions", { ...mine.tx(), userId: otherUser });
    });
    const r = await mine.apply("transactions.bulkRemove", { ids: [other] });
    expect(r.status).toBe("rejected");
    expect(await mine.t.run((ctx) => ctx.db.get(other))).not.toBeNull();
  });
});

describe("daily schedules", () => {
  test("the job adds each user's due entries in that user's own mutation", async () => {
    vi.useFakeTimers();
    const { t, apply, accounts, food, all } = await setup();
    await apply("transactions.create", { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 1599, note: "Spotify", tags: [], photoIds: [], date: "2026-01-20", repeat: { frequency: "monthly" } });
    await t.mutation(internal.repeats.materialiseAll, { today: "2026-03-25" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await all()).map((d) => d.date).sort()).toEqual(["2026-01-20", "2026-02-20", "2026-03-20"]);
    vi.useRealTimers();
  });
});

describe("tidying up categories on a ledger past the read limit", () => {
  test("a merge and its undo move exactly the entries of the merged category", async () => {
    const { t, userId, apply, accounts, food, seed } = await setup();
    const cats = await t.run((ctx) => ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect());
    const other = cats.find((c) => c.name === "Other")!;
    const snacks = await t.run((ctx) => ctx.db.insert("categories", { userId, type: "expense", name: "Snacks", order: 99 }));
    const chips = await t.run((ctx) => ctx.db.insert("categories", { userId, type: "expense", name: "Chips", parentId: food._id, order: 100 }));
    await seed(BIG, () => ({ categoryId: other._id }));
    await seed(30, () => ({ categoryId: snacks, note: "snack" }));
    await seed(5, () => ({ categoryId: food._id, subcategoryId: chips, note: "chips" }));
    await seed(7, () => ({ categoryId: food._id, note: "food" }));
    void accounts;

    const merged = await apply("categories.applyCleanup", { steps: [{ kind: "merge", sourceIds: [snacks, chips], target: { id: food._id } }] });
    expect(merged.status).toBe("applied");
    const inFood = () => t.run((ctx) => ctx.db.query("transactions").withIndex("by_user_category", (q) => q.eq("userId", userId).eq("categoryId", food._id)).collect());
    let food2 = await inFood();
    expect(food2.length).toBe(42);
    expect(food2.filter((x) => x.subcategoryId).length).toBe(0);

    const record = await t.run((ctx) => ctx.db.query("categoryCleanups").withIndex("by_user", (q) => q.eq("userId", userId)).unique());
    expect((await apply("categories.undoCleanup", { id: record!._id })).status).toBe("applied");
    food2 = await inFood();
    expect(food2.map((x) => x.note).sort()).toEqual([...Array(5).fill("chips"), ...Array(7).fill("food")]);
    expect(food2.filter((x) => x.subcategoryId === chips).length).toBe(5);
    const back = await t.run((ctx) => ctx.db.query("transactions").withIndex("by_user_category", (q) => q.eq("userId", userId).eq("categoryId", snacks)).collect());
    expect(back.length).toBe(30);
  }, 120_000);
});

describe("bills and subscriptions", () => {
  test("Make it a repeat links the payment it came from, and Add now / Skip move the schedule on", async () => {
    const { t, apply, accounts, food, all } = await setup();
    const made = await apply("transactions.create", { type: "expense", date: "2026-09-05", accountId: accounts[0]._id, categoryId: food._id, amount: 19900, note: "Spotify", tags: [], photoIds: [] });
    const txId = Object.values(made.status === "applied" ? made.idMap : {})[0] as Id<"transactions">;
    const r = await apply("repeats.create", {
      template: { type: "expense", accountId: accounts[0]._id, categoryId: food._id, amount: 19900, note: "Spotify", tags: [] }, frequency: "monthly", after: "2026-09-05", today: "2026-10-21", fromTransactionId: txId,
    });
    expect(r.status).toBe("applied");
    const repeatId = Object.values(r.status === "applied" ? r.idMap : {})[0] as Id<"repeats">;
    expect((await t.run((ctx) => ctx.db.get(txId)))!.repeatId).toBe(repeatId);
    expect((await t.run((ctx) => ctx.db.get(repeatId)))!.nextDate).toBe("2026-11-05");

    expect((await apply("repeats.addNext", { id: repeatId, date: "2026-11-05", entryDate: "2026-10-21" })).status).toBe("applied");
    expect((await apply("repeats.skip", { id: repeatId, date: "2026-12-05" })).status).toBe("applied");
    expect((await t.run((ctx) => ctx.db.get(repeatId)))!.nextDate).toBe("2027-01-05");
    // a second device adding the same date is refused, not doubled
    const again = await apply("repeats.addNext", { id: repeatId, date: "2026-11-05", entryDate: "2026-10-21" });
    expect(again.status).toBe("rejected");
    expect((await all()).filter((x) => x.note === "Spotify").map((x) => x.date).sort()).toEqual(["2026-09-05", "2026-10-21"]);
  });
});
