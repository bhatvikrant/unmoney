import { useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppDataProvider } from "@/lib/app";
import { isLocked } from "@/lib/passcode";
import SignIn from "@/pages/auth/SignIn";
import Onboarding from "@/pages/auth/Onboarding";
import Lock from "@/pages/auth/Lock";
import AppShell from "@/components/shell/AppShell";
import TransactionsPage from "@/pages/transactions/TransactionsPage";
import TransactionEditor from "@/pages/transactions/TransactionEditor";
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
import CurrencySettings from "@/pages/settings/CurrencySettings";
import SubCurrencySettings from "@/pages/settings/SubCurrencySettings";
import RepeatSettings from "@/pages/settings/RepeatSettings";
import PasscodeSettings from "@/pages/settings/PasscodeSettings";
import PeriodSettings from "@/pages/settings/PeriodSettings";
import StyleSettings from "@/pages/settings/StyleSettings";
import BackupSettings from "@/pages/settings/BackupSettings";
import AccountGroupSettings from "@/pages/settings/AccountGroupSettings";
import DeletedAccounts from "@/pages/settings/DeletedAccounts";
import TransferExpenseSettings from "@/pages/settings/TransferExpenseSettings";

function Splash() {
  return <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
}

function Gate() {
  const data = useQuery(api.settings.get);
  const [unlocked, setUnlocked] = useState(false);
  if (data === undefined) return <Splash />;
  if (!data.settings?.onboarded) return <Onboarding />;
  const s = data.settings;
  if (s.passcodeHash && s.passcodeSalt && !unlocked && isLocked(s.lockAfter)) {
    return <Lock hash={s.passcodeHash} salt={s.passcodeSalt} onUnlock={() => setUnlocked(true)} />;
  }
  return (
    <AppDataProvider settings={s} user={data.user}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<TransactionsPage />} />
          <Route path="t/new" element={<TransactionEditor />} />
          <Route path="t/:id" element={<TransactionEditor />} />
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
          <Route path="settings/currency" element={<CurrencySettings />} />
          <Route path="settings/sub-currencies" element={<SubCurrencySettings />} />
          <Route path="settings/repeats" element={<RepeatSettings />} />
          <Route path="settings/passcode" element={<PasscodeSettings />} />
          <Route path="settings/period" element={<PeriodSettings />} />
          <Route path="settings/style" element={<StyleSettings />} />
          <Route path="settings/backup" element={<BackupSettings />} />
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
  return (
    <>
      <AuthLoading><Splash /></AuthLoading>
      <Unauthenticated><SignIn /></Unauthenticated>
      <Authenticated><Gate /></Authenticated>
    </>
  );
}
