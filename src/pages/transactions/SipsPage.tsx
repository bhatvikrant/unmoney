import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, Mail } from "lucide-react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useToday } from "@/lib/today";
import { useOpenEntry } from "@/lib/nav";
import { dateLabel } from "@/lib/format";
import { monthKeyForDate, monthRange } from "../../../shared/period";
import { perMonth, RHYTHM_LABEL, sipDrafts, sipsList, sipSuggestions, type SipRow, type SipSuggestion } from "../../../shared/sips";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState, InfoHint, Section } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";
import { MarkSipSheet, useSipUndo } from "@/components/tx/MarkSipSheet";

/**
 * SIPs (More › Invest): the regular investments the user accepted, what has gone into each, and
 * what Gmail read that looks like one. Payments filed under a SIP are not on the ledger and not
 * spending, but they still left their bank account (docs/specs/sips.md).
 */
export default function SipsPage() {
  const snap = useView();
  const today = useToday();
  const nav = useNavigate();
  const { settings } = useApp();
  const create = useOp("sips.create");
  const mark = useOp("sips.mark");
  const saveDrafts = useOp("sips.saveDrafts");
  const updateSettings = useOp("settings.update");
  const undo = useSipUndo();
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<SipSuggestion | null>(null);

  const month = useMemo(() => monthRange(monthKeyForDate(today, settings.monthStartDay), settings.monthStartDay), [today, settings.monthStartDay]);
  const rows = useMemo(() => sipsList(snap, month.from, month.to, today), [snap, month.from, month.to, today]);
  const suggestions = useMemo(() => sipSuggestions(snap), [snap]);
  const waiting = useMemo(() => [...sipDrafts(snap).keys()].map((id) => snap.drafts.find((d) => d._id === id)!), [snap]);
  const thisMonth = rows.reduce((s, r) => s + r.inRange, 0);
  const everyMonth = perMonth(rows);
  const soFar = rows.reduce((s, r) => s + r.total, 0);
  const open = rows.find((r) => r.sip.id === openId) ?? null;
  const likely = suggestions.filter((s) => s.likely);
  const maybe = suggestions.filter((s) => !s.likely);

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  async function accept(s: SipSuggestion) {
    const args = { transactionIds: s.transactionIds, draftIds: s.draftIds, draftDates: s.draftDates };
    try {
      if (s.sip) {
        await mark({ id: s.sip.id, ...args, resume: true });
        toast(`${s.sip.name} is running again`, { duration: 8000, action: { label: "Undo", onClick: () => void undo({ sipId: s.sip!.id, created: false, payments: s.payments })() } });
      } else {
        const sipId = await create({ name: s.name, ...args, rhythm: s.rhythm });
        toast(`${s.name} is a SIP now. Its payments, and later ones from Gmail, stay off the daily list.`, {
          duration: 8000, action: { label: "Undo", onClick: () => void undo({ sipId, created: true, payments: s.payments })() },
        });
      }
    } catch (e) { fail(e); }
  }
  async function notASip(s: SipSuggestion) {
    const before = settings.dismissedSips ?? [];
    try {
      await updateSettings({ patch: { dismissedSips: [...before, s.key] } });
      toast(`${s.name} won't be suggested again`, {
        duration: 8000, action: { label: "Undo", onClick: () => void updateSettings({ patch: { dismissedSips: before } }).catch(fail) },
      });
    } catch (e) { fail(e); }
  }
  async function saveWaiting() {
    try {
      const n = await saveDrafts({ draftIds: waiting.map((d) => d._id), draftDates: waiting.map((d) => d.proposal.date) });
      const left = waiting.length - n;
      toast(n ? `Saved ${n} into ${n === 1 ? "its SIP" : "their SIPs"}${left ? `; ${left} need a bank account picked in Gmail review` : ""}` : "These need a bank account picked in Gmail review");
    } catch (e) { fail(e); }
  }

  const suggestionRow = (s: SipSuggestion) => (
    <div key={s.id} className="border-b last:border-b-0">
      <button type="button" onClick={() => setReview(s)} className="flex w-full items-center gap-3 px-4 pt-2.5 pb-1 text-left text-sm hover:bg-accent/40">
        <div className="min-w-0 flex-1">
          <div className="truncate">{s.name}</div>
          <div className="line-clamp-2 text-xs text-muted-foreground">{s.why} · last {dateLabel(s.payments[0].date)}</div>
        </div>
        <Money amount={s.amount} className="shrink-0" />
      </button>
      <div className="flex gap-2 px-4 pt-1 pb-2.5">
        <Button size="sm" variant="outline" onClick={() => void accept(s)}>{s.sip ? `Resume ${s.sip.name}` : `Add ${s.payments.length} as SIP`}</Button>
        <Button size="sm" variant="ghost" onClick={() => setReview(s)}>Review</Button>
        {!s.sip ? <Button size="sm" variant="ghost" onClick={() => void notASip(s)}>Not a SIP</Button> : null}
      </div>
    </div>
  );

  const statusText = (r: SipRow) => {
    const last = r.entries[0];
    // the badge beside the name says paused or cancelled; this says since when
    if (r.status !== "running") return last ? `last paid ${dateLabel(last.date, { year: true })}` : "no payments";
    return `${RHYTHM_LABEL[r.sip.rhythm ?? "monthly"]}${r.next ? ` · next around ${dateLabel(r.next)}` : ""}`;
  };

  return (
    <>
      <PageHeader back="/settings" title="SIPs" />
      <Page className="pb-10">
        {rows.length ? (
          <div className="grid grid-cols-3 border-b bg-card text-center">
            <Stat label="This month" amount={thisMonth} />
            <Stat label="Every month" amount={everyMonth} />
            <Stat label="So far" amount={soFar} />
          </div>
        ) : null}

        {waiting.length ? (
          <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{waiting.length} SIP payment{waiting.length === 1 ? "" : "s"} waiting in Gmail review</span>
            <Button size="sm" variant="outline" onClick={() => void saveWaiting()}>Save</Button>
            <Button size="icon" variant="ghost" aria-label="Open Gmail review" onClick={() => nav("/gmail")}><ChevronRight className="size-4" /></Button>
          </div>
        ) : null}

        {!rows.length && !suggestions.length ? (
          <EmptyState title="No SIPs yet" hint="SIPs are found in the debits Gmail reads: the same name and amount coming back every week, fortnight, month or quarter. Connect Gmail in More › Gmail, or open a payment read from Gmail and tap Mark as SIP." />
        ) : null}

        {likely.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Looks like a SIP <InfoHint text="Debits Gmail read with the same name and amount, on a rhythm (weekly to quarterly), whose mail or name reads like an investment. Adding one saves its payments, and every later one from Gmail, into it: off the daily list and out of spending." /></span>}>
            {likely.map(suggestionRow)}
          </Section>
        ) : null}
        {maybe.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Maybe a SIP <InfoHint text="These repeat like a SIP, but their mail doesn't say it's an investment: rent, a bill or an EMI looks the same. Add the ones that are SIPs; Not a SIP hides the rest for good." /></span>}>
            {maybe.map(suggestionRow)}
          </Section>
        ) : null}

        {rows.length ? (
          <Section title="Your SIPs">
            {rows.map((r) => (
              <button key={r.sip.id} type="button" onClick={() => setOpenId(r.sip.id)} className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{r.sip.name}</span>
                    {r.status !== "running" ? <Badge variant="secondary" className="px-1 py-0 text-[10px]">{r.status === "paused" ? "Paused" : "Cancelled"}</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground"><Money amount={r.sip.amount} muted /> · {statusText(r)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <Money amount={r.total} />
                  <div className="text-[11px] text-muted-foreground">{r.entries.length} payment{r.entries.length === 1 ? "" : "s"}</div>
                </div>
              </button>
            ))}
          </Section>
        ) : null}
      </Page>
      {/* keyed by the SIP, so its name field starts from that SIP's name */}
      <SipSheet key={open?.sip.id ?? "none"} row={open} onClose={() => setOpenId(null)} />
      {review ? <MarkSipSheet key={review.id} picked={[{ note: review.payments[0].note, amount: review.amount }]} open onOpenChange={(o) => { if (!o) setReview(null); }} /> : null}
    </>
  );
}

