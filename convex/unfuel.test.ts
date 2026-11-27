/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

/** A user who has finished setup (rupees), with a payment method and an expense category to send fill-ups to. */
async function setup(currency = "INR") {
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  const t = convexTest(schema, modules);
  const user = async (email: string) => {
    const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
    const as = t.withIdentity({ subject: `${userId}|s` });
    await as.mutation(api.sync.apply, { ops: [{ id: `${email}-onboard`, kind: "settings.completeOnboarding", args: { currency }, at: 1 }] });
    const [account] = (await as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[];
    const categories = (await as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[];
    const category = categories.find((c) => c.type === "expense" && !c.parentId)!;
    const income = categories.find((c) => c.type === "income" && !c.parentId)!;
    const entries = () => t.run((ctx) => ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect());
    return { userId, as, account, category, income, entries };
  };
  const post = (url: string, body: unknown) => t.fetch(new URL(url).pathname, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { t, user, post };
}

/** What Unfuel's server sends (its convex/unmoney.ts). */
const fillUp = (over: Record<string, unknown> = {}) => ({
  v: 1, source: "unfuel", ref: "k971t4mbtx298d31bnmzv6hcns8k17n5", amount: "1000.00", currency: "INR", date: "2026-11-27", time: "18:04",
  note: "Fuel", description: "9.72 L petrol · My vehicle · Indian Oil · Sri Sai Fuel Station", category: "Fuel", ...over,
});

test("a fill-up posted to the link becomes an expense where the link says, once", async () => {
  const { user, post } = await setup();
  const a = await user("a@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  expect(url).toMatch(/^https:\/\/example\.convex\.site\/unfuel\/[A-Za-z0-9_-]{43}$/);

  const res = await post(url, fillUp());
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("Added to UnMoney.");
  const [entry] = await a.entries();
  expect(entry).toMatchObject({
    type: "expense", date: "2026-11-27", time: "18:04", amount: 100_000, accountId: a.account._id, categoryId: a.category._id,
    note: "Fuel", description: "9.72 L petrol · My vehicle · Indian Oil · Sri Sai Fuel Station", tags: [], photoIds: [],
  });
  // the entry has a change number, so every device's copy picks it up like any other
  expect(entry.rev).toBeGreaterThan(0);

  // Unfuel retries a post whose reply it never got: the same fill-up adds nothing
  const again = await post(url, fillUp({ amount: "1200.00" }));
  expect(again.status).toBe(200);
  expect(await again.text()).toBe("Already in UnMoney.");
  expect(await a.entries()).toHaveLength(1);
  expect(await a.as.query(api.unfuel.linkStatus, {})).toMatchObject({ received: 1, accountId: a.account._id, categoryId: a.category._id });

  // another fill-up is another entry
  expect((await post(url, fillUp({ ref: "another_fill-up", amount: "550.5", time: null }))).status).toBe(200);
  const entries = await a.entries();
  expect(entries).toHaveLength(2);
  expect(entries.find((e) => e.amount === 55_050)?.time).toBeUndefined();
});

test("a link that was never made, was turned off or was replaced adds nothing", async () => {
  const { user, post } = await setup();
  const a = await user("a@x");
  const where = { accountId: a.account._id, categoryId: a.category._id };
  expect((await post("https://example.convex.site/unfuel/not-a-real-token-at-all", fillUp())).status).toBe(401);
  expect((await post("https://example.convex.site/unfuel/", fillUp())).status).toBe(401);

  const first = await a.as.action(api.unfuel.createLink, where);
  const second = await a.as.action(api.unfuel.createLink, where);
  expect((await post(first.url, fillUp())).status).toBe(401);
  expect((await post(second.url, fillUp())).status).toBe(200);

  await a.as.mutation(api.unfuel.revokeLink, {});
  expect(await a.as.query(api.unfuel.linkStatus, {})).toBeNull();
  expect((await post(second.url, fillUp({ ref: "after" }))).status).toBe(401);
  expect(await a.entries()).toHaveLength(1);
});

test("a body that is not a fill-up is refused whole", async () => {
  const { user, post } = await setup();
  const a = await user("a@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  const bad: unknown[] = [
    "not json", "[]", "null", fillUp({ v: 2 }), fillUp({ source: "someone-else" }), fillUp({ ref: "" }), fillUp({ ref: "has spaces" }), fillUp({ ref: "x".repeat(65) }),
    fillUp({ amount: 1000 }), fillUp({ amount: "-5" }), fillUp({ amount: "1,000.00" }), fillUp({ amount: "abc" }), fillUp({ currency: "rupees" }),
    fillUp({ date: "27/11/2026" }), fillUp({ date: "2026-02-31" }), fillUp({ date: "2026-27-11" }),
  ];
  for (const body of bad) expect((await post(url, body)).status, JSON.stringify(body)).toBe(400);
  expect((await post(url, fillUp({ amount: "0" }))).status).toBe(400);
  expect((await post(url, "x".repeat(10_001))).status).toBe(413);
  expect(await a.entries()).toEqual([]);
});

test("long or odd text is cut and cleaned, never trusted", async () => {
  const { user, post } = await setup();
  const a = await user("a@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  await post(url, fillUp({ note: `  ${"n".repeat(100)}  `, description: `line one\nline two ${"d".repeat(300)}`, time: "25:99" }));
  const [entry] = await a.entries();
  expect(entry.note).toHaveLength(60);
  expect(entry.description).toHaveLength(200);
  expect(entry.description).not.toContain("\n");
  expect(entry.time).toBeUndefined();
  // no note at all still files under something
  await post(url, fillUp({ ref: "no-note", note: 42, description: null }));
  expect((await a.entries()).find((e) => e.note === "Fuel" && !e.description)).toBeDefined();
});

test("a fill-up in another currency is refused with the reason, not guessed at a rate", async () => {
  const { user, post } = await setup("USD");
  const a = await user("a@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  const res = await post(url, fillUp());
  expect(res.status).toBe(422);
  expect(await res.text()).toBe("This fill-up is in INR and your UnMoney is in USD.");
  expect(await a.entries()).toEqual([]);
  // dollars and cents land as cents
  expect((await post(url, fillUp({ currency: "USD", amount: "45.5" }))).status).toBe(200);
  expect((await a.entries())[0].amount).toBe(4550);
});

test("the link's entries can only go to the user's own payment method and expense category", async () => {
  const { user } = await setup();
  const a = await user("a@x"), b = await user("b@x");
  await expect(a.as.action(api.unfuel.createLink, { accountId: b.account._id, categoryId: a.category._id })).rejects.toThrow(/payment method/);
  await expect(a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: b.category._id })).rejects.toThrow(/expense category/);
  await expect(a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.income._id })).rejects.toThrow(/expense category/);
  expect(await a.as.query(api.unfuel.linkStatus, {})).toBeNull();

  await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  await expect(a.as.mutation(api.unfuel.setTarget, { accountId: b.account._id, categoryId: a.category._id })).rejects.toThrow(/payment method/);
  await expect(b.as.mutation(api.unfuel.setTarget, { accountId: b.account._id, categoryId: b.category._id })).rejects.toThrow(/Make a link first/);
});

test("one user's link never touches another's ledger, and changing where entries go keeps the link", async () => {
  const { user, post } = await setup();
  const a = await user("a@x"), b = await user("b@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  await b.as.action(api.unfuel.createLink, { accountId: b.account._id, categoryId: b.category._id });
  await post(url, fillUp());
  expect(await a.entries()).toHaveLength(1);
  expect(await b.entries()).toEqual([]);

  const other = ((await a.as.query(api.sync.table, { table: "categories" })) as Doc<"categories">[]).find((c) => c.type === "expense" && !c.parentId && c._id !== a.category._id)!;
  await a.as.mutation(api.unfuel.setTarget, { accountId: a.account._id, categoryId: other._id });
  expect((await post(url, fillUp({ ref: "second" }))).status).toBe(200);
  expect((await a.entries()).map((e) => e.categoryId).sort()).toEqual([a.category._id, other._id].sort());
});

test("a deleted payment method refuses the fill-up with what to do; once fixed, the same fill-up goes through", async () => {
  const { user, post } = await setup();
  const a = await user("a@x");
  const { url } = await a.as.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id });
  await a.as.mutation(api.sync.apply, { ops: [{ id: "del", kind: "accounts.remove", args: { id: a.account._id }, at: 2 }] });
  const res = await post(url, fillUp());
  expect(res.status).toBe(422);
  expect(await res.text()).toMatch(/could not add it: .*More › Unfuel/);
  expect(await a.entries()).toEqual([]);

  const next = ((await a.as.query(api.sync.table, { table: "accounts" })) as Doc<"accounts">[]).find((x) => !x.deletedAt && x._id !== a.account._id)!;
  await a.as.mutation(api.unfuel.setTarget, { accountId: next._id, categoryId: a.category._id });
  expect((await post(url, fillUp())).status).toBe(200);
  expect((await a.entries())[0].accountId).toBe(next._id);
});

test("signed out, there is no link to see or make", async () => {
  const { t, user } = await setup();
  const a = await user("a@x");
  expect(await t.query(api.unfuel.linkStatus, {})).toBeNull();
  await expect(t.action(api.unfuel.createLink, { accountId: a.account._id, categoryId: a.category._id })).rejects.toThrow(/Not signed in/);
  await expect(t.mutation(api.unfuel.revokeLink, {})).rejects.toThrow(/Not signed in/);
});
