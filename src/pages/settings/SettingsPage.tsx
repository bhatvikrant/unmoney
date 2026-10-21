import { Link, useLocation, useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { Bookmark, CalendarClock, ChevronRight, Coins, FileInput, HardDriveDownload, Lock, Mail, Palette, PiggyBank, Repeat, SlidersHorizontal, Sparkles, Tags, WalletCards } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
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
  const { status, clearLocal } = useStore();
  const gmail = useQuery(api.gmail.status);
  const { signOut } = useAuthActions();
  const confirm = useConfirm();
  async function onSignOut() {
    if (status.pending > 0 && !(await confirm({ title: "Sign out anyway?", description: `${status.pending} change${status.pending === 1 ? " has" : "s have"} not reached the server yet and will be lost if you sign out now.`, action: "Sign out" }))) return;
    clearUnlock();
    await clearLocal();
    await signOut();
  }
  /** A menu row. `under`: other pages that belong to this one, so it stays highlighted while one of them is open beside the menu. */
  const link = (icon: ReactNode, label: string, to: string, opts: { value?: string; hint?: string; under?: string[] } = {}) => {
    const active = [to, ...(opts.under ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
    return <Row icon={icon} label={label} value={opts.value} hint={opts.hint} active={active} onClick={() => nav(to)} right={<ChevronRight className="size-4 text-muted-foreground" />} />;
  };
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
            <Button variant="outline" size="sm" onClick={onSignOut}>Sign out</Button>
          </div>
          <InstallRow />
        </Section>
        <Section title="Set up">
          {link(<Tags />, "Categories", "/settings/categories", { value: `${categories.filter((c) => !c.parentId && !c.archivedAt).length}` })}
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
          {link(<FileInput />, "Import from Money Manager", "/import")}
          {link(<Mail />, "Gmail", "/settings/gmail", { value: gmail?.connected ? gmail.status === "reauth" ? "Reconnect" : gmail.open ? `${gmail.open} to review` : "On" : "Off", hint: "Turn money mail into entries", under: ["/gmail"] })}
        </Section>
        <Section>
          <DeleteAccountRow />
        </Section>
        <p className="px-4 pt-6 text-xs text-muted-foreground">
          UnMoney · works offline and syncs across your devices · <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>
        </p>
      </Page>
    </>
  );
}
