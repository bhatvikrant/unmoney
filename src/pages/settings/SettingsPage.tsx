import { Link, useLocation, useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { Bookmark, CalendarClock, ChevronRight, Coins, FileInput, HardDriveDownload, Lock, Mail, Palette, PiggyBank, Repeat, SlidersHorizontal, Sparkles, Tags, WalletCards } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { waitingDrafts } from "../../../shared/views";
import { SyncBadge } from "@/components/shell/SyncStatus";
import { InstallRow } from "./InstallRow";
import { DeleteAccountRow } from "./DeleteAccount";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { clearUnlock } from "@/lib/passcode";
import { Avatar } from "@/components/shell/Avatar";

/**
 * The More tab: a short menu of pages. Each row opens one screen; the settings that used to sit
 * inline here (switches, dropdowns) live on Preferences and Payment methods now, so the menu
 * stays scannable on a phone.
 */
export default function SettingsPage() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { settings: s, user, accounts, categories } = useApp();
  const visibleAccounts = accounts.filter((a) => !a.hidden && !a.archivedAt);
  const { status, clearLocal, view } = useStore();
  const gmail = useQuery(api.gmail.status);
  const waiting = waitingDrafts(view);
  const { signOut } = useAuthActions();
  const confirm = useConfirm();
  // changes that cannot reach the server would be lost with this device's copy: no signing out until they can
  const signOutBlocked = status.pending > 0 && !status.connected;
  async function onSignOut() {
    if (signOutBlocked) return;
    // unsynced changes are lost on sign out, so that case reads as the destructive one
    const ok = await confirm(status.pending > 0
      ? { title: "Sign out anyway?", description: `${status.pending} change${status.pending === 1 ? " has" : "s have"} not reached the server yet and will be lost if you sign out now.`, action: "Sign out" }
      : { title: "Sign out?", description: `Your entries stay safe on the server. This device forgets them until you sign in${user?.email ? ` as ${user.email}` : ""} again.`, action: "Sign out", destructive: false });
    if (!ok) return;
    clearUnlock();
    await clearLocal();
    await signOut();
  }
  /** A menu row. `under`: other pages that belong to this one, so it stays highlighted while one of them is open beside the menu. */
  const link = (icon: ReactNode, label: string, to: string, opts: { value?: string; hint?: string; under?: string[] } = {}) => {
    const active = [to, ...(opts.under ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
    return <Row icon={icon} label={label} value={opts.value} hint={opts.hint} active={active} onClick={() => nav(to)} right={<ChevronRight className="size-4 text-muted-foreground" />} />;
  };
  // nothing until the server has answered (offline, it never does), rather than a wrong "Off"
  const gmailValue = gmail === undefined ? undefined
    : !gmail?.connected ? "Off"
    : gmail.status === "reauth" ? "Reconnect"
    : gmail.status === "paused" ? "Paused"
    : waiting ? `${waiting} to review` : "On";
  return (
    <>
      <PageHeader title="More" />
      <Page className="pb-10">
        <Section>
          <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0">
            <Avatar seed={user?.email || user?.name || ""} src={user?.image} size={48} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{user?.name || user?.email || "Signed in"}</div>
              {user?.name && user.email ? <div className="truncate text-xs text-muted-foreground">{user.email}</div> : null}
              <SyncBadge className="mt-1" />
            </div>
          </div>
          <InstallRow />
        </Section>
        <Section title="Set up">
          {link(<Tags />, "Categories", "/settings/categories", { value: `${categories.filter((c) => !c.parentId && !c.archivedAt && !c.deletedAt).length}` })}
          {link(<WalletCards />, "Payment methods", "/settings/payment-methods", { value: `${visibleAccounts.length}`, hint: "Defaults, groups, order, deleted", under: ["/settings/groups", "/settings/transfer-expense", "/settings/deleted-payment-methods", "/payment-methods/order"] })}
          {link(<Coins />, "Currencies", "/settings/currency", { value: s.mainCurrency, under: ["/settings/sub-currencies"] })}
          {link(<Repeat />, "Repeats", "/settings/repeats", { hint: "Rent, salary, subscriptions" })}
          {link(<PiggyBank />, "Budgets", "/budget/settings")}
          {link(<Bookmark />, "Bookmarks", "/bookmarks", { hint: "Entries you save to add again" })}
        </Section>
        <Section title="Look ahead">
          {link(<CalendarClock />, "Bills & subscriptions", "/upcoming", { hint: "What's due in the next 30 days" })}
        </Section>
        <Section title="Look back">
          {link(<Sparkles />, "Recaps", "/recaps", { hint: "Every month and year as a short story", under: ["/recap"] })}
        </Section>
        <Section title="Preferences">
          {link(<SlidersHorizontal />, "Preferences", "/settings/preferences", { hint: "Period, start screen, entry form", under: ["/settings/period"] })}
          {link(<Palette />, "Style", "/settings/style")}
          {link(<Lock />, "Passcode", "/settings/passcode", { value: s.passcodeHash ? "On" : "Off" })}
        </Section>
        <Section title="Data">
          {link(<HardDriveDownload />, "Backup & export", "/settings/backup")}
          {link(<FileInput />, "Import", "/import", { hint: "Money Manager or a bank statement" })}
          {/* with drafts waiting, the row goes straight to them; their page links to the settings */}
          {link(<Mail />, "Gmail", gmail?.connected && gmail.status !== "reauth" && waiting ? "/gmail" : "/settings/gmail", { value: gmailValue, hint: "Turn money mail into entries", under: ["/gmail", "/settings/gmail"] })}
        </Section>
        <Section title="Account">
          <Row label="Sign out"
            hint={signOutBlocked ? `${status.pending} change${status.pending === 1 ? " is" : "s are"} not saved to the server yet. Go online to sign out.` : "Your entries stay on the server"}
            right={<Button variant="outline" size="sm" disabled={signOutBlocked} onClick={() => void onSignOut()}>Sign out</Button>} />
          <DeleteAccountRow />
        </Section>
        <p className="px-4 pt-6 text-xs text-muted-foreground">UnMoney · works offline and syncs across your devices</p>
        <p className="px-4 pt-1 text-xs text-muted-foreground">
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>
        </p>
        <p className="px-4 pt-1 pb-2 text-xs text-muted-foreground tabular-nums">Version {(import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev"}</p>
      </Page>
    </>
  );
}
