import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useConvexAuth } from "@convex-dev/auth/react";
import { AppDataProvider } from "@/lib/app";
import { useStore } from "@/lib/store";
import { settingsOf } from "../shared/views";
import { toast } from "sonner";
import { awayTooLong, clearFailures, clearUnlock, isLocked, markHidden, markUnlocked } from "@/lib/passcode";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import SignIn from "@/pages/auth/SignIn";
import Onboarding from "@/pages/auth/Onboarding";
import Lock from "@/pages/auth/Lock";
import AppShell from "@/components/shell/AppShell";
import RecapPage from "@/pages/recap/RecapPage";
import RecapsPage from "@/pages/recap/RecapsPage";
import LedgerRoute from "@/pages/transactions/LedgerRoute";
import { useMediaQuery, WIDE } from "@/lib/media";
import SearchPage from "@/pages/transactions/SearchPage";
import TransactionEditor from "@/pages/transactions/TransactionEditor";
import { SplitLayout } from "@/components/shell/SplitLayout";
import BookmarksPage from "@/pages/transactions/BookmarksPage";
import NotesPage from "@/pages/transactions/NotesPage";
import StatsPage from "@/pages/stats/StatsPage";
import CategoryDetail from "@/pages/stats/CategoryDetail";
import BudgetPage from "@/pages/stats/BudgetPage";
import BudgetSettings from "@/pages/stats/BudgetSettings";
import AccountsPage from "@/pages/accounts/AccountsPage";
import AccountDetail from "@/pages/accounts/AccountDetail";
import AccountEditor from "@/pages/accounts/AccountEditor";
import AccountOrder from "@/pages/accounts/AccountOrder";
import SettingsPage from "@/pages/settings/SettingsPage";
import CategoriesSettings from "@/pages/settings/CategoriesSettings";
import CategoryTidyUp from "@/pages/settings/CategoryTidyUp";
import CurrencySettings from "@/pages/settings/CurrencySettings";
import SubCurrencySettings from "@/pages/settings/SubCurrencySettings";
import RepeatSettings from "@/pages/settings/RepeatSettings";
import PasscodeSettings from "@/pages/settings/PasscodeSettings";
import PeriodSettings from "@/pages/settings/PeriodSettings";
import StyleSettings from "@/pages/settings/StyleSettings";
import BackupSettings from "@/pages/settings/BackupSettings";
import ImportPage from "@/pages/settings/ImportPage";
import AccountGroupSettings from "@/pages/settings/AccountGroupSettings";
import DeletedAccounts from "@/pages/settings/DeletedAccounts";
import TransferExpenseSettings from "@/pages/settings/TransferExpenseSettings";
import PaymentMethodsSettings from "@/pages/settings/PaymentMethodsSettings";
import PreferencesSettings from "@/pages/settings/PreferencesSettings";

function Splash({ text = "Loading…" }: { text?: string }) {
  return <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground">{text}</div>;
}

/** First load on this device needs the server once; after that the local copy is used. */
function FirstFetch() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return <Splash text={slow ? "Connecting… UnMoney needs a connection the first time it loads on a device." : "Loading your data…"} />;
}

/**
 * The passcode lock: asked for on a fresh load and again after the app has been in the
 * background for longer than the chosen time. A forgotten passcode is removed once the user has
 * signed in with Google again (see Lock).
 */
