import { useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronRight } from "lucide-react";
import { useOp, useStore } from "@/lib/store";
import { SyncBadge } from "@/components/shell/SyncStatus";
import { InstallRow } from "./InstallRow";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { clearUnlock } from "@/lib/passcode";
import { Avatar } from "@/components/shell/Avatar";
import type { Id } from "../../../convex/_generated/dataModel";

export default function SettingsPage() {
  const nav = useNavigate();
  const { settings: s, user, accounts } = useApp();
  const update = useOp("settings.update");
  const setDefaultAccount = useOp("settings.setDefaultAccount");
  const visibleAccounts = accounts.filter((a) => !a.hidden);
  const defaultAccount = visibleAccounts.some((a) => a._id === s.defaultAccountId) ? s.defaultAccountId! : "first";
  const { status, clearLocal } = useStore();
  const { signOut } = useAuthActions();
  async function onSignOut() {
    if (status.pending > 0 && !window.confirm(`${status.pending} change${status.pending === 1 ? " has" : "s have"} not reached the server yet and will be lost if you sign out now. Sign out anyway?`)) return;
    clearUnlock();
    await clearLocal();
    await signOut();
  }
  const link = (label: string, to: string, value?: string, info?: string) => <Row label={label} value={value} info={info} onClick={() => nav(to)} right={<ChevronRight className="size-4 text-muted-foreground" />} />;
  return (
    <>
      <PageHeader title="More" />
      <Page className="pb-10">
        <Section title="Account">
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
        <Section title="Money">
          {link("Main currency", "/settings/currency", s.mainCurrency)}
          {link("Sub currencies", "/settings/sub-currencies", undefined, "Extra currencies you spend in. Each has a rate against your main currency, and amounts are converted with the rate in force when you entered them.")}
          {link("Income / expense categories", "/settings/categories")}
          {link("Budget settings", "/budget/settings")}
          {link("Repeat settings", "/settings/repeats", undefined, "Entries that recur on a schedule (rent, salary, subscriptions). They are added to your transactions automatically when their date comes.")}
          {link("Bookmarks", "/bookmarks")}
        </Section>
        <Section title="Accounts">
          {link("Account settings", "/settings/transfer-expense", undefined, "Per account: whether it counts in your totals, whether it is shown, and whether money moved into it (savings, loans, investments) counts as spending.")}
          <Row label="Default account" info="The account a new entry starts on. You can still pick another one on the entry itself. With no default, new entries start on the first visible account." right={
            <Select value={defaultAccount} onValueChange={(v) => setDefaultAccount({ id: v === "first" ? undefined : (v as Id<"accounts">) })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="first">First in list</SelectItem>{visibleAccounts.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
          } />
          {link("Account groups", "/settings/account-groups")}
          {link("Order & visibility", "/accounts/order")}
          {link("Deleted accounts", "/settings/deleted-accounts", undefined, "Accounts you have deleted, with their transactions kept. Restore one to bring it back, or delete it permanently.")}
          <Row label="Card expenses display" hint="At the time, or as a lump sum on the payment date" info="At the time: a credit-card purchase counts as an expense on the day you make it. Lump sum: card purchases count as transfers until you pay the card off, and the payment to the card is what counts as the expense." right={
            <Select value={s.cardExpenseDisplay} onValueChange={(v) => update({ patch: { cardExpenseDisplay: v as "atTime" | "lumpSum" } })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="atTime">At the time</SelectItem><SelectItem value="lumpSum">Lump sum</SelectItem></SelectContent></Select>
          } />
        </Section>
        <Section title="Configuration">
          {link("Monthly & weekly period", "/settings/period", `${s.monthStartDay}${s.monthStartDay === 1 ? "st" : s.monthStartDay === 2 ? "nd" : s.monthStartDay === 3 ? "rd" : "th"} · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.weekStartDay]}`, "The day each month starts on and the weekday each week starts on. Set the month to start on your pay day and totals, stats and budgets run from pay day to pay day.")}
          <Row label="Carry-over" hint="Add last month's balance to this month's total" info="Adds what was left at the end of the previous month to this month's total on the Transactions tab, so the total shows what you really have left rather than only this month's income minus expenses." right={<Switch checked={s.carryOver} onCheckedChange={(v) => update({ patch: { carryOver: v } })} />} />
          <Row label="Start screen" info="The view the Transactions tab opens on: the Daily list or the Calendar." right={
            <Select value={s.startScreen} onValueChange={(v) => update({ patch: { startScreen: v as "daily" | "calendar" } })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="calendar">Calendar</SelectItem></SelectContent></Select>
          } />
          <Row label="Subcategories" info="Lets categories have subcategories, for example Food › Groceries. When off, you only pick the main category." right={<Switch checked={s.subcategoryEnabled} onCheckedChange={(v) => update({ patch: { subcategoryEnabled: v } })} />} />
          <Row label="Autocomplete notes" info="While you type a note, suggests notes you have used before. Picking one also fills in the category and account you used with it." right={<Switch checked={s.autocompleteEnabled} onCheckedChange={(v) => update({ patch: { autocompleteEnabled: v } })} />} />
          <Row label="Time input" hint="Record the time of each entry" info="Adds a time field next to the date when you enter a transaction. Turn it off if you only care about the day." right={<Switch checked={s.timeInputEnabled} onCheckedChange={(v) => update({ patch: { timeInputEnabled: v } })} />} />
          <Row label="Repeat display" hint="When scheduled entries appear" info="On the date: a scheduled entry is added to your transactions when its date arrives. First of month: all of the month's scheduled entries are added at the start of the month, so you can see what is coming." right={
            <Select value={s.repeatDisplay} onValueChange={(v) => update({ patch: { repeatDisplay: v as "onDate" | "firstOfMonth" } })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="onDate">On the date</SelectItem><SelectItem value="firstOfMonth">First of month</SelectItem></SelectContent></Select>
          } />
          {link("Style", "/settings/style")}
          {link("Passcode", "/settings/passcode", s.passcodeHash ? "On" : "Off", "Asks for a 4-digit code when you open UnMoney, on every device you are signed in on. It locks the screen only; your data is still tied to your Google sign-in.")}
        </Section>
        <Section title="Data">
          {link("Import from Money Manager", "/import", undefined, "Bring over your accounts, categories and history from Money Manager's Excel export.")}
          {link("Backup, restore, import & export", "/settings/backup")}
        </Section>
        <p className="px-4 pt-6 text-xs text-muted-foreground">UnMoney · works offline and syncs across your devices.</p>
      </Page>
    </>
  );
}
