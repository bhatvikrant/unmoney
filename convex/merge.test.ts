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