function usePasscodeLock(settings: ReturnType<typeof settingsOf>) {
  const { status } = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const hasPin = !!(settings?.passcodeHash && settings.passcodeSalt);
  const lockAfter = settings?.lockAfter ?? "always";
  const resetRequested = hasPin && !!settings?.passcodeResetRequestedAt;

  // "Forgot it?": the server removes the passcode once this is a session begun after the request,
  // i.e. after a real Google sign-in. The lock stays until then; nothing here unlocks on its own.
  const resetPasscode = useMutation(api.passcode.resetAfterSignIn);
  const asked = useRef(false);
  useEffect(() => {
    if (!resetRequested || !status.live || asked.current) return;
    asked.current = true;
    resetPasscode().then(
      (r) => {
        if (r !== "reset") return;
        clearFailures();
        markUnlocked();
        toast.success("Passcode removed. You can set a new one in Settings › Passcode.");
      },
      () => { asked.current = false; },
    );
  }, [resetRequested, status.live, resetPasscode]);

  useEffect(() => {
    if (!hasPin) return;
    const onChange = () => {
      if (document.visibilityState === "hidden") markHidden();
      else if (awayTooLong(lockAfter)) {
        clearUnlock();
        setUnlocked(false);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [hasPin, lockAfter]);

  const locked = hasPin && !unlocked && isLocked(lockAfter);
  return { locked, unlock: () => setUnlocked(true), resetRequested };
}

function Gate() {
  const { view, user } = useStore();
  const settings = settingsOf(view);
  const lock = usePasscodeLock(settings);
  if (!settings?.onboarded) return <Onboarding />;
  const s = settings;
  // Replaces the app rather than covering it: an open dialog would otherwise sit on top of the lock.
  if (lock.locked) return <Lock hash={s.passcodeHash!} salt={s.passcodeSalt!} resetRequested={lock.resetRequested} onUnlock={lock.unlock} />;
  return (
    <AppDataProvider settings={s} user={user}>
      <ScrollToTop />
      <Routes>
        {/* full screen, beside the shell: no sidebar or tab bar behind the story cards */}
        <Route path="recap/:key" element={<RecapPage />} />
        <Route element={<AppShell />}>
          <Route index element={<LedgerRoute />} />
          <Route path="t/new" element={<LedgerRoute />} />
          <Route path="t/:id" element={<LedgerRoute />} />
          {/* On a wide screen each list opens its items in a panel beside it (SplitLayout); on a phone they are screens of their own. */}
          <Route path="search" element={<SplitLayout list={<SearchPage />} label="Entry" width={440} />}>
            <Route path="t/new" element={<TransactionEditor />} />
            <Route path="t/:id" element={<TransactionEditor />} />
          </Route>
          <Route path="bookmarks" element={<SplitLayout list={<BookmarksPage />} label="Entry" width={440} keyParams={["bookmark"]} />}>
            <Route path="t/new" element={<TransactionEditor />} />
            <Route path="t/:id" element={<TransactionEditor />} />
          </Route>
          <Route path="notes" element={<NotesPage />} />
          <Route path="recaps" element={<RecapsPage />} />
          <Route path="stats" element={<SplitLayout list={<StatsPage />} label="Category" />}>
            <Route path="c/:id" element={<CategoryDetail />} />
          </Route>
          <Route path="budget" element={<SplitLayout list={<BudgetPage />} label="Budget settings" />}>
            <Route path="settings" element={<BudgetSettings />} />
          </Route>
          <Route path="payment-methods" element={<SplitLayout list={<AccountsPage />} label="Payment method" />}>
            <Route path="new" element={<AccountEditor />} />
            <Route path="order" element={<AccountOrder />} />
            <Route path=":id" element={<AccountDetail />} />
            <Route path=":id/edit" element={<AccountEditor />} />
          </Route>
          <Route path="accounts/*" element={<Moved from="/accounts" to="/payment-methods" />} />
          <Route path="settings" element={<SplitLayout list={<SettingsPage />} label="Setting" />}>
            <Route path="categories" element={<CategoriesSettings />} />
            <Route path="categories/tidy" element={<CategoryTidyUp />} />
            <Route path="currency" element={<CurrencySettings />} />
            <Route path="sub-currencies" element={<SubCurrencySettings />} />
            <Route path="repeats" element={<RepeatSettings />} />
            <Route path="passcode" element={<PasscodeSettings />} />
            <Route path="period" element={<PeriodSettings />} />
            <Route path="style" element={<StyleSettings />} />
            <Route path="backup" element={<BackupSettings />} />
            <Route path="groups" element={<AccountGroupSettings />} />
            <Route path="deleted-payment-methods" element={<DeletedAccounts />} />
            <Route path="account-groups" element={<Navigate to="/settings/groups" replace />} />
            <Route path="deleted-accounts" element={<Navigate to="/settings/deleted-payment-methods" replace />} />
            <Route path="transfer-expense" element={<TransferExpenseSettings />} />
            <Route path="payment-methods" element={<PaymentMethodsSettings />} />
            <Route path="preferences" element={<PreferencesSettings />} />
          </Route>
          <Route path="import" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppDataProvider>
  );
}

export default function App() {
  const { ready, hasLocal, status } = useStore();
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (!ready) return <Splash />;
  // A copy of the ledger on this device: use it, whatever the network is doing.
  if (hasLocal) {
    if (!isAuthenticated && !isLoading) return <SignIn />;
    return <Gate />;
  }
  if (isLoading) return <Splash />;
  if (!isAuthenticated) return <SignIn />;
  if (!status.live) return <FirstFetch />;
  return <Gate />;
}

/** An old address (bookmarks, the installed app's history) sent on to where that page lives now. */
function Moved({ from, to }: { from: string; to: string }) {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`${to}${pathname.slice(from.length)}${search}${hash}`} replace />;
}

/** Lists that open their items beside them on a wide screen (the ledger and the SplitLayout routes). */
const SPLIT_SECTIONS = ["/search", "/bookmarks", "/stats", "/budget", "/payment-methods", "/settings"];
function splitSectionOf(pathname: string): string | undefined {
  if (pathname === "/" || pathname.startsWith("/t/")) return "/";
  return SPLIT_SECTIONS.find((s) => pathname === s || pathname.startsWith(`${s}/`));
}

/**
 * Every page change, including back/forward, starts at the top; except, on a wide screen, opening
 * or switching items beside a list, which stays where it was.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const wide = useMediaQuery(WIDE);
  const prev = useRef(pathname);
  useLayoutEffect(() => {
    const section = splitSectionOf(prev.current);
    if (!(wide && section && section === splitSectionOf(pathname))) window.scrollTo(0, 0);
    prev.current = pathname;
  }, [pathname, wide]);
  return null;
}
