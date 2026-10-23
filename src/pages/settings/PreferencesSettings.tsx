import { useLocation, useNavigate } from "react-router";
import { ChevronRight } from "lucide-react";
import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How the Transactions tab reads and how entering a transaction works. */
export default function PreferencesSettings() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { settings: s } = useApp();
  const update = useOp("settings.update");
  return (
    <>
      <PageHeader back="/settings" title="Preferences" />
      <Page className="pb-8">
        <Section title="Transactions tab">
          <Row label="Monthly & weekly period" value={`${ordinal(s.monthStartDay)} · ${WEEKDAYS[s.weekStartDay]}`} info="The day each month starts on and the weekday each week starts on. Set the month to start on your pay day and totals, stats and budgets run from pay day to pay day. Carry-over is set there too." active={pathname.startsWith("/settings/period")} onClick={() => nav("/settings/period")} right={<ChevronRight className="size-4 text-muted-foreground" />} />
          <Row label="Start screen" info="The view the Transactions tab opens on: the Daily list or the Calendar." right={(id) => (
            <Select value={s.startScreen} onValueChange={(v) => update({ patch: { startScreen: v as "daily" | "calendar" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="calendar">Calendar</SelectItem></SelectContent></Select>
          )} />
          <Row label="Repeat display" hint="When scheduled entries appear" info="On the date: a scheduled entry is added to your transactions when its date arrives. First of month: all of the month's scheduled entries are added at the start of the month, so you can see what is coming." right={(id) => (
            <Select value={s.repeatDisplay} onValueChange={(v) => update({ patch: { repeatDisplay: v as "onDate" | "firstOfMonth" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="onDate">On the date</SelectItem><SelectItem value="firstOfMonth">First of month</SelectItem></SelectContent></Select>
          )} />
        </Section>
        <Section title="Entering a transaction">
          <Row label="Subcategories" info="Lets categories have subcategories, for example Food › Groceries. When off, you only pick the main category." right={(id) => <Switch aria-labelledby={id} checked={s.subcategoryEnabled} onCheckedChange={(v) => update({ patch: { subcategoryEnabled: v } })} />} />
          <Row label="Autocomplete notes" info="While you type a note, suggests notes you have used before. Picking one also fills in the category and payment method you used with it." right={(id) => <Switch aria-labelledby={id} checked={s.autocompleteEnabled} onCheckedChange={(v) => update({ patch: { autocompleteEnabled: v } })} />} />
          <Row label="Time input" hint="Record the time of each entry" info="Adds a time field next to the date when you enter a transaction. Turn it off if you only care about the day." right={(id) => <Switch aria-labelledby={id} checked={s.timeInputEnabled} onCheckedChange={(v) => update({ patch: { timeInputEnabled: v } })} />} />
        </Section>
      </Page>
    </>
  );
}
