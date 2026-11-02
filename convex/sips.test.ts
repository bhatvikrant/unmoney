/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Op } from "../shared/ops";

const modules = import.meta.glob("./**/*.ts");

/** A signed-in user who finished onboarding and connected Gmail, with Convex's real per-transaction limits enforced. */
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
  await t.run((ctx) => ctx.db.insert("gmailConnections", {
    userId, email: "me@gmail.com", refreshTokenEnc: "enc", iv: "iv", status: "ok", lookbackDays: 30, senders: ["groww.in"], scanPurchases: true, accountMap: {}, aiMonth: "2026-10", aiCalls: 0, log: [],
  }));
  let m = 0;
  const insert = (date: string, note: string, amount: number, extra: Record<string, unknown> = {}) => ({
    source: "gmail" as const, messageId: `msg${++m}`, extraMessageIds: [], threadId: "t", receivedAt: Date.parse(`${date}T10:00:00Z`), from: "Groww <noreply@groww.in>", subject: "SIP instalment processed",
    proposal: { type: "expense" as const, date, amount, note, accountId: bank._id }, confidence: "high" as const, how: "rule" as const, ...extra,
  });
  /** A Gmail check that found these debits: drafts, written as the real check writes them. */
  const check = (inserts: ReturnType<typeof insert>[], at = Date.parse("2026-11-02T10:00:00Z")) =>
    t.mutation(internal.gmail.writeSync, { userId, startedAt: at, inserts, updates: [], matches: [], learned: {}, aiCalls: 0, scanned: inserts.length });
  const drafts = () => t.run((ctx) => ctx.db.query("drafts").withIndex("by_user", (q) => q.eq("userId", userId)).collect());
  /** Save a draft as the user would from the review list. */
  const accept = async (d: Doc<"drafts">) => {
    await apply("drafts.accept", { id: d._id, type: "expense", date: d.proposal.date, amount: d.proposal.amount, note: d.proposal.note, accountId: bank._id, categoryId: other._id, tags: [], photoIds: [] });
    return (await t.run((ctx) => ctx.db.get(d._id)))!.transactionId!;
  };
  const get = (id: Id<"transactions">) => t.run((ctx) => ctx.db.get(id));
  const categoryName = async (id: Id<"categories"> | undefined) => (id ? (await t.run((ctx) => ctx.db.get(id)))?.name : undefined);
  const settings = async () => (await as.query(api.sync.table, { table: "settings" }) as Doc<"settings">[])[0];
  return { t, as, apply, userId, bank, other, insert, check, drafts, accept, get, categoryName, settings };
}

test("on the server: accepting a SIP saves its waiting drafts, and the next Gmail check saves its new debit by itself", async () => {
  const { apply, insert, check, drafts, accept, get, categoryName, settings } = await setup();
  await check([insert("2026-08-08", "Groww", 1000000), insert("2026-09-10", "Groww", 1000000), insert("2026-10-12", "Groww", 1000000)]);
  const [aug, sep, oct] = await drafts();
  const saved = await accept(aug);
  await apply("sips.create", { name: "Flexi", transactionIds: [saved], draftIds: [sep._id, oct._id], draftDates: [sep.proposal.date, oct.proposal.date], rhythm: "monthly" });
  const sip = (await settings()).sips![0];
  expect(sip).toMatchObject({ name: "Flexi", rhythm: "monthly", amount: 1000000, lastDate: "2026-10-12", accountId: aug.proposal.accountId });
  const after = await drafts();
  expect(after.map((d) => d.status)).toEqual(["accepted", "accepted", "accepted"]);
  for (const d of after) expect((await get(d.transactionId!))!.sipId).toBe(sip.id);

  // Sun 8 Nov: the bank debits on Mon 9, and the check that reads it saves it straight into the SIP
  await check([insert("2026-11-09", "Groww", 1000000), insert("2026-11-09", "Swiggy", 45000, { from: "HDFC <alerts@hdfcbank.net>", subject: "Alert" })], Date.parse("2026-11-10T10:00:00Z"));
  const nov = (await drafts()).filter((d) => d.proposal.date === "2026-11-09");
  const groww = nov.find((d) => d.proposal.note === "Groww")!;
  expect(groww.status).toBe("accepted");
  const entry = (await get(groww.transactionId!))!;
  expect(entry.sipId).toBe(sip.id);
  expect(entry.source).toEqual({ app: "gmail", messageId: groww.messageId });
  expect(await categoryName(entry.categoryId)).toBe("Investments");
  // a debit no SIP takes waits for the user as before
  expect(nov.find((d) => d.proposal.note === "Swiggy")!.status).toBe("open");
});

