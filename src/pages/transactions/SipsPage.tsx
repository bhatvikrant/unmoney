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
import { sipDrafts, sipsList, sipSuggestions, type SipRow, type SipSuggestion } from "../../../shared/sips";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState, InfoHint, Section } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * SIPs (More › Invest): the regular investments the user accepted, what has gone into each, and
 * payments that look like one. Payments filed under a SIP are not on the ledger and not spending,
 * but they still left their payment method (docs/specs/sips.md).
 */
export default function SipsPage() {
  const snap = useView();
  const today = useToday();
  const nav = useNavigate();
  const { accountName, settings } = useApp();
  const openEntry = useOpenEntry();
  const create = useOp("sips.create");
  const mark = useOp("sips.mark");
  const remove = useOp("sips.remove");
  const unmark = useOp("sips.unmark");
  const updateSettings = useOp("settings.update");
  const [openId, setOpenId] = useState<string | null>(null);

  const month = useMemo(() => monthRange(monthKeyForDate(today, settings.monthStartDay), settings.monthStartDay), [today, settings.monthStartDay]);
  const rows = useMemo(() => sipsList(snap, month.from, month.to), [snap, month.from, month.to]);
  const suggestions = useMemo(() => sipSuggestions(snap), [snap]);
  const waiting = useMemo(() => sipDrafts(snap).size, [snap]);
  const running = rows.filter((r) => !r.sip.stoppedAt);
  const thisMonth = rows.reduce((s, r) => s + r.inRange, 0);
  const perMonth = running.reduce((s, r) => s + r.sip.amount, 0);
  const soFar = rows.reduce((s, r) => s + r.total, 0);
  const open = rows.find((r) => r.sip.id === openId) ?? null;

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  async function accept(s: SipSuggestion) {
    const ids = s.entries.map((t) => t._id);
    try {
      if (s.sip) {
        await mark({ id: s.sip.id, transactionIds: ids });
        toast(`${ids.length === 1 ? "Payment" : `${ids.length} payments`} added to ${s.sip.name}`, {
          duration: 8000, action: { label: "Undo", onClick: () => void unmark({ ids }).catch(fail) },
        });
      } else {
        const id = await create({ name: s.name, transactionIds: ids });
        toast(`${s.name} is a SIP now. Its payments, and later ones, stay off the daily list.`, {
          duration: 8000, action: { label: "Undo", onClick: () => void remove({ id }).catch(fail) },
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

  return (
    <>
      <PageHeader back="/settings" title="SIPs" />
      <Page className="pb-10">
        {rows.length ? (
          <div className="grid grid-cols-3 border-b bg-card text-center">
            <Stat label="This month" amount={thisMonth} />
            <Stat label="Every month" amount={perMonth} />
            <Stat label="So far" amount={soFar} />
          </div>
        ) : null}

        {waiting ? (
          <button type="button" onClick={() => nav("/gmail")} className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm hover:bg-accent/40">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{waiting} SIP payment{waiting === 1 ? "" : "s"} waiting in Gmail review</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ) : null}

        {!rows.length && !suggestions.length ? (
          <EmptyState title="No SIPs yet" hint="Open an expense and tap Mark as SIP, or connect Gmail: payments to Groww, Zerodha, CAMS, ICCL and other investment mail show up here as suggestions." />
        ) : null}

        {suggestions.length ? (
          <Section title={<span className="inline-flex items-center gap-1">Looks like a SIP <InfoHint text="Payments whose mail, note or category reads like an investment, from what is already in your ledger. Adding one takes its payments, and later ones with the same note and about the same amount, off the daily list and out of spending." /></span>}>
            {suggestions.map((s) => (
              <div key={s.id} className="border-b last:border-b-0">
                <button type="button" onClick={() => openEntry(s.last._id)} className="flex w-full items-center gap-3 px-4 pt-2.5 pb-1 text-left text-sm hover:bg-accent/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{s.name}</div>
                    <div className="line-clamp-2 text-xs text-muted-foreground">{s.why} · last {dateLabel(s.last.date)} · {accountName(s.last.accountId)}</div>
                  </div>
                  <Money amount={s.amount} kind="expense" className="shrink-0" />
                </button>
                <div className="flex gap-2 px-4 pt-1 pb-2.5">
                  <Button size="sm" variant="outline" onClick={() => void accept(s)}>{s.sip ? `Add to ${s.sip.name}` : s.entries.length === 1 ? "Add as SIP" : `Add ${s.entries.length} as SIP`}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void notASip(s)}>Not a SIP</Button>
                </div>
              </div>
            ))}
          </Section>
        ) : null}

        {rows.length ? (
          <Section title="Your SIPs">
            {rows.map((r) => (
              <button key={r.sip.id} type="button" onClick={() => setOpenId(r.sip.id)} className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{r.sip.name}</span>
                    {r.sip.stoppedAt ? <Badge variant="secondary" className="px-1 py-0 text-[10px]">Stopped</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <Money amount={r.sip.amount} muted /> a payment{r.next ? ` · next around ${dateLabel(r.next)}` : ""}{r.sip.accountId ? ` · ${accountName(r.sip.accountId)}` : ""}
                  </div>
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

/** One SIP: its name (edited in place), stop or delete it, and its payments, each of which can go back to the ledger. */
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
  async function onDelete() {
    const ok = await confirm({
      title: `Delete ${sip.name}?`,
      description: `${entries.length ? `Its ${entries.length} payment${entries.length === 1 ? "" : "s"} go back to the daily list as ordinary expenses, and later` : "Later"} payments are no longer filed under it.`,
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

  return (
    <BottomSheet open onOpenChange={(o) => { if (!o) onClose(); }} title={sip.name} description={`${row.entries.length} payment${row.entries.length === 1 ? "" : "s"}, ${sip.stoppedAt ? "stopped" : "running"}`}>
      <div className="space-y-3 px-2">
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <label htmlFor="sip-name" className="w-14 shrink-0 text-sm text-muted-foreground">Name</label>
          <Input id="sip-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} placeholder="e.g. Parag Parikh Flexi Cap" />
          {renamed ? <Button type="submit" size="sm" className="h-9">Save</Button> : null}
        </form>
        <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void update({ id: sip.id, stopped: !sip.stoppedAt }).then(() => toast(sip.stoppedAt ? `${sip.name} is running again` : `${sip.name} stopped. Its payments stay here; new ones go to the daily list.`)).catch(fail)}>
              {sip.stoppedAt ? "Restart" : "Stop"}
            </Button>
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
