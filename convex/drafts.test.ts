/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Op } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest({ schema, modules });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "a@example.com" }));
  const as = t.withIdentity({ subject: `${userId}|session` });
  let n = 0;
  const apply = async (kind: Op["kind"], args: unknown) => {
    const [r] = await as.mutation(api.sync.apply, { ops: [{ id: `op${++n}`, kind, args, at: Date.now() }] });
    return r;
  };
  await apply("settings.completeOnboarding", { currency: "INR" });
  const accounts = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const categories = (await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[];
  const food = categories.find((c) => c.type === "expense" && c.name === "Food")!;
  const draft = (messageId: string, extra: Partial<Doc<"drafts">> = {}) => t.run((ctx) => ctx.db.insert("drafts", {
    userId, source: "gmail", messageId, extraMessageIds: [], threadId: "t", receivedAt: 1, from: "alerts@hdfcbank.net", subject: "Alert",
    proposal: { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: accounts[0]._id, categoryId: food._id }, confidence: "high", how: "rule", status: "open", ...extra,
  }));
  return { t, as, apply, userId, accounts, food, draft };
}

test("drafts reach the app through the table subscription, and saving one goes through the op pipeline", async () => {
  const { t, as, apply, accounts, food, draft } = await setup();
  const id = await draft("m1");
  const seen = (await as.query(api.sync.table, { table: "drafts" })) as Doc<"drafts">[];
  expect(seen.map((d) => [d._id, d.status])).toEqual([[id, "open"]]);
  const r = await apply("drafts.accept", { id, type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: accounts[0]._id, categoryId: food._id, tags: [], photoIds: [] });
  expect(r.status).toBe("applied");
  const txId = Object.values(r.status === "applied" ? r.idMap : {})[0] as Id<"transactions">;
  const [tx, d] = await t.run(async (ctx) => [await ctx.db.get(txId), await ctx.db.get(id)]);
  expect(tx?.source).toEqual({ app: "gmail", messageId: "m1" });
  expect([d?.status, d?.transactionId]).toEqual(["accepted", txId]);
  // a second device saving the same draft is refused instead of doubling the entry
  const again = await apply("drafts.accept", { id, type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: accounts[0]._id, categoryId: food._id, tags: [], photoIds: [] });
  expect(again.status).toBe("rejected");
});

test("the daily prune removes drafts resolved more than 90 days ago and keeps the rest", async () => {
  const { t, draft } = await setup();
  const now = Date.now();
  const oldAccepted = await draft("m1", { status: "accepted", resolvedAt: now - 1 });
  const oldDismissed = await draft("m2", { status: "dismissed", resolvedAt: now - 1 });
  const recent = await draft("m3", { status: "dismissed", resolvedAt: now + 60_000 });
  const open = await draft("m4");
  await t.mutation(internal.sync.pruneDrafts, { cutoff: now + 1000 });
  const left = await t.run((ctx) => ctx.db.query("drafts").collect());
  expect(left.map((d) => d._id).sort()).toEqual([recent, open].sort());
  expect(left.some((d) => d._id === oldAccepted || d._id === oldDismissed)).toBe(false);
});

test("a draft op loads only the drafts it names, and a merge still finds the draft of the entry it removes", async () => {
  const { t, apply, accounts, food, draft } = await setup();
  const fields = { type: "expense", date: "2026-10-18", amount: 48500, note: "Swiggy", accountId: accounts[0]._id, categoryId: food._id, tags: [], photoIds: [] };
  const [saved, waiting, unwanted] = [await draft("m1"), await draft("m2"), await draft("m3")];
  const get = (id: Id<"drafts">) => t.run((ctx) => ctx.db.get(id));
  expect((await apply("drafts.dismiss", { ids: [unwanted] })).status).toBe("applied");
  // the drafts the op did not name are neither rewritten nor taken for deleted
  expect([(await get(unwanted))?.status, (await get(waiting))?.status, (await get(waiting))?.rev]).toEqual(["dismissed", "open", undefined]);
  const accepted = await apply("drafts.accept", { id: saved, ...fields });
  const made = Object.values(accepted.status === "applied" ? accepted.idMap : {})[0] as Id<"transactions">;
  const typed = await apply("transactions.create", fields);
  const keepId = Object.values(typed.status === "applied" ? typed.idMap : {})[0] as Id<"transactions">;
  expect((await apply("transactions.merge", { keepId, removeId: made })).status).toBe("applied");
  expect((await get(saved))?.transactionId).toBe(keepId);
  // ids that are not a list name no drafts: the op saves nothing, and the batch is not thrown out
  expect((await apply("drafts.acceptMany", { items: "m2" })).status).toBe("applied");
  expect((await get(waiting))?.status).toBe("open");
});
