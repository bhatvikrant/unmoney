/** Spreadsheet exports as plain 2D arrays. src/lib/xlsx.ts writes them to .xlsx files. */
import type { Snapshot } from "./ops";
import { byDateDesc, settingsOf } from "./views";
import { toMajor } from "./money";

export type Cell = string | number | boolean | Date | null;
export type SheetRows = Cell[][];

/** A date + optional time as a wall-clock Date (UTC fields hold the local wall time, as Excel has no zone). */
function when(date: string, time?: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0));
}

/**
 * The layout of Money Manager's own Excel export, so the file imports back into Money Manager (and into UnMoney).
 * Transfers are written twice, as Transfer-Out and a mirrored Transfer-In. A transfer fee becomes its own expense row
 * so balances stay right.
 */
export function moneyManagerSheet(snap: Snapshot): SheetRows {
  const decimals = settingsOf(snap)?.decimals ?? 2;
  const main = settingsOf(snap)?.mainCurrency ?? "";
  const acc = new Map(snap.accounts.map((a) => [a._id, a.name]));
  const cat = new Map(snap.categories.map((c) => [c._id, c.name]));
  const cur = new Map(snap.currencies.map((c) => [c.code, c.decimals]));
  const rows: SheetRows = [["Period", "Accounts", "Category", "Subcategory", "Note", main, "Income/Expense", "Description", "Amount", "Currency", "Accounts"]];
  for (const t of [...snap.transactions].sort(byDateDesc)) {
    const at = when(t.date, t.time);
    const amount = toMajor(t.amount, decimals);
    const foreign = t.subAmount !== undefined && t.subCurrency;
    const orig = foreign ? toMajor(t.subAmount!, cur.get(t.subCurrency!) ?? decimals) : amount;
    const origCur = foreign ? t.subCurrency! : main;
    const line = (type: string, account: string, category: string, sub: string, note = t.note): Cell[] =>
      [at, account, category, sub, note || null, amount, type, t.description ?? null, orig, origCur, amount];
    const from = acc.get(t.accountId) ?? "";
    if (t.type === "transfer") {
      const to = t.toAccountId ? acc.get(t.toAccountId) ?? "" : "";
      rows.push(line("Transfer-In", to, from, ""), line("Transfer-Out", from, to, ""));
      if (t.feeAmount) {
        const fee = toMajor(t.feeAmount, decimals);
        rows.push([at, from, "Transfer Fee", null, t.note ? `Fee: ${t.note}` : "Transfer fee", fee, "Exp.", null, fee, main, fee]);
      }
    } else {
      rows.push(line(t.type === "income" ? "Income" : "Exp.", from, t.categoryId ? cat.get(t.categoryId) ?? "" : "", t.subcategoryId ? cat.get(t.subcategoryId) ?? "" : ""));
    }
  }
  return rows;
}

