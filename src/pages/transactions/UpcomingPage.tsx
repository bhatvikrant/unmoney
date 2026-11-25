import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { useOpenEntry } from "@/lib/nav";
import { dateLabel, longMonth } from "@/lib/format";
import { billsAgainstBudgets, next30Days, recurringSuggestions, subscriptionsList, type Occurrence, type RecurringSuggestion } from "../../../shared/upcoming";
import { chargeSignals } from "../../../shared/chargeSignals";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState, InfoHint, Section } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { UpcomingRow, UpcomingSheet } from "@/components/tx/Upcoming";
import { FREQ_LABEL } from "@/components/tx/RepeatSheet";
import { BudgetProjection } from "@/components/BudgetBars";
import { useBudgetLabel } from "@/components/tx/entryBudgets";

type Tx = RecurringSuggestion["last"];

/**
 * Bills & subscriptions (More › Look ahead): what the repeat schedules will add in the next 30
 * days, what the subscriptions cost a month, payments that recur without a schedule yet, and
 * charges that look odd: a price that went up, a payment taken twice (shared/chargeSignals.ts).
 * Nothing here counts anywhere until it is added (docs/specs/upcoming-bills.md).
 */
export default function UpcomingPage() {
  const snap = useView();
  const today = useToday();
  const { accountName, categoryLabel, settings, fmt, fmtSub } = useApp();
  const openEntry = useOpenEntry();
  const nav = useNavigate();
  const createRepeat = useOp("repeats.create");
  const updateSettings = useOp("settings.update");
  const [occ, setOcc] = useState<Occurrence | null>(null);

  const soon = useMemo(() => next30Days(snap, today), [snap, today]);
  const subs = useMemo(() => subscriptionsList(snap), [snap]);
  const suggestions = useMemo(() => recurringSuggestions(snap, today), [snap, today]);
  const { rises, doubles } = useMemo(() => chargeSignals(snap, today), [snap, today]);
  // a price in the currency it was charged in
  const price = (t: Tx) => (t.subAmount && t.subCurrency ? fmtSub(t.subAmount, t.subCurrency) : fmt(t.amount));
  /** Search, narrowed to the entries a signal is about. */
  const seeEntries = (t: Tx, more: Record<string, string> = {}) => nav(`/search?${new URLSearchParams({ q: t.note.trim(), type: "expense", ...more })}`);
  const out = soon.reduce((s, o) => s + (o.repeat.template.type === "expense" ? o.repeat.template.amount : 0), 0);
  const comingIn = soon.reduce((s, o) => s + (o.repeat.template.type === "income" ? o.repeat.template.amount : 0), 0);
  const perMonth = subs.reduce((s, x) => s + x.monthly, 0);
  // the budgets running now, with the bills still due in them
  const outlook = useMemo(() => billsAgainstBudgets(snap, today), [snap, today]);
  const budgetLabel = useBudgetLabel();
  const billNames = (bills: Occurrence[]) => {
    const names = bills.map((o) => `${o.repeat.template.note || categoryLabel(o.repeat.template)} ${dateLabel(o.date)}`);
    return names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(", ");
  };

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  async function makeRepeat(s: RecurringSuggestion) {
    const t = s.last;
    try {
      await createRepeat({
        template: { type: t.type, accountId: t.accountId, categoryId: t.categoryId, subcategoryId: t.subcategoryId, amount: t.amount, note: t.note, description: t.description, tags: t.tags },
        frequency: "monthly", after: t.date, today, fromTransactionId: t._id,
      });
      toast.success(`Repeats every month from ${dateLabel(s.nextDate)}`);
    } catch (e) { fail(e); }
  }
  /** Hide a suggestion or a signal for good: its key joins settings.dismissedRecurring. */
  async function dismiss(key: string, said: string) {
    const before = settings.dismissedRecurring ?? [];
    try {
      await updateSettings({ patch: { dismissedRecurring: [...before, key] } });
      toast(said, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void updateSettings({ patch: { dismissedRecurring: before } }).catch(fail) },
      });
    } catch (e) { fail(e); }
  }

  const nothing = !soon.length && !subs.length && !suggestions.length && !rises.length && !doubles.length;
  return (
    <>
      <PageHeader back="/settings" title="Bills & subscriptions" />
      <Page className="pb-10">
        {nothing ? (
          <EmptyState title="Nothing scheduled" hint="Set a repeat from the Repeat button on an entry's date (rent, salary, Netflix) and what's coming shows here and in the ledger." />
        ) : null}

        {soon.length ? (
          <Section title="Next 30 days">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b text-xs text-muted-foreground">
              <span>Going out <Money amount={out} kind="expense" className="text-sm" /></span>
              {comingIn ? <span>Coming in <Money amount={comingIn} kind="income" className="text-sm" /></span> : null}
            </div>
            {soon.map((o) => <UpcomingRow key={`${o.repeat._id}:${o.date}`} occ={o} showDate onClick={() => setOcc(o)} />)}
          </Section>
        ) : !nothing ? (
          <Section title="Next 30 days"><div className="px-4 py-3 text-sm text-muted-foreground">Nothing scheduled in the next 30 days.</div></Section>
        ) : null}

        {outlook.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Budgets after bills <InfoHint text="What each budget running now will have left once the bills scheduled before it ends go out. Nothing counts until a bill is added." /></span>}>
            {outlook.map((o) => {
              const { name, when } = budgetLabel(o.item);
              return (
                <div key={`${o.item.budget._id}|${o.item.range.from}`} className="border-b px-4 py-2.5 last:border-b-0">
                  <BudgetProjection name={name} when={when} item={o.item} amount={o.adds} after="After these bills" over="These bills take it" />
                  <div className="mt-0.5 truncate text-xs text-muted-foreground"><Money amount={o.adds} muted /> due: {billNames(o.bills)}</div>
                </div>
              );
            })}
          </Section>
        ) : null}

        {subs.length ? (
          <Section title="Subscriptions">
            {subs.map(({ repeat: r, monthly }) => {
              const t = r.template;
              return (
                <button key={r._id} type="button" onClick={() => setOcc({ repeat: r, date: r.nextDate, isNext: true })} className="w-full flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm text-left hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{t.note || categoryLabel(t)}</div>
                    <div className="text-xs text-muted-foreground truncate">{FREQ_LABEL[r.frequency]} · next {dateLabel(r.nextDate)} · {accountName(t.accountId)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <Money amount={t.amount} kind="expense" />
                    {r.frequency !== "monthly" ? <div className="text-[11px] text-muted-foreground">≈ <Money amount={monthly} muted /> a month</div> : null}
                  </div>
                </button>
              );
            })}
            <div className="flex justify-between px-4 py-2.5 text-sm font-medium">
              <span>Total</span>
              <span className="text-right"><Money amount={perMonth} kind="expense" /> a month · <Money amount={perMonth * 12} kind="expense" /> a year</span>
            </div>
          </Section>
        ) : null}

        {suggestions.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Looks like a subscription <InfoHint text="Paid about once a month, three times or more, with about the same amount, and no repeat set. Make it a repeat to see it coming." /></span>}>
            {suggestions.map((s) => (
              <div key={s.key} className="border-b last:border-b-0">
                <button type="button" onClick={() => openEntry(s.last._id)} className="w-full flex items-center gap-3 px-4 pt-2.5 pb-1 text-sm text-left hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.last.note}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.count} payments, about monthly · last {dateLabel(s.last.date)} · {accountName(s.last.accountId)}</div>
                  </div>
                  <Money amount={s.last.amount} kind="expense" className="shrink-0" />
                </button>
                <div className="flex gap-2 px-4 pb-2.5 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void makeRepeat(s)}>Make it a repeat</Button>
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(s.key, `${s.last.note} won't be suggested again`)}>Not a bill</Button>
                </div>
              </div>
            ))}
          </Section>
        ) : null}

        {rises.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Price went up <InfoHint text="A payment that came round regularly at one price, three times or more, and now costs at least 5% more. Bills that change every time are left out." /></span>}>
            {rises.map((r) => (
              <div key={r.key} className="border-b last:border-b-0">
                <button type="button" onClick={() => openEntry(r.after._id)} className="w-full flex items-center gap-3 px-4 pt-2.5 pb-1 text-sm text-left hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.after.note}</div>
                    <div className="text-xs text-muted-foreground">Went from {price(r.before)} to {price(r.after)} in {longMonth(r.after.date.slice(0, 7))} · {accountName(r.after.accountId)}</div>
                  </div>
                  <Money amount={r.after.amount} kind="expense" className="shrink-0" />
                </button>
                <div className="flex gap-2 px-4 pb-2.5 pt-1">
                  <Button size="sm" variant="outline" onClick={() => seeEntries(r.after)}>See payments</Button>
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(r.key, `${r.after.note}'s new price won't be shown again`)}>Got it</Button>
                </div>
              </div>
            ))}
          </Section>
        ) : null}

        {doubles.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Charged twice? <InfoHint text="Two payments with the same note, amount and payment method, on the same day or a day apart, where you don't usually pay it twice. If one is a mistake, open it and delete it." /></span>}>
            {doubles.map((d) => (
              <div key={d.key} className="border-b last:border-b-0">
                <button type="button" onClick={() => openEntry(d.second._id)} className="w-full flex items-center gap-3 px-4 pt-2.5 pb-1 text-sm text-left hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{d.second.note}</div>
                    <div className="text-xs text-muted-foreground truncate">{d.first.date === d.second.date ? `Twice on ${dateLabel(d.first.date)}` : `${dateLabel(d.first.date)} and ${dateLabel(d.second.date)}`} · {accountName(d.second.accountId)}</div>
                  </div>
                  <Money amount={d.second.amount} kind="expense" className="shrink-0" />
                </button>
                <div className="flex gap-2 px-4 pb-2.5 pt-1">
                  <Button size="sm" variant="outline" onClick={() => seeEntries(d.second, { account: d.second.accountId, from: d.first.date, to: d.second.date })}>See both</Button>
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(d.key, `${d.second.note} on ${dateLabel(d.second.date)} won't be shown again`)}>Not a double</Button>
                </div>
              </div>
            ))}
          </Section>
        ) : null}
      </Page>
      <UpcomingSheet occ={occ} onOpenChange={(o) => { if (!o) setOcc(null); }} />
    </>
  );
}