function Stat({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="px-2 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <Money amount={amount} className="text-sm font-medium" />
    </div>
  );
}

/**
 * One SIP: its name (edited in place), cancel or delete it, and its payments, each of which can go
 * back to the ledger. A pause needs nothing here: the next payment from Gmail goes straight in.
 */
function SipSheet({ row, onClose }: { row: SipRow | null; onClose: () => void }) {
  const update = useOp("sips.update");
  const remove = useOp("sips.remove");
  const unmark = useOp("sips.unmark");
  const mark = useOp("sips.mark");
  const openEntry = useOpenEntry();
  const confirm = useConfirm();
  const { accountName } = useApp();
  const [name, setName] = useState(row?.sip.name ?? "");
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  if (!row) return <BottomSheet open={false} onOpenChange={() => {}} title="SIP"><div /></BottomSheet>;
  const { sip, entries } = row;

  const renamed = name.trim() !== sip.name;
  async function rename() {
    const n = name.trim();
    if (!n) return setName(sip.name);
    if (n === sip.name) return;
    await update({ id: sip.id, name: n }).then(() => toast(`Renamed to ${n}`)).catch(fail);
  }
  async function cancel() {
    if (sip.stoppedAt) {
      await update({ id: sip.id, stopped: false }).then(() => toast(`${sip.name} is running again: new debits from Gmail go into it`)).catch(fail);
      return;
    }
    const ok = await confirm({
      title: `Mark ${sip.name} as cancelled?`,
      description: "Its payments stay here. A debit with its name that still comes from Gmail goes to the daily list, and this SIP is offered back to resume.",
      action: "Mark as cancelled", destructive: false,
    });
    if (ok) await update({ id: sip.id, stopped: true }).then(() => toast(`${sip.name} marked as cancelled`)).catch(fail);
  }
  async function onDelete() {
    const ok = await confirm({
      title: `Delete ${sip.name}?`,
      description: `${entries.length ? `Its ${entries.length} payment${entries.length === 1 ? "" : "s"} go back to the daily list as ordinary expenses, and later` : "Later"} debits are no longer saved into it.`,
    });
    if (!ok) return;
    onClose();
    await remove({ id: sip.id }).then(() => toast(`${sip.name} deleted`)).catch(fail);
  }
  async function notThisOne(id: (typeof entries)[number]["_id"]) {
    await unmark({ ids: [id] }).then(() => toast("Back on the daily list", {
      duration: 8000, action: { label: "Undo", onClick: () => void mark({ id: sip.id, transactionIds: [id] }).catch(fail) },
    })).catch(fail);
  }

  const state = row.status === "cancelled" ? "cancelled" : row.status === "paused" ? "paused: no debit lately, the next one goes straight in" : RHYTHM_LABEL[sip.rhythm ?? "monthly"];
  return (
    <BottomSheet open onOpenChange={(o) => { if (!o) onClose(); }} title={sip.name} description={`${entries.length} payment${entries.length === 1 ? "" : "s"} · ${state}`}>
      <div className="space-y-3 px-2">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <label htmlFor="sip-name" className="w-14 shrink-0 text-sm text-muted-foreground">Name</label>
          <Input id="sip-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} placeholder="e.g. Parag Parikh Flexi Cap" />
          {renamed ? <Button type="submit" size="sm" className="h-9">Save</Button> : null}
        </form>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void cancel()}>{sip.stoppedAt ? "Not cancelled" : "Mark as cancelled"}</Button>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => void onDelete()}>Delete</Button>
        </div>
        <div className="flex justify-between rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Invested so far</span>
          <Money amount={row.total} className="font-medium" />
        </div>
        <div className="divide-y rounded-md border">
          {entries.length ? entries.map((t) => (
            <div key={t._id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <button type="button" className="min-w-0 flex-1 text-left hover:underline underline-offset-4" onClick={() => { onClose(); openEntry(t._id); }}>
                <div className="truncate">{dateLabel(t.date, { year: true })}</div>
                <div className="truncate text-xs text-muted-foreground">{t.note || sip.name} · {accountName(t.accountId)}</div>
              </button>
              <Money amount={t.amount} />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => void notThisOne(t._id)}>Not a SIP</Button>
            </div>
          )) : <div className="px-3 py-2 text-sm text-muted-foreground">No payments yet.</div>}
        </div>
      </div>
    </BottomSheet>
  );
}
