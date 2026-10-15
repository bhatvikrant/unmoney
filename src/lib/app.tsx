import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { buildCtx, type Ctx as LedgerCtx } from "../../shared/ledger";
import { formatMoney } from "../../shared/money";
import { applyTheme } from "./theme";

export type Settings = Doc<"settings">;
export type AccountRow = ReturnType<typeof useAccountsQuery>["accounts"][number];

function useAccountsQuery() {
  const data = useQuery(api.accounts.list);
  return { ...(data ?? { groups: [], accounts: [], assets: 0, liabilities: 0, total: 0 }), loading: data === undefined };
}

type AppData = {
  settings: Settings;
  user: { name?: string; email?: string; image?: string } | null;
  accounts: AccountRow[];
  accountGroups: ReturnType<typeof useAccountsQuery>["groups"];
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
  const acc = useAccountsQuery();
  const groups = useQuery(api.accountGroups.list, { includeDeleted: true }) ?? [];
  const categories = useQuery(api.categories.list, { includeDeleted: true }) ?? [];
  const currencies = useQuery(api.currencies.list) ?? [];

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
    const ledger = buildCtx(acc.accounts, groups, settings);
    const fmtBase = { symbol: settings.symbol, symbolPosition: settings.symbolPosition, decimals: settings.decimals };
    return {
      settings,
      user,
      accounts: acc.accounts,
      accountGroups: acc.groups,
      accountsSummary: { assets: acc.assets, liabilities: acc.liabilities, total: acc.total },
      loading: acc.loading,
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
  }, [acc, groups, categories, currencies, settings, user]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppDataProvider");
  return v;
}

export function useCatchUpRepeats() {
  const catchUp = useMutation(api.repeats.catchUp);
  useEffect(() => {
    catchUp({}).catch(() => {});
  }, [catchUp]);
}
