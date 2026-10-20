/**
 * What a draft imports as from the "From Gmail" list, where one tap imports every selected draft
 * without opening each one. A gap the mail left is filled the way the entry form would: the
 * user's default payment method, and their "Other" category of the right type. The list shows
 * what was filled in, so the user can open the row and change it first. Pure, for tests.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { TxFields } from "../ops";

export type Filled = "method" | "category";
export type Importable = { fields: TxFields; filled: Filled[] };

type Ctx = {
  accounts: Pick<Doc<"accounts">, "_id" | "hidden" | "archivedAt" | "deletedAt" | "order">[];
  categories: Pick<Doc<"categories">, "_id" | "name" | "type" | "parentId" | "archivedAt" | "deletedAt" | "order">[];
  currencies: { code: string; decimals: number }[];
  decimals: number;
  defaultAccountId?: Id<"accounts">;
};

const live = <T extends { archivedAt?: number; deletedAt?: number }>(x: T) => !x.archivedAt && !x.deletedAt;

/** The method a new entry starts on: the chosen default while it is usable, else the first visible one. */
export function fallbackAccount(ctx: Pick<Ctx, "accounts" | "defaultAccountId">): Id<"accounts"> | undefined {
  const visible = ctx.accounts.filter((a) => live(a) && !a.hidden).sort((a, b) => a.order - b.order);
  return (visible.find((a) => a._id === ctx.defaultAccountId) ?? visible[0])?._id;
}

/** The catch-all category of a type: a top-level one named "Other", else the last top-level one. */
export function fallbackCategory(ctx: Pick<Ctx, "categories">, type: "income" | "expense"): Id<"categories"> | undefined {
  const top = ctx.categories.filter((c) => live(c) && c.type === type && !c.parentId).sort((a, b) => a.order - b.order);
  return (top.find((c) => c.name.trim().toLowerCase() === "other") ?? top[top.length - 1])?._id;
}

/**
 * The entry a draft imports as, with what had to be filled in; null when it cannot be imported
 * without the form (no amount, or a transfer that lacks one of its two methods).
 */
export function importable(d: Pick<Doc<"drafts">, "proposal">, ctx: Ctx): Importable | null {
  const p = d.proposal;
  if (!p.amount || p.amount <= 0) return null;
  const filled: Filled[] = [];
  const usable = (id?: Id<"accounts">) => !!id && ctx.accounts.some((a) => a._id === id && live(a));
  const usableCat = (id?: Id<"categories">) => !!id && ctx.categories.some((c) => c._id === id && live(c));
  let accountId = usable(p.accountId) ? p.accountId : undefined;
  if (p.type === "transfer") {
    if (!accountId || !usable(p.toAccountId) || accountId === p.toAccountId) return null;
  } else if (!accountId) {
    accountId = fallbackAccount(ctx);
    if (!accountId) return null;
    filled.push("method");
  }
  let categoryId: Id<"categories"> | undefined;
  let subcategoryId: Id<"categories"> | undefined;
  if (p.type !== "transfer") {
    if (usableCat(p.categoryId)) {
      categoryId = p.categoryId;
      subcategoryId = usableCat(p.subcategoryId) ? p.subcategoryId : undefined;
    } else {
      categoryId = fallbackCategory(ctx, p.type);
      if (!categoryId) return null;
      filled.push("category");
    }
  }
  const cur = p.subCurrency ? ctx.currencies.find((c) => c.code === p.subCurrency) : undefined;
  const exchangeRate = cur && p.subAmount ? (p.subAmount / 10 ** cur.decimals) / (p.amount / 10 ** ctx.decimals) : undefined;
  return {
    filled,
    fields: {
      type: p.type, date: p.date, time: p.time, accountId: accountId!, toAccountId: p.type === "transfer" ? p.toAccountId : undefined,
      categoryId, subcategoryId,
      amount: p.amount, subAmount: cur ? p.subAmount : undefined, subCurrency: cur ? cur.code : undefined, exchangeRate,
      note: p.note, description: p.description, tags: [], photoIds: [],
    },
  };
}
