import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PeriodSettings() {
  const { settings: s } = useApp();
  const update = useOp("settings.update");
  return (
    <>
      <PageHeader back="/settings" title="Period" />
      <Page>
        <Section>
          <Row label="Monthly start date" hint="Match it to your pay day; months then run pay day to pay day" right={
            <Select value={String(s.monthStartDay)} onValueChange={(v) => update({ patch: { monthStartDay: Number(v) } })}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{Array.from({ length: 28 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent></Select>
          } />
          <Row label="Weekly start day" right={
            <Select value={String(s.weekStartDay)} onValueChange={(v) => update({ patch: { weekStartDay: Number(v) } })}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent></Select>
          } />
          <Row label="Carry-over" hint="Add the previous balance to each month's total on the Transactions tab" right={<Switch checked={s.carryOver} onCheckedChange={(v) => update({ patch: { carryOver: v } })} />} />
        </Section>
      </Page>
    </>
  );
}
