/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { applyOp, emptySnapshot, restoreRowsFrom, rewriteIds, TABLES, type BackupData, type Op, type RestoreIds, type Snapshot } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");
const N = 20_000;
const CHUNK = 500;

/** A user with N entries, under Convex's real limits, plus what the app does: apply locally, then sync. */
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  let n = 0;
  const send = async (ops: Op[]) => as.mutation(api.sync.apply, { ops });
  const op = (kind: Op["kind"], args: unknown): Op => ({ id: `op${++n}`, kind, args, at: n });
  await send([op("settings.completeOnboarding", { currency: "USD" })]);
  const accounts = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const food = ((await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.name === "Food")!;
  for (let start = 0; start < N; start += 10_000) {
    await t.run(async (ctx) => {
      for (let i = start; i < start + 10_000; i++) {
        await ctx.db.insert("transactions", { userId, type: "expense", date: `2020-01-${String(1 + (i % 28)).padStart(2, "0")}`, accountId: accounts[i % 2]._id, categoryId: food._id, amount: i, note: `n${i}`, tags: [], photoIds: [] });
      }
    });
  }
  /** Everything the user has, as the app's local copy would hold it. */
  const snapshot = async (): Promise<Snapshot> => {
    const snap = emptySnapshot();
    for (const table of TABLES) {
      if (table === "transactions") {
        let cursor: string | null = null;
        for (;;) {
          const res: { page: Doc<"transactions">[]; isDone: boolean; continueCursor: string } = await as.query(api.sync.transactionsPage, { paginationOpts: { numItems: 5000, cursor } });
          snap.transactions.push(...res.page);
          if (res.isDone) break;
          cursor = res.continueCursor;
        }
      } else (snap as Record<string, unknown[]>)[table] = (await as.query(api.sync.table, { table })) as unknown[];
    }
    return snap;
  };
  const count = async () => (await snapshot()).transactions.length;
  /** Run what the server scheduled (the sweep after a chunked wipe or restore). */
  const finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { as, op, send, snapshot, count, userId, finish };
}

const chunk = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));

test("restoring 20,000 entries in one op is refused by Convex; in chunks it goes through", async () => {
  const { op, send, snapshot, count, userId } = await setup();
  const before = await snapshot();
  const data = JSON.parse(JSON.stringify({ version: 1, ...before, settings: before.settings[0] })) as BackupData;

  // the previous way: one op that rewrites every entry
  await expect(send([op("backup.restore", { data })])).rejects.toThrow(/too many documents/);

  // what src/lib/bulk.ts does
  for (const ids of chunk(before.transactions.map((t) => t._id))) expect((await send([op("transactions.bulkRemove", { ids })]))[0].status).toBe("applied");
  const restore = op("backup.restore", { data: { ...data, transactions: [] }, entries: false });
  const local = applyOp(await snapshot(), restore, { userId }).result as RestoreIds;
  const [applied] = await send([restore]);
  expect(applied.status).toBe("applied");
  const idMap = applied.status === "applied" ? applied.idMap : {};
  for (const rows of chunk(rewriteIds(restoreRowsFrom(data, local), idMap))) expect((await send([op("transactions.restoreRows", { rows })]))[0].status).toBe("applied");

  expect(await count()).toBe(N);
}, 300_000);

test("deleting all of 20,000 entries and rescaling them work in chunks", async () => {
  const { op, send, snapshot, count } = await setup();
  const ids = (await snapshot()).transactions.map((t) => t._id);
  for (const part of chunk(ids)) expect((await send([op("transactions.rescale", { ids: part, factor: 0.01 })]))[0].status).toBe("applied");
  expect((await send([op("settings.changeMainCurrency", { code: "JPY", keepData: true, entries: false })]))[0].status).toBe("applied");
  const after = await snapshot();
  expect(after.transactions.find((t) => t.note === "n12345")!.amount).toBe(123);
  expect(after.settings[0].mainCurrency).toBe("JPY");

  for (const part of chunk(ids)) expect((await send([op("transactions.bulkRemove", { ids: part })]))[0].status).toBe("applied");
  expect((await send([op("backup.wipeAll", { confirm: "DELETE", entries: false })]))[0].status).toBe("applied");
  expect(await count()).toBe(0);
}, 300_000);

test("a chunked wipe also removes entries the device never saw", async () => {
  const { op, send, snapshot, count, finish } = await setup();
  vi.useFakeTimers();
  // the device knows only some of the entries: the others were made elsewhere before the wipe arrived
  const known = (await snapshot()).transactions.map((t) => t._id).slice(0, 1000);
  for (const part of chunk(known)) expect((await send([op("transactions.bulkRemove", { ids: part })]))[0].status).toBe("applied");
  expect((await send([op("backup.wipeAll", { confirm: "DELETE", entries: false })]))[0].status).toBe("applied");
  await finish();
  expect(await count()).toBe(0);
  vi.useRealTimers();
}, 300_000);
