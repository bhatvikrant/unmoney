import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { type Ctx as LedgerCtx } from "../../shared/ledger";
import { formatMoney } from "../../shared/money";
import { currencyInfo } from "../../shared/currencies";
import { dueRepeats, emptySnapshot } from "../../shared/ops";
import { todayISO } from "../../shared/dates";
import { accountsList, categoriesList, currenciesList, groupsList, ledgerOf, type AccountRow, type AccountGroupRow } from "../../shared/views";
import { useOp, useStore, useView } from "./store";
import { getRates } from "./fxRates";
import { useToday } from "@/lib/today";
import { applyTheme } from "./theme";

export type Settings = Doc<"settings">;
export type { AccountRow };

type AppData = {
  settings: Settings;
  user: { name?: string; email?: string; image?: string } | null;
  accounts: AccountRow[];
  accountGroups: AccountGroupRow[];
  /** Methods the user archived: not in accountGroups or pickers, but their entries and balances still count. */
  archivedAccounts: AccountRow[];
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
  // Only the tables the models below read: an op copies just the tables it touches, so a note, a
  // bookmark, a draft or a history line leaves these as they were and nothing below re-renders for it.
  const { transactions, accounts: accountRows, accountGroups, settings: settingsRows, categories: categoryRows, currencies: currencyRows } = view;
  const core = useMemo(() => ({ ...emptySnapshot(), transactions, accounts: accountRows, accountGroups, settings: settingsRows, categories: categoryRows, currencies: currencyRows }),
    [transactions, accountRows, accountGroups, settingsRows, categoryRows, currencyRows]);
  const acc = useMemo(() => accountsList(core, today), [core, today]);
  const groups = useMemo(() => groupsList(core, true), [core]);
  const categories = useMemo(() => categoriesList(core, true), [core]);
  const currencies = useMemo(() => currenciesList(core), [core]);
  const ledger = useMemo(() => ledgerOf(core), [core]);

  useEffect(() => {
    applyTheme(settings.theme, settings.accent, settings.colorSet);
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme(settings.theme, settings.accent, settings.colorSet);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [settings.theme, settings.accent, settings.colorSet]);

  const value = useMemo<AppData>(() => {
    const accountById = new Map([...acc.accounts, ...acc.system].map((a) => [a._id as string, a]));
    const categoryById = new Map(categories.map((c) => [c._id as string, c]));
    const groupById = new Map(groups.map((g) => [g._id as string, g]));
    const fmtBase = { symbol: settings.symbol, symbolPosition: settings.symbolPosition, decimals: settings.decimals };
    return {
      settings,
      user,
      accounts: acc.accounts,
      accountGroups: acc.groups,
      archivedAccounts: acc.archived,
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
        if (c) return formatMoney(minor, { symbol: c.symbol, symbolPosition: c.symbolPosition, decimals: c.decimals });
        // a sub currency removed since: entries in it still read as money, not "1250 USD"
        const i = currencyInfo(code);
        return i ? formatMoney(minor, { symbol: i.symbol, symbolPosition: i.position ?? "before", decimals: i.decimals }) : `${minor} ${code}`;
      },
      accountName: (id) => (id ? accountById.get(id)?.name ?? "(deleted account)" : ""),
      categoryLabel: (tx) => {
        const c = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
        const s = tx.subcategoryId ? categoryById.get(tx.subcategoryId) : undefined;
        if (!c) return "";
        return s ? `${c.name} / ${s.name}` : c.name;
      },
    };
  }, [acc, groups, categories, currencies, settings, user, ledger]);

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

/**
 * Payment methods used to take their type from their group. Copy it onto any that still lack
 * one, once, as an ordinary op: it works offline and the server runs the same change.
 */
export function useAdoptAccountKinds() {
  const { dispatch, view } = useStore();
  const needed = view.accounts.some((a) => !a.kind);
  useEffect(() => {
    if (needed) dispatch("accounts.adoptKinds", {}).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed]);
}

/**
 * Fetch the latest rates (reusing a recent fetch) and store the ones that moved on the sub currencies,
 * so new entries pick them up. Custom currencies are never touched, and neither are saved entries:
 * each keeps the rate it was saved with.
 */
export function useRefreshRates() {
  const { settings, currencies } = useApp();
  const setRates = useOp("currencies.setRates");
  const base = settings.mainCurrency;
  const latest = useRef({ base, currencies });
  useEffect(() => { latest.current = { base, currencies }; }, [base, currencies]);
  return useCallback(async (opts?: { maxAge?: number; force?: boolean }) => {
    const fx = await getRates(base, opts);
    // Only rates we just reached go into the ledger: saved ones may be older than what another device stored.
    if (!fx || fx.fallback || fx.base !== latest.current.base) return fx;
    const rates = latest.current.currencies
      .filter((c) => !c.isCustom && fx.rates[c.code] > 0 && fx.rates[c.code] !== c.rate)
      .map((c) => ({ id: c._id, rate: fx.rates[c.code] }));
    if (rates.length) await setRates({ rates }).catch(() => {});
    return fx;
  }, [base, setRates]);
}

/** Keep sub currency rates current: on start, when the main currency changes, and when the app comes back online or into view. */
export function useAutoRefreshRates() {
  const { currencies } = useApp();
  const refresh = useRefreshRates();
  const needed = currencies.some((c) => !c.isCustom);
  useEffect(() => {
    if (!needed) return;
    const run = () => void refresh();
    const online = () => void refresh({ force: true });
    const visible = () => { if (document.visibilityState === "visible") run(); };
    run();
    window.addEventListener("online", online);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [needed, refresh]);
}
