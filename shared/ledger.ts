/**
 * The ledger rules: how a transaction counts toward income, expense and transfer totals,
 * and how it moves account balances. Shared by Convex queries and the React views so every
 * screen agrees. All amounts are integer minor units.
 */
import { type ISODate, parts, addMonths, make, clampDay, todayISO } from "./dates";

export type TxLike = {
  _id: string;
  type: "income" | "expense" | "transfer";
  date: ISODate;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  amount: number;
  feeAmount?: number;
};

export type AccountLike = {
  _id: string;
  groupId?: string;
  kind?: string;
  initialBalance: number;
  includeInTotals: boolean;
  hidden: boolean;
  transferAsExpense: boolean;
  billingAccountId?: string;
  settlementDay?: number;
  paymentDay?: number;
  linkedAccountId?: string;
  deletedAt?: number;
};

/** Only legacy groups have a kind; it is the fallback for accounts that predate per-account kinds. */
export type GroupLike = { _id: string; kind?: string };

export type LedgerSettings = { cardExpenseDisplay: "atTime" | "lumpSum" };

export type Kinds = { income: number; expense: number; transfer: number };

/** Accounts in the context always carry a kind, resolved by resolveKind. */
export type Ctx = {
  accounts: Map<string, AccountLike & { kind: string }>;
  settings: LedgerSettings;
};

/** An account's kind: its own, or for an account not migrated yet, its group's old kind. */
export function resolveKind(a: { kind?: string; groupId?: string }, groups: Map<string, GroupLike> | GroupLike[]): string {
  if (a.kind) return a.kind;
  if (!a.groupId) return "other";
  const g = Array.isArray(groups) ? groups.find((x) => x._id === a.groupId) : groups.get(a.groupId);
  return g?.kind ?? "other";
}

export function buildCtx(accounts: AccountLike[], groups: GroupLike[], settings: LedgerSettings): Ctx {
  const byId = new Map(groups.map((g) => [g._id, g]));
  return {
    accounts: new Map(accounts.map((a) => [a._id, { ...a, kind: resolveKind(a, byId) }])),
    settings,
  };
}

export function kindOf(ctx: Ctx, accountId: string | undefined): string | undefined {
  return accountId ? ctx.accounts.get(accountId)?.kind : undefined;
}

export function isCreditCard(ctx: Ctx, accountId: string | undefined): boolean {
  return kindOf(ctx, accountId) === "card";
}

/**
 * Methods whose spending comes out of another account: debit cards, and UPIs that are linked to
 * a bank account (an unlinked UPI holds its own balance, like a wallet).
 */
export function drawsFromLinked(a: { kind?: string; linkedAccountId?: string }): boolean {
  return a.kind === "debitCard" || (a.kind === "upi" && !!a.linkedAccountId);
}

/** How a transaction counts in income / expense / transfer totals for the ledger, stats and budgets. */
export function kindsOf(tx: TxLike, ctx: Ctx): Kinds {
  const k: Kinds = { income: 0, expense: 0, transfer: 0 };
  const lump = ctx.settings.cardExpenseDisplay === "lumpSum";
  if (tx.type === "income") {
    k.income = tx.amount;
  } else if (tx.type === "expense") {
    if (lump && isCreditCard(ctx, tx.accountId)) {
      k.transfer = tx.amount; // counted when the card is paid
    } else {
      k.expense = tx.amount;
    }
  } else {
    const to = tx.toAccountId ? ctx.accounts.get(tx.toAccountId) : undefined;
    if (to?.transferAsExpense || (lump && isCreditCard(ctx, tx.toAccountId))) {
      k.expense = tx.amount;
    } else {
      k.transfer = tx.amount;
    }
    if (tx.feeAmount) k.expense += tx.feeAmount;
  }
  return k;
}

export function sumKinds(txs: TxLike[], ctx: Ctx): Kinds {
  const total: Kinds = { income: 0, expense: 0, transfer: 0 };
  for (const tx of txs) {
    const k = kindsOf(tx, ctx);
    total.income += k.income;
    total.expense += k.expense;
    total.transfer += k.transfer;
  }
  return total;
}

