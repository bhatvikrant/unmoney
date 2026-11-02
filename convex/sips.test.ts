/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
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
    if (r.status !== "applied") throw new Error(r.error);
    return r;
  };
  await apply("settings.completeOnboarding", { currency: "INR" });
  const accounts = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
  const categories = (await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[];
  const other = categories.find((c) => c.type === "expense" && c.name === "Other")!;
  const bank = accounts.find((a) => a.kind === "bank")!;
  const expense = (date: string, note: string, amount: number) => ({ type: "expense", date, accountId: bank._id, categoryId: other._id, amount, note, tags: [], photoIds: [] });
  const create = async (date: string, note: string, amount: number) => {
    const r = await apply("transactions.create", expense(date, note, amount));
    return Object.values(r.status === "applied" ? r.idMap : {})[0] as Id<"transactions">;
  };
  const get = (id: Id<"transactions">) => t.run((ctx) => ctx.db.get(id));
  const settings = async () => (await as.query(api.sync.table, { table: "settings" }) as Doc<"settings">[])[0];
  return { t, as, apply, userId, bank, other, expense, create, get, settings };
}

test("on the server: a SIP files its payments, files the next one as it is saved, and deleting it puts them all back", async () => {
  const { apply, create, get, settings } = await setup();
  const sep = await create("2026-09-05", "Groww SIP", 500000);
  const r = await apply("sips.create", { name: "Flexi cap", transactionIds: [sep] });
  const sip = (await settings()).sips![0];
  expect(sip).toMatchObject({ name: "Flexi cap", amount: 500000, lastDate: "2026-09-05" });
  expect(r.status).toBe("applied");
  expect((await get(sep))!.sipId).toBe(sip.id);

  // the server's reducer files a new payment by itself, like the device's
  const oct = await create("2026-10-05", "Groww SIP", 550000);
  expect((await get(oct))!.sipId).toBe(sip.id);
  expect((await settings()).sips![0].amount).toBe(550000);
  const rent = await create("2026-10-01", "Rent", 2500000);
  expect((await get(rent))!.sipId).toBeUndefined();

  // the server finds every payment of the SIP through the by_sip index, including one it filed itself
  await apply("sips.remove", { id: sip.id });
  expect((await get(sep))!.sipId).toBeUndefined();
  expect((await get(oct))!.sipId).toBeUndefined();
  expect((await settings()).sips).toBeUndefined();
});

test("a device following changes gets the SIP on settings and the filed entry, and no table it might not know", async () => {
  const { as, apply, create } = await setup();
  const since = (await as.query(api.sync.head, {}))!;
  const id = await create("2026-09-05", "Groww SIP", 500000);
  await apply("sips.create", { name: "Flexi", transactionIds: [id] });
  const changes = await as.query(api.sync.changes, { since });
  expect(changes && !changes.reset).toBe(true);
  if (!changes || changes.reset) return;
  expect(Object.keys(changes.docs).sort()).toEqual(["settings", "transactions"]);
  const sipId = changes.docs.settings![0].sips![0].id;
  expect(changes.docs.transactions!.find((t) => t._id === id)!.sipId).toBe(sipId);
});

test("removing a SIP stays within Convex's read limit on a ledger past it", async () => {
  const { t, apply, create, get, userId, bank, other } = await setup();
  // past the 32,000 documents one function may read: removing must not load the whole ledger
  for (let start = 0; start < 33_000; start += 10_000) {
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(33_000, start + 10_000); i++) {
        await ctx.db.insert("transactions", { userId, type: "expense", date: `20${10 + (i % 16)}-0${1 + (i % 9)}-1${i % 10}`, accountId: bank._id, categoryId: other._id, amount: 100, note: "Tea", tags: [], photoIds: [] });
      }
    });
  }
  const a = await create("2026-09-05", "Groww SIP", 500000);
  await apply("sips.create", { name: "Flexi", transactionIds: [a] });
  const b = await create("2026-10-05", "Groww SIP", 500000);
  const sip = (await get(b))!.sipId!;
  expect(sip).toBeTruthy();
  await apply("sips.remove", { id: sip });
  expect((await get(a))!.sipId).toBeUndefined();
  expect((await get(b))!.sipId).toBeUndefined();
}, 120_000);

test("on the server: a later debit read from Gmail is filed under the SIP when saved, on whichever working day it lands", async () => {
  const { t, apply, create, get, userId, bank, other, settings } = await setup();
  const sep = await create("2026-09-05", "Groww", 500000);
  await apply("sips.create", { name: "Flexi", transactionIds: [sep] });
  const sip = (await settings()).sips![0];
  // Sun 5 Oct: the bank debits on Mon 6, and the mail says so
  const draftId = await t.run((ctx) => ctx.db.insert("drafts", {
    userId, source: "gmail", messageId: "m1", extraMessageIds: [], threadId: "t1", receivedAt: Date.now(), from: "Groww <noreply@groww.in>", subject: "SIP instalment processed",
    proposal: { type: "expense", date: "2026-10-06", amount: 500000, note: "Groww", accountId: bank._id, categoryId: other._id }, confidence: "high", how: "rule", status: "open",
  }));
  await apply("drafts.accept", { id: draftId, type: "expense", date: "2026-10-06", amount: 500000, note: "Groww", accountId: bank._id, categoryId: other._id, tags: [], photoIds: [] });
  const draft = await t.run((ctx) => ctx.db.get(draftId));
  expect((await get(draft!.transactionId!))!.sipId).toBe(sip.id);
});
