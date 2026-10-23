import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigationType } from "react-router";
import { useConvexAuth } from "@convex-dev/auth/react";
import { AppDataProvider } from "@/lib/app";
import { useStore } from "@/lib/store";
import { settingsOf } from "../shared/views";
import { toast } from "sonner";
import { awayTooLong, clearFailures, clearUnlock, isLocked, markHidden, markUnlocked } from "@/lib/passcode";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import Onboarding from "@/pages/auth/Onboarding";
import Lock from "@/pages/auth/Lock";
import AppShell from "@/components/shell/AppShell";
import LedgerRoute from "@/pages/transactions/LedgerRoute";
import { useMediaQuery, WIDE } from "@/lib/media";
import TransactionEditor from "@/pages/transactions/TransactionEditor";
import { SplitLayout } from "@/components/shell/SplitLayout";

// Only the ledger, the entry form and the shell load with the app. Every other screen is fetched the
// first time it is opened (from the service worker's cache once installed), so a cold start parses a
// fraction of the code. The other tabs' screens are fetched a moment after the ledger is up.
const loadStats = () => import("@/pages/stats/StatsPage");
const loadAccounts = () => import("@/pages/accounts/AccountsPage");
const loadSettings = () => import("@/pages/settings/SettingsPage");
const SignIn = lazy(() => import("@/pages/auth/SignIn"));
const RecapPage = lazy(() => import("@/pages/recap/RecapPage"));
const RecapsPage = lazy(() => import("@/pages/recap/RecapsPage"));
const SearchPage = lazy(() => import("@/pages/transactions/SearchPage"));
const BookmarksPage = lazy(() => import("@/pages/transactions/BookmarksPage"));
const NotesPage = lazy(() => import("@/pages/transactions/NotesPage"));
const UnsplitReturn = lazy(() => import("@/pages/transactions/UnsplitReturn"));
const StatsPage = lazy(loadStats);
const CategoryDetail = lazy(() => import("@/pages/stats/CategoryDetail"));
const BudgetPage = lazy(() => import("@/pages/stats/BudgetPage"));
const BudgetSettings = lazy(() => import("@/pages/stats/BudgetSettings"));
const AccountsPage = lazy(loadAccounts);
const AccountDetail = lazy(() => import("@/pages/accounts/AccountDetail"));
const AccountEditor = lazy(() => import("@/pages/accounts/AccountEditor"));
const AccountOrder = lazy(() => import("@/pages/accounts/AccountOrder"));
const SettingsPage = lazy(loadSettings);
const CategoriesSettings = lazy(() => import("@/pages/settings/CategoriesSettings"));
const CategoryTidyUp = lazy(() => import("@/pages/settings/CategoryTidyUp"));
const CurrencySettings = lazy(() => import("@/pages/settings/CurrencySettings"));
const SubCurrencySettings = lazy(() => import("@/pages/settings/SubCurrencySettings"));
const RepeatSettings = lazy(() => import("@/pages/settings/RepeatSettings"));
const PasscodeSettings = lazy(() => import("@/pages/settings/PasscodeSettings"));
const PeriodSettings = lazy(() => import("@/pages/settings/PeriodSettings"));
const StyleSettings = lazy(() => import("@/pages/settings/StyleSettings"));
const BackupSettings = lazy(() => import("@/pages/settings/BackupSettings"));
const ImportPage = lazy(() => import("@/pages/settings/ImportPage"));
const AccountGroupSettings = lazy(() => import("@/pages/settings/AccountGroupSettings"));
const DeletedAccounts = lazy(() => import("@/pages/settings/DeletedAccounts"));
const TransferExpenseSettings = lazy(() => import("@/pages/settings/TransferExpenseSettings"));
const PaymentMethodsSettings = lazy(() => import("@/pages/settings/PaymentMethodsSettings"));
const PreferencesSettings = lazy(() => import("@/pages/settings/PreferencesSettings"));
const GmailSettings = lazy(() => import("@/pages/settings/GmailSettings"));
const GmailReviewPage = lazy(() => import("@/pages/transactions/GmailReviewPage"));
const UpcomingPage = lazy(() => import("@/pages/transactions/UpcomingPage"));
const PrivacyPage = lazy(() => import("@/pages/legal/PrivacyPage"));

/**
 * Shown while there is nothing to show yet. The text waits a moment: a warm start is over before it
 * could be read, and a flash of "Loading…" between the splash and the ledger reads as a stutter.
 */
