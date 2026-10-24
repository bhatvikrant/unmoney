/** Dev-only: fill a user with demo data. `npx convex run seed:demo '{"email":"you@example.com"}'` */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { insertSynced } from "./lib/changes";
import { addDays, addMonths, make, parts, todayISO } from "../shared/dates";

export const demo = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
    if (!user) throw new Error("No user with that email");
    const userId = user._id;
    const groups = await ctx.db.query("accountGroups").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    /** A default group by name, if the user still has it. */
    const g = (name: string) => groups.find((x) => x.name === name && !x.deletedAt)?._id;
    const cats = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect();
    const inc = await ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect();
    const c = (name: string) => cats.find((x) => x.name === name && !x.parentId)!._id;
    const i = (name: string) => inc.find((x) => x.name === name)!._id;
    const existing = await ctx.db.query("accounts").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const byName = (n: string) => existing.find((a) => a.name === n)?._id;
    const acc = async (name: string, kind: string, groupId: Id<"accountGroups"> | undefined, extra: Record<string, unknown> = {}, initial = 0) =>
      byName(name) ?? (await insertSynced(ctx, userId, "accounts", { groupId, kind, name, initialBalance: initial, includeInTotals: true, hidden: false, order: existing.length + 10, transferAsExpense: false, ...extra } as never));
    const cash = await acc("Cash", "cash", g("Cash"), {}, 12000);
    const bank = await acc("Bank", "bank", g("Bank accounts"), {}, 250000);
    const hibd = await acc("HIBD", "bank", g("Bank accounts"), {}, 480000);
    const card = await acc("Card", "card", g("Credit cards"), { billingAccountId: bank, settlementDay: 1, paymentDay: 15 });
    const travel = await acc("HIBD Travel", "card", g("Credit cards"), { billingAccountId: hibd, settlementDay: 15, paymentDay: 28 });
    const debit = await acc("RBO Debit Card", "debitCard", g("Debit cards"), { linkedAccountId: hibd });
    const saving = await acc("RBO Saving", "savings", undefined, { transferAsExpense: true }, 10000);
    const loan = await acc("Car loan", "loan", undefined, {}, -1200000);
    await acc("GPay", "upi", g("UPIs"), { linkedAccountId: hibd });
    // subcategories
    const eating = await insertSynced(ctx, userId, "categories", { type: "expense", name: "Eating out", parentId: c("Food"), order: 100 });
    await insertSynced(ctx, userId, "categories", { type: "expense", name: "Groceries", parentId: c("Food"), order: 101 });
    const fuel = await insertSynced(ctx, userId, "categories", { type: "expense", name: "Fuel", parentId: c("Transport"), order: 102 });
    await insertSynced(ctx, userId, "currencies", { code: "EUR", name: "Euro", symbol: "€", rate: 0.92, decimals: 2, symbolPosition: "before", isCustom: false, order: 0 });

    const today = todayISO();
    const { y, m } = parts(today);
    const tx = (t: Record<string, unknown>) => insertSynced(ctx, userId, "transactions", { tags: [], photoIds: [], note: "", ...t } as never);
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
    const notes = ["Coffee", "Lunch", "Groceries", "Uber", "Netflix", "Pharmacy", "Gym", "Books", "Dinner with Sam", "Haircut", "Shoes", "Train"];
    const catFor: Record<string, Id<"categories">> = { Coffee: c("Food"), Lunch: c("Food"), Groceries: c("Food"), Uber: c("Transport"), Netflix: c("Culture"), Pharmacy: c("Health"), Gym: c("Health"), Books: c("Education"), "Dinner with Sam": c("Social Life"), Haircut: c("Beauty"), Shoes: c("Apparel"), Train: c("Transport") };
    for (let back = 5; back >= 0; back--) {
      const first = addMonths(make(y, m, 1), -back);
      const p = parts(first);
      await tx({ type: "income", date: make(p.y, p.m, 1), accountId: bank, categoryId: i("Salary"), amount: 420000, note: "Salary" });
      await tx({ type: "transfer", date: make(p.y, p.m, 2), accountId: bank, toAccountId: saving, amount: 50000, note: "Monthly saving" });
      await tx({ type: "transfer", date: make(p.y, p.m, 5), accountId: bank, toAccountId: loan, amount: 35000, note: "Loan repayment" });
      await tx({ type: "expense", date: make(p.y, p.m, 3), accountId: bank, categoryId: c("Household"), amount: 120000, note: "Rent" });
      await tx({ type: "transfer", date: make(p.y, p.m, 4), accountId: bank, toAccountId: cash, amount: 20000, feeAmount: 150, note: "ATM" });
      const days = back === 0 ? Math.min(parts(today).d, 28) : 28;
      for (let k = 0; k < 18; k++) {
        const n = notes[rnd(notes.length)];
        const accounts = [cash, card, debit, bank, travel];
        const a = accounts[rnd(accounts.length)];
        const amt = 300 + rnd(6000);
        const d = make(p.y, p.m, 1 + rnd(days));
        if (d > today) continue;
        await tx({ type: "expense", date: d, accountId: a, categoryId: catFor[n], subcategoryId: n === "Lunch" || n === "Coffee" ? eating : n === "Uber" ? fuel : undefined, amount: amt, note: n, tags: n === "Coffee" ? ["coffee"] : [] });
      }
      if (back > 0) {
        const n = parts(addMonths(first, 1));
        await tx({ type: "transfer", date: make(n.y, n.m, 15), accountId: bank, toAccountId: card, amount: 30000, note: "Card payment" });
      }
    }
    await tx({ type: "expense", date: addDays(today, -3), accountId: card, categoryId: c("Food"), amount: 2175, subAmount: 2000, subCurrency: "EUR", exchangeRate: 0.92, note: "Paris café", description: "Sub-currency test" });
    await tx({ type: "expense", date: today, accountId: cash, categoryId: c("Food"), amount: -1250, note: "Split bill refund", description: "Negative = rebate" });
    // installment: 3 months from last month
    const start = addMonths(today, -1);
    const repId = await insertSynced(ctx, userId, "repeats", { kind: "installment", frequency: "monthly", startDate: start, nextDate: addMonths(start, 2), installmentCount: 3, template: { type: "expense", accountId: card, categoryId: c("Household"), amount: 30000, note: "IKEA wardrobe", tags: [] }, active: false });
    for (let k = 0; k < 3; k++) await tx({ type: "expense", date: addMonths(start, k), accountId: card, categoryId: c("Household"), amount: 10000, note: "IKEA wardrobe", repeatId: repId, installmentIndex: k + 1, installmentCount: 3, installmentTotal: 30000 });
    await insertSynced(ctx, userId, "repeats", { kind: "repeat", frequency: "monthly", startDate: make(y, m, 20), nextDate: make(y, m, 20) > today ? make(y, m, 20) : make(y, m + 1 > 12 ? 1 : m + 1, 20), template: { type: "expense", accountId: card, categoryId: c("Culture"), amount: 1599, note: "Spotify", tags: ["subscription"] }, active: true });
    await insertSynced(ctx, userId, "bookmarks", { order: 0, template: { type: "expense", accountId: cash, categoryId: c("Food"), subcategoryId: eating, amount: 450, note: "Coffee", tags: ["coffee"] } });
    await insertSynced(ctx, userId, "bookmarks", { order: 1, template: { type: "transfer", accountId: bank, toAccountId: cash, amount: 20000, note: "ATM", tags: [], feeAmount: 150 } });
    await insertSynced(ctx, userId, "budgets", { period: "monthly", amount: 250000, overrides: {} });
    await insertSynced(ctx, userId, "budgets", { categoryId: c("Food"), period: "monthly", amount: 40000, overrides: {} });
    await insertSynced(ctx, userId, "budgets", { categoryId: c("Transport"), period: "monthly", amount: 15000, overrides: {} });
    await insertSynced(ctx, userId, "budgets", { categoryId: c("Culture"), period: "monthly", amount: 5000, overrides: {} });
    await insertSynced(ctx, userId, "notes", { date: today, text: "Payday next week, keep eating out low.", color: "#3b82f6" });
    await insertSynced(ctx, userId, "notes", { date: addDays(today, -6), text: "Dentist", color: "#ef4444" });
    return "ok";
  },
});