/** Everything in the app, one sheet per kind of data. Entries keep fees, tags, rates and recurrence. */
export function completeSheets(snap: Snapshot): { sheet: string; data: SheetRows }[] {
  const s = settingsOf(snap);
  const decimals = s?.decimals ?? 2;
  const major = (n: number | undefined) => (n === undefined ? null : toMajor(n, decimals));
  const acc = new Map(snap.accounts.map((a) => [a._id, a.name]));
  const cat = new Map(snap.categories.map((c) => [c._id, c.name]));
  const grp = new Map(snap.accountGroups.map((g) => [g._id, g]));
  const cur = new Map(snap.currencies.map((c) => [c.code, c.decimals]));
  const repeatOf = new Map(snap.repeats.map((r) => [r._id, r]));
  const name = (m: Map<string, string>, id?: string) => (id ? m.get(id) ?? null : null);
  const typeLabel = (t: string) => (t === "income" ? "Income" : t === "expense" ? "Expense" : "Transfer");

  const transactions: SheetRows = [["Date", "Time", "Type", "Account", "Category / To account", "Subcategory", "Note", "Description", "Amount", "Sub amount", "Sub currency", "Exchange rate", "Fee", "Tags", "Repeat", "Installment", "Installment total", "Bookmarked"]];
  const bookmarked = new Set(snap.bookmarks.map((b) => b.transactionId).filter(Boolean));
  for (const t of [...snap.transactions].sort(byDateDesc)) {
    const r = t.repeatId ? repeatOf.get(t.repeatId) : undefined;
    transactions.push([
      when(t.date), t.time ?? null, typeLabel(t.type), name(acc, t.accountId),
      t.type === "transfer" ? name(acc, t.toAccountId) : name(cat, t.categoryId), name(cat, t.subcategoryId),
      t.note || null, t.description ?? null, major(t.amount),
      t.subAmount === undefined ? null : toMajor(t.subAmount, cur.get(t.subCurrency ?? "") ?? decimals), t.subCurrency ?? null, t.exchangeRate ?? null,
      major(t.feeAmount), t.tags.join(" ") || null, r ? r.frequency : null,
      t.installmentIndex && t.installmentCount ? `${t.installmentIndex}/${t.installmentCount}` : null, major(t.installmentTotal), bookmarked.has(t._id),
    ]);
  }

  const accounts: SheetRows = [["Account", "Group", "Group type", "Opening balance", "Include in totals", "Hidden", "Transfer as expense", "Billing account", "Settlement day", "Payment day", "Linked account", "Description", "Deleted"]];
  for (const a of snap.accounts) {
    const g = grp.get(a.groupId);
    accounts.push([a.name, g?.name ?? null, g?.kind ?? null, major(a.initialBalance), a.includeInTotals, a.hidden, a.transferAsExpense, name(acc, a.billingAccountId), a.settlementDay ?? null, a.paymentDay ?? null, name(acc, a.linkedAccountId), a.description ?? null, !!a.deletedAt]);
  }

  const categories: SheetRows = [["Type", "Category", "Parent category", "Deleted"]];
  for (const c of snap.categories) categories.push([c.type === "income" ? "Income" : "Expense", c.name, name(cat, c.parentId), !!c.deletedAt]);

  const budgets: SheetRows = [["Category", "Period", "Amount", "Overrides (period start = amount)"]];
  for (const b of snap.budgets) {
    budgets.push([b.categoryId ? name(cat, b.categoryId) : "Total", b.period, major(b.amount), Object.entries(b.overrides).map(([k, v]) => `${k}=${toMajor(v, decimals)}`).join("; ") || null]);
  }

  const repeats: SheetRows = [["Kind", "Frequency", "Start", "End", "Next", "Installments", "Active", "Type", "Account", "Category / To account", "Subcategory", "Note", "Amount"]];
  for (const r of snap.repeats) {
    const t = r.template;
    repeats.push([r.kind, r.frequency, when(r.startDate), r.endDate ? when(r.endDate) : null, when(r.nextDate), r.installmentCount ?? null, r.active, typeLabel(t.type), name(acc, t.accountId), t.type === "transfer" ? name(acc, t.toAccountId) : name(cat, t.categoryId), name(cat, t.subcategoryId), t.note || null, major(t.amount)]);
  }

  const notes: SheetRows = [["Date", "Note", "Color"]];
  for (const n of [...snap.notes].sort((a, b) => b.date.localeCompare(a.date))) notes.push([when(n.date), n.text, n.color]);

  const currencies: SheetRows = [["Code", "Name", "Symbol", "Rate to main", "Decimals", "Custom"]];
  for (const c of snap.currencies) currencies.push([c.code, c.name, c.symbol, c.rate, c.decimals, c.isCustom]);

  return [
    { sheet: "Transactions", data: transactions }, { sheet: "Accounts", data: accounts }, { sheet: "Categories", data: categories },
    { sheet: "Budgets", data: budgets }, { sheet: "Repeats", data: repeats }, { sheet: "Notes", data: notes }, { sheet: "Currencies", data: currencies },
  ];
}