function Splash({ text = "Loading…", delay = 400 }: { text?: string; delay?: number }) {
  const [show, setShow] = useState(!delay);
  useEffect(() => {
    if (!delay) return;
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground">{show ? text : null}</div>;
}

/** First load on this device needs the server once; after that the local copy is used. */
function FirstFetch() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return <Splash delay={0} text={slow ? "Connecting… UnMoney needs a connection the first time it loads on a device." : "Loading your data…"} />;
}

/**
 * The passcode lock: asked for on a fresh load and again after the app has been in the
 * background for longer than the chosen time. A forgotten passcode is removed once the user has
 * signed in with Google again (see Lock).
 */
function usePasscodeLock(settings: ReturnType<typeof settingsOf>) {
  const { status } = useStore();
  const hasPin = !!(settings?.passcodeHash && settings.passcodeSalt);
  const lockAfter = settings?.lockAfter ?? "always";
  // Unlocked from the start when the last unlock is within the window (a reload, the update toast's
  // reload, a restored tab): otherwise the window running out mid-use would drop the lock screen over a half-typed entry.
  const [unlocked, setUnlocked] = useState(() => !isLocked(lockAfter));
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
  // the other tabs' code, once the ledger has had a moment to settle, so the first tap on them is instant
  useEffect(() => {
    const t = setTimeout(() => { void loadStats(); void loadAccounts(); void loadSettings(); }, 1500);
    return () => clearTimeout(t);
  }, []);
  if (!settings?.onboarded) return <Onboarding />;
  const s = settings;
  // Replaces the app rather than covering it: an open dialog would otherwise sit on top of the lock.
  if (lock.locked) return <Lock hash={s.passcodeHash!} salt={s.passcodeSalt!} resetRequested={lock.resetRequested} onUnlock={lock.unlock} />;
  return (
    <AppDataProvider settings={s} user={user}>
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
          <Route path="gmail" element={<SplitLayout list={<GmailReviewPage />} label="Entry" width={440} keyParams={["draft"]} />}>
            <Route path="t/new" element={<TransactionEditor />} />
            <Route path="t/:id" element={<TransactionEditor />} />
          </Route>
          {/* back from UnSplit with the expense it made from entries chosen here */}
          <Route path="unsplit/return" element={<UnsplitReturn />} />
          <Route path="recaps" element={<RecapsPage />} />
          <Route path="upcoming" element={<UpcomingPage />} />
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
            <Route path="gmail" element={<GmailSettings />} />
          </Route>
          <Route path="import" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppDataProvider>
  );
}

export default function App() {
  // Above every early return, so the privacy page, sign-in and onboarding get it too.
  // One Suspense boundary for every lazy screen: navigating is a transition, so a screen still
  // loading leaves the current one up rather than flashing the splash.
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Splash />}>
        <Screens />
      </Suspense>
    </>
  );
}

function Screens() {
  const { ready, hasLocal, status } = useStore();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { pathname } = useLocation();
  // public, signed in or not: Google's verification links to it
  if (pathname === "/privacy") return <PrivacyPage />;
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

const SCROLL_KEY = "unmoney:scroll";
function readScrolls(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "{}"); } catch { return {}; }
}

/**
 * A new page starts at the top; back/forward returns to where that page was left. On a wide screen,
 * opening or switching items beside a list leaves the list where it was.
 */
function ScrollToTop() {
  const location = useLocation();
  const { pathname, key } = location;
  const navType = useNavigationType();
  const isWide = useMediaQuery(WIDE);
  // Read through a ref so crossing the breakpoint doesn't count as a page change.
  const wide = useRef(isWide);
  useLayoutEffect(() => { wide.current = isWide; }, [isWide]);
  const prev = useRef(pathname);
  const keyRef = useRef(key);
  const scrolls = useRef<Record<string, number>>(readScrolls());

  // The browser's own restoration runs before the new page has rendered, so it lands in the wrong place.
  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  }, []);

  // Remember each entry's position as it scrolls: by the time the route changes, the old page is gone.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      scrolls.current[keyRef.current] = window.scrollY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrolls.current)); } catch { /* storage unavailable */ }
      }, 200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);

  useLayoutEffect(() => {
    keyRef.current = key;
    const section = splitSectionOf(prev.current);
    prev.current = pathname;
    if (wide.current && section && section === splitSectionOf(pathname)) return;
    const target = navType === "POP" ? scrolls.current[key] ?? 0 : 0;
    window.scrollTo(0, target);
    if (!target) return;
    // The page may still be growing (charts, long lists); keep trying for a moment until it is tall enough.
    let frame = 0;
    let tries = 0;
    const retry = () => {
      if (Math.abs(window.scrollY - target) < 2 || ++tries > 30) return;
      window.scrollTo(0, target);
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    const stop = () => cancelAnimationFrame(frame);
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });
    return () => {
      stop();
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [key, pathname, navType]);
  return null;
}