/** The account that actually holds the money for a transaction (debit cards hit their linked account). */
export function holderOf(ctx: Ctx, accountId: string): string {
  const a = ctx.accounts.get(accountId);
  if (a && drawsFromLinked(a) && a.linkedAccountId) return a.linkedAccountId;
  return accountId;
}

/**
 * Balance of every account from its initial balance plus its transactions, up to and including
 * `upTo` when given: entries dated later (installments, a scheduled entry already added) have not
 * happened yet. With `from`, only entries after that date count and no initial balance does, which
 * gives what is still to come.
 */
export function computeBalances(txs: TxLike[], ctx: Ctx, upTo?: ISODate, from?: ISODate): Map<string, number> {
  const bal = new Map<string, number>();
  for (const a of ctx.accounts.values()) bal.set(a._id, from ? 0 : a.initialBalance);
  const add = (id: string, delta: number) => bal.set(id, (bal.get(id) ?? 0) + delta);
  for (const tx of txs) {
    if (upTo && tx.date > upTo) continue;
    if (from && tx.date <= from) continue;
    if (tx.type === "income") add(holderOf(ctx, tx.accountId), tx.amount);
    else if (tx.type === "expense") add(holderOf(ctx, tx.accountId), -tx.amount);
    else {
      add(holderOf(ctx, tx.accountId), -tx.amount - (tx.feeAmount ?? 0));
      if (tx.toAccountId) add(holderOf(ctx, tx.toAccountId), tx.amount);
    }
  }
  return bal;
}

/** Monthly usage shown on a debit card row: this calendar month's spending on the card. */
export function debitMonthlyUsage(accountId: string, txs: TxLike[], today: ISODate = todayISO()): number {
  const { y, m } = parts(today);
  const from = make(y, m, 1);
  const to = addMonths(from, 1);
  let used = 0;
  for (const tx of txs) {
    if (tx.accountId !== accountId || tx.date < from || tx.date >= to) continue;
    if (tx.type === "expense") used += tx.amount;
    if (tx.type === "transfer") used += tx.amount + (tx.feeAmount ?? 0);
  }
  return used;
}

/** Start of the current billing cycle for a card with settlement day S: the latest date with day S that is <= today. */
export function cycleStart(settlementDay: number, today: ISODate = todayISO()): ISODate {
  const { y, m, d } = parts(today);
  const s = clampDay(y, m, settlementDay);
  if (d >= s) return make(y, m, s);
  const prev = addMonths(make(y, m, 1), -1);
  const p = parts(prev);
  return make(p.y, p.m, clampDay(p.y, p.m, settlementDay));
}

/** Balance payable (previous cycles, net of payments) and outstanding (current cycle) for a credit card. */
export function cardStatus(
  account: AccountLike,
  balance: number,
  txs: TxLike[],
  today: ISODate = todayISO(),
): { payable: number; outstanding: number; owed: number } {
  const owed = Math.max(0, -balance);
  const start = cycleStart(account.settlementDay ?? 1, today);
  let outstanding = 0;
  for (const tx of txs) {
    // charges dated after today (later installments) are upcoming, not outstanding
    if (tx.accountId !== account._id || tx.date < start || tx.date > today) continue;
    if (tx.type === "expense") outstanding += tx.amount;
    if (tx.type === "transfer") outstanding += tx.amount + (tx.feeAmount ?? 0);
  }
  let payable = owed - outstanding;
  if (payable < 0) {
    outstanding = Math.max(0, outstanding + payable);
    payable = 0;
  }
  return { payable, outstanding, owed };
}

/** Next payment date for a card. */
export function nextPaymentDate(paymentDay: number, today: ISODate = todayISO()): ISODate {
  const { y, m, d } = parts(today);
  const p = clampDay(y, m, paymentDay);
  if (d <= p) return make(y, m, p);
  const next = addMonths(make(y, m, 1), 1);
  const n = parts(next);
  return make(n.y, n.m, clampDay(n.y, n.m, paymentDay));
}
