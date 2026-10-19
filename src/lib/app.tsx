import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { type Ctx as LedgerCtx } from "../../shared/ledger";
import { formatMoney } from "../../shared/money";
import { dueRepeats } from "../../shared/ops";
import { todayISO } from "../../shared/dates";
import { accountsList, categoriesList, currenciesList, groupsList, ledgerOf, type AccountRow, type AccountGroupRow } from "../../shared/views";
import { useStore, useView } from "./store";
import { useToday } from "@/lib/today";
import { applyTheme } from "./theme";

export type Settings = Doc<"settings">;
export type { AccountRow };

type AppData = {
  settings: Settings;
  user: { name?: string; email?: string; image?: string } | null;
  accounts: AccountRow[];
  accountGroups: AccountGroupRow[];
  accountsSummary: { assets: number; liabilities: number; total: number };
  loading: boolean;
  groups: Doc<"accountGroups">[];
  categories: Doc<"categories">[];
  currencies: Doc<"currencies">[];
  ledger: LedgerCtx;
  accountById: Map<string, AccountRow>;
  categoryById: Map<string, Doc<"categories">>;
  groupById: Map<string, Doc<"accountGroups">>;
  fmt: (minor: number, opts?: { sign?: boolean }) => string;
  fmtSub: (minor: number, code: string) => string;
  accountName: (id?: string) => string;
  categoryLabel: (tx: { categoryId?: Id<"categories">; subcategoryId?: Id<"categories"> }) => string;
};

const Ctx = createContext<AppData | null>(null);

export function AppDataProvider({ settings, user, children }: { settings: Settings; user: AppData["user"]; children: ReactNode }) {
  const view = useView();
  // balances count entries up to today, so they move on at midnight as well as on every change
  const today = useToday();
  const acc = useMemo(() => accountsList(view, today), [view, today]);
  const groups = useMemo(() => groupsList(view, true), [view]);
  const categories = useMemo(() => categoriesList(view, true), [view]);
  const currencies = useMemo(() => currenciesList(view), [view]);

  useEffect(() => {
    applyTheme(settings.theme, settings.accent, settings.colorSet);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme(settings.theme, settings.accent, settings.colorSet);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [settings.theme, settings.accent, settings.colorSet]);

  const value = useMemo<AppData>(() => {
    const accountById = new Map(acc.accounts.map((a) => [a._id as string, a]));
    const categoryById = new Map(categories.map((c) => [c._id as string, c]));
    const groupById = new Map(groups.map((g) => [g._id as string, g]));
    const ledger = ledgerOf(view);
    const fmtBase = { symbol: settings.symbol, symbolPosition: settings.symbolPosition, decimals: settings.decimals };
    return {
      settings,
      user,
      accounts: acc.accounts,
      accountGroups: acc.groups,
      accountsSummary: { assets: acc.assets, liabilities: acc.liabilities, total: acc.total },
      loading: false,
      groups,
      categories,
      currencies,
      ledger,
      accountById,
      categoryById,
      groupById,
      fmt: (minor, opts) => formatMoney(minor, fmtBase, opts),
      fmtSub: (minor, code) => {
        const c = currencies.find((x) => x.code === code);
        return c ? formatMoney(minor, { symbol: c.symbol, symbolPosition: c.symbolPosition, decimals: c.decimals }) : `${minor} ${code}`;
      },
      accountName: (id) => (id ? accountById.get(id)?.name ?? "(deleted account)" : ""),
      categoryLabel: (tx) => {
        const c = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
        const s = tx.subcategoryId ? categoryById.get(tx.subcategoryId) : undefined;
        if (!c) return "";
        return s ? `${c.name} / ${s.name}` : c.name;
      },
    };
  }, [acc, groups, categories, currencies, settings, user, view]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppDataProvider");
  return v;
}

/** Add today's scheduled entries on load, locally, so they show even before the server's cron runs. */
export function useCatchUpRepeats() {
  const { dispatch, view } = useStore();
  const today = todayISO();
  const due = dueRepeats(view, today).length > 0;
  useEffect(() => {
    if (due) dispatch("repeats.catchUp", { today }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, today]);
}
