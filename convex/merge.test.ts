/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { Op } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");

// The server loads only the entries an op says it touches, so a merge must reach every entry of the
// methods it folds together, including ones on days and categories the op never names.
test("a merge synced to the server moves every entry of the merged methods", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "m@x" }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  let n = 0;
  const op = (kind: Op["kind"], args: unknown): Op => ({ id: `op${++n}`, kind, args, at: n });
  const apply = (...ops: Op[]) => as.mutation(api.sync.apply, { ops });
  await apply(op("settings.completeOnboarding", { currency: "USD" }));
  const accounts = async () => (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const all = await accounts();
  const cashId = all.find((a) => a.name === "Cash")!._id;
  const bankId = all.find((a) => a.name === "Bank")!._id;
  const food = ((await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.name === "Food")!._id;
  await apply(
    op("transactions.create", { type: "expense", date: "2026-03-04", accountId: cashId, categoryId: food, amount: 700, note: "Lunch", tags: [], photoIds: [] }),
    op("transactions.create", { type: "transfer", date: "2026-05-06", accountId: bankId, toAccountId: cashId, amount: 2000, note: "ATM", tags: [], photoIds: [] }),
  );

  const [res] = await apply(op("accounts.merge", { sourceIds: [cashId], targetId: bankId }));
  expect(res.status).toBe("applied");
  const txs = (await as.query(api.sync.table, { table: "transactions" })) as Doc<"transactions">[];
  expect(txs.map((x) => [x.note, x.accountId === bankId])).toEqual([["Lunch", true]]);
  expect((await accounts()).some((a) => a._id === cashId)).toBe(false);
});

test("merging two entries on the server keeps one and repoints its bookmark, and unmerging puts them back", async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "e@x" }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  let n = 0;
  const op = (kind: Op["kind"], args: unknown): Op => ({ id: `op${++n}`, kind, args, at: n });
  const apply = (...ops: Op[]) => as.mutation(api.sync.apply, { ops });
  await apply(op("settings.completeOnboarding", { currency: "USD" }));
  const cashId = ((await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[]).find((a) => a.name === "Cash")!._id;
  const food = ((await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.name === "Food")!._id;
  const entry = { type: "expense", date: "2026-03-04", accountId: cashId, categoryId: food, amount: 700, tags: [], photoIds: [] };
  await apply(op("transactions.create", { ...entry, note: "Lunch" }), op("transactions.create", { ...entry, note: "", tags: ["work"] }));
  const txs = async () => (await as.query(api.sync.table, { table: "transactions" })) as Doc<"transactions">[];
  const [lunch, other] = await txs();
  await apply(op("bookmarks.create", { template: { type: "expense", accountId: cashId, categoryId: food, amount: 700, note: "", tags: [] }, transactionId: other._id }));

  const [res] = await apply(op("transactions.merge", { keepId: lunch._id, removeId: other._id }));
  expect(res.status).toBe("applied");
  expect((await txs()).map((x) => [x._id, x.note, x.tags])).toEqual([[lunch._id, "Lunch", ["work"]]]);
  const bookmarks = async () => (await as.query(api.sync.table, { table: "bookmarks" })) as Doc<"bookmarks">[];
  expect((await bookmarks())[0].transactionId).toBe(lunch._id);

  // undone later: both entries are back as they were, and the bookmark is on the one it was made from
  const [undo] = await apply(op("transactions.unmerge", { id: lunch._id }));
  expect(undo.status).toBe("applied");
  const after = await txs();
  expect(after.map((x) => [x.note, x.tags, x.merged]).sort()).toEqual([["", ["work"], undefined], ["Lunch", [], undefined]]);
  expect((await bookmarks())[0].transactionId).toBe(after.find((x) => x.note === "")!._id);
});
