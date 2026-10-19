import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useConvexAuth } from "@convex-dev/auth/react";
import { AppDataProvider } from "@/lib/app";
import { useStore } from "@/lib/store";
import { settingsOf } from "../shared/views";
import { toast } from "sonner";
import { awayTooLong, clearPasscodeReset, clearUnlock, isLocked, markHidden, markUnlocked, passcodeResetPendingFor } from "@/lib/passcode";
import SignIn from "@/pages/auth/SignIn";
import Onboarding from "@/pages/auth/Onboarding";
import Lock from "@/pages/auth/Lock";
import AppShell from "@/components/shell/AppShell";
import LedgerRoute from "@/pages/transactions/LedgerRoute";
import { useMediaQuery, WIDE } from "@/lib/media";
import SearchPage from "@/pages/transactions/SearchPage";
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
  const { userId, status, dispatch } = useStore();
  const [unlocked, setUnlocked] = useState(false);
  const hasPin = !!(settings?.passcodeHash && settings.passcodeSalt);
  const lockAfter = settings?.lockAfter ?? "always";
  // `live` means the signed-in user's own data has arrived, so `userId` is theirs, not a predecessor's
  const resetting = hasPin && status.live && passcodeResetPendingFor(userId);

  const resetStarted = useRef(false);
  useEffect(() => {
    if (!resetting || resetStarted.current) return;
    resetStarted.current = true;
    markUnlocked();
    // The request is forgotten only once the removal is queued on this device, so nothing can lose it.
    dispatch("settings.setPasscode", {}).then(
      () => {
        clearPasscodeReset();
        toast.success("Passcode removed. You can set a new one in Settings › Passcode.");
      },
      (e: unknown) => {
        resetStarted.current = false;
        toast.error(`Could not remove the passcode: ${e instanceof Error ? e.message : String(e)}`);
      },
    );
  }, [resetting, dispatch]);

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

  const locked = hasPin && !resetting && !unlocked && isLocked(lockAfter);
  return { locked, unlock: () => setUnlocked(true), userId };
}

function Gate() {
  const { view, user } = useStore();
  const settings = settingsOf(view);
  const lock = usePasscodeLock(settings);
  if (!settings?.onboarded) return <Onboarding />;
  const s = settings;
  // Replaces the app rather than covering it: an open dialog would otherwise sit on top of the lock.
  if (lock.locked) return <Lock hash={s.passcodeHash!} salt={s.passcodeSalt!} userId={lock.userId} onUnlock={lock.unlock} />;
  return (
    <AppDataProvider settings={s} user={user}>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LedgerRoute />} />
          <Route path="t/new" element={<LedgerRoute />} />
          <Route path="t/:id" element={<LedgerRoute />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="bookmarks" element={<BookmarksPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="stats/c/:id" element={<CategoryDetail />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="budget/settings" element={<BudgetSettings />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/new" element={<AccountEditor />} />
          <Route path="accounts/order" element={<AccountOrder />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="accounts/:id/edit" element={<AccountEditor />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/categories" element={<CategoriesSettings />} />
          <Route path="settings/categories/tidy" element={<CategoryTidyUp />} />
          <Route path="settings/currency" element={<CurrencySettings />} />
          <Route path="settings/sub-currencies" element={<SubCurrencySettings />} />
          <Route path="settings/repeats" element={<RepeatSettings />} />
          <Route path="settings/passcode" element={<PasscodeSettings />} />
          <Route path="settings/period" element={<PeriodSettings />} />
          <Route path="settings/style" element={<StyleSettings />} />
          <Route path="settings/backup" element={<BackupSettings />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings/account-groups" element={<AccountGroupSettings />} />
          <Route path="settings/deleted-accounts" element={<DeletedAccounts />} />
          <Route path="settings/transfer-expense" element={<TransferExpenseSettings />} />
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

/**
 * Every page change, including back/forward, starts at the top; except, on a wide screen, opening
 * or switching entries beside the ledger, which stays where it was.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const wide = useMediaQuery(WIDE);
  const prev = useRef(pathname);
  useLayoutEffect(() => {
    const ledger = (p: string) => p === "/" || p.startsWith("/t/");
    if (!(wide && ledger(prev.current) && ledger(pathname))) window.scrollTo(0, 0);
    prev.current = pathname;
  }, [pathname, wide]);
  return null;
}
