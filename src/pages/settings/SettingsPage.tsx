import { useNavigate } from "react-router";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronRight } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { clearUnlock } from "@/lib/passcode";

export default function SettingsPage() {
  const nav = useNavigate();
  const { settings: s, user } = useApp();
  const update = useMutation(api.settings.update);
  const { signOut } = useAuthActions();
  const link = (label: string, to: string, value?: string) => <Row label={label} value={value} onClick={() => nav(to)} right={<ChevronRight className="size-4 text-muted-foreground" />} />;
  return (
    <>
      <PageHeader title="More" />
      <Page className="pb-10">
        <Section title="Account">
          <Row label={user?.name || user?.email || "Signed in"} hint={user?.name ? user.email : undefined} right={<Button variant="outline" size="sm" onClick={() => { clearUnlock(); signOut(); }}>Sign out</Button>} />
        </Section>
        <Section title="Money">
          {link("Main currency", "/settings/currency", s.mainCurrency)}
          {link("Sub currencies", "/settings/sub-currencies")}
          {link("Income / expense categories", "/settings/categories")}
          {link("Budget settings", "/budget/settings")}
          {link("Repeat settings", "/settings/repeats")}
          {link("Bookmarks", "/bookmarks")}
        </Section>
        <Section title="Accounts">
          {link("Account settings", "/settings/transfer-expense")}
          {link("Account groups", "/settings/account-groups")}
          {link("Order & visibility", "/accounts/order")}
          {link("Deleted accounts", "/settings/deleted-accounts")}
          <Row label="Card expenses display" hint="At the time, or as a lump sum on the payment date" right={
            <Select value={s.cardExpenseDisplay} onValueChange={(v) => update({ patch: { cardExpenseDisplay: v as "atTime" | "lumpSum" } })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="atTime">At the time</SelectItem><SelectItem value="lumpSum">Lump sum</SelectItem></SelectContent></Select>
          } />
        </Section>
        <Section title="Configuration">
          {link("Monthly & weekly period", "/settings/period", `${s.monthStartDay}${s.monthStartDay === 1 ? "st" : s.monthStartDay === 2 ? "nd" : s.monthStartDay === 3 ? "rd" : "th"} · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.weekStartDay]}`)}
          <Row label="Carry-over" hint="Add last month's balance to this month's total" right={<Switch checked={s.carryOver} onCheckedChange={(v) => update({ patch: { carryOver: v } })} />} />
          <Row label="Start screen" right={
            <Select value={s.startScreen} onValueChange={(v) => update({ patch: { startScreen: v as "daily" | "calendar" } })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="calendar">Calendar</SelectItem></SelectContent></Select>
          } />
          <Row label="Subcategories" right={<Switch checked={s.subcategoryEnabled} onCheckedChange={(v) => update({ patch: { subcategoryEnabled: v } })} />} />
          <Row label="Autocomplete notes" right={<Switch checked={s.autocompleteEnabled} onCheckedChange={(v) => update({ patch: { autocompleteEnabled: v } })} />} />
          <Row label="Time input" hint="Record the time of each entry" right={<Switch checked={s.timeInputEnabled} onCheckedChange={(v) => update({ patch: { timeInputEnabled: v } })} />} />
          <Row label="Repeat display" hint="When scheduled entries appear" right={
            <Select value={s.repeatDisplay} onValueChange={(v) => update({ patch: { repeatDisplay: v as "onDate" | "firstOfMonth" } })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="onDate">On the date</SelectItem><SelectItem value="firstOfMonth">First of month</SelectItem></SelectContent></Select>
          } />
          {link("Style", "/settings/style")}
          {link("Passcode", "/settings/passcode", s.passcodeHash ? "On" : "Off")}
        </Section>
        <Section title="Data">
          {link("Backup, restore, import & export", "/settings/backup")}
        </Section>
        <p className="px-4 pt-6 text-xs text-muted-foreground">unmoney · synced across your devices · install it from your browser's share or menu button to use it like an app.</p>
      </Page>
    </>
  );
}