test("a check saves nothing for a cancelled SIP, or a debit flagged as an entry already typed", async () => {
  const { apply, insert, check, drafts, accept, settings, bank, other } = await setup();
  await check([insert("2026-09-10", "Groww", 1000000)]);
  const saved = await accept((await drafts())[0]);
  await apply("sips.create", { name: "Flexi", transactionIds: [saved] });
  // typed by hand, then the mail for it arrives flagged as "maybe already added"
  const typed = await apply("transactions.create", { type: "expense", date: "2026-10-10", accountId: bank._id, categoryId: other._id, amount: 1000000, note: "Groww", tags: [], photoIds: [] });
  const typedId = Object.values(typed.status === "applied" ? typed.idMap : {})[0] as Id<"transactions">;
  await check([insert("2026-10-10", "Groww", 1000000, { matchedTransactionId: typedId })], Date.parse("2026-10-11T10:00:00Z"));
  expect((await drafts()).at(-1)!.status).toBe("open");
  await apply("sips.update", { id: (await settings()).sips![0].id, stopped: true });
  await check([insert("2026-11-10", "Groww", 1000000)], Date.parse("2026-11-11T10:00:00Z"));
  expect((await drafts()).at(-1)!.status).toBe("open");
});

test("a device following changes gets the SIP on settings and the filed entries, and no table it might not know", async () => {
  const { as, apply, insert, check, drafts, accept } = await setup();
  const since = (await as.query(api.sync.head, {}))!;
  await check([insert("2026-09-10", "Groww", 1000000), insert("2026-10-10", "Groww", 1000000)]);
  const [sep, oct] = await drafts();
  const id = await accept(sep);
  await apply("sips.create", { name: "Flexi", transactionIds: [id], draftIds: [oct._id], draftDates: [oct.proposal.date] });
  const changes = await as.query(api.sync.changes, { since });
  expect(changes && !changes.reset).toBe(true);
  if (!changes || changes.reset) return;
  expect(Object.keys(changes.docs).sort()).toEqual(["categories", "drafts", "settings", "transactions"]);
  const sipId = changes.docs.settings![0].sips![0].id;
  expect(changes.docs.transactions!.every((t) => t.sipId === sipId)).toBe(true);
});

test("removing a SIP stays within Convex's read limit on a ledger past it", async () => {
  const { t, apply, insert, check, drafts, accept, get, userId, bank, other, settings } = await setup();
  // past the 32,000 documents one function may read: removing must not load the whole ledger
  for (let start = 0; start < 33_000; start += 10_000) {
    await t.run(async (ctx) => {
      for (let i = start; i < Math.min(33_000, start + 10_000); i++) {
        await ctx.db.insert("transactions", { userId, type: "expense", date: `20${10 + (i % 16)}-0${1 + (i % 9)}-1${i % 10}`, accountId: bank._id, categoryId: other._id, amount: 100, note: "Tea", tags: [], photoIds: [] });
      }
    });
  }
  await check([insert("2026-09-05", "Groww", 500000)]);
  const a = await accept((await drafts())[0]);
  await apply("sips.create", { name: "Flexi", transactionIds: [a] });
  await check([insert("2026-10-06", "Groww", 500000)], Date.parse("2026-10-07T10:00:00Z"));
  const b = (await drafts()).at(-1)!.transactionId!;
  expect((await get(b))!.sipId).toBe((await settings()).sips![0].id);
  await apply("sips.remove", { id: (await settings()).sips![0].id });
  expect((await get(a))!.sipId).toBeUndefined();
  expect((await get(b))!.sipId).toBeUndefined();
}, 120_000);
