import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { monthKeyForDate, monthRange } from "../../../shared/period";
import { useToday } from "@/lib/today";
import { monthLabel, shortRange } from "@/lib/format";

export default function PeriodSettings() {
  const { settings: s } = useApp();
  const update = useOp("settings.update");
  // which dates "this month" covers with the chosen start day, since a month is named after the one it starts in
  const current = monthKeyForDate(useToday(), s.monthStartDay);
  const r = monthRange(current, s.monthStartDay);
  return (
    <>
      <PageHeader back="/settings/preferences" title="Period" />
      <Page>
        <Section>
          <Row label="Monthly start date" hint={<>Match it to your pay day; months then run pay day to pay day.<br />This month: {monthLabel(current)} = {shortRange(r.from, r.to)}</>} right={(id) => (
            <Select value={String(s.monthStartDay)} onValueChange={(v) => update({ patch: { monthStartDay: Number(v) } })}><SelectTrigger aria-labelledby={id} className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 28 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent></Select>
          )} />
          <Row label="Weekly start day" right={(id) => (
            <Select value={String(s.weekStartDay)} onValueChange={(v) => update({ patch: { weekStartDay: Number(v) } })}><SelectTrigger aria-labelledby={id} className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent></Select>
          )} />
          <Row label="Carry-over" hint="Add the previous balance to each month's total on the Transactions tab" right={(id) => <Switch aria-labelledby={id} checked={s.carryOver} onCheckedChange={(v) => update({ patch: { carryOver: v } })} />} />
        </Section>
      </Page>
    </>
  );
}
