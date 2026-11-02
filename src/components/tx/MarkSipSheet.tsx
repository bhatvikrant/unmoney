import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { dateLabel } from "@/lib/format";
import { readSignal, rhythmOf, rhythmText, sipArgs, sipFor, sipsOf, similarPayments, type GmailPayment } from "../../../shared/sips";
import type { Snapshot } from "../../../shared/ops";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const keyOf = (p: GmailPayment) => (p.entry?._id ?? p.draft!._id) as string;
const stateOf = (p: GmailPayment) => (p.entry ? "saved" : p.draft!.status === "open" ? "waiting in Gmail review" : "dismissed");

/**
 * Undo for adding payments to a SIP: the SIP goes (when this made it) or the payments come out of it,
 * and drafts it saved are as they were again (waiting, or dismissed) with the entries made from them gone.
 * Reads the store when Undo is tapped, not when the toast was made.
 */
export function useSipUndo() {
  const view = useView();
  const latest = useRef(view);
  latest.current = view;
  const remove = useOp("sips.remove");
  const unmark = useOp("sips.unmark");
  const reopen = useOp("drafts.reopen");
  const dismiss = useOp("drafts.dismiss");
  return (made: { sipId: string; created: boolean; payments: GmailPayment[] }) => async () => {
    const snap: Snapshot = latest.current;
    const draftIds = made.payments.flatMap((p) => (p.draft ? [p.draft._id] : []));
    const saved = snap.drafts.filter((d) => draftIds.includes(d._id) && d.status === "accepted" && d.transactionId);
    try {
      if (made.created) await remove({ id: made.sipId });
      else await unmark({ ids: made.payments.flatMap((p) => (p.entry ? [p.entry._id] : [])) });
      if (saved.length) {
        await reopen({ ids: saved.map((d) => d._id), transactionIds: saved.map((d) => d.transactionId!) });
        const wasDismissed = made.payments.flatMap((p) => (p.draft?.status === "dismissed" ? [p.draft._id] : []));
        if (wasDismissed.length) await dismiss({ ids: wasDismissed });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't undo");
    }
  };
}

/**
 * "Mark as SIP" on payments the user picked (an entry or a draft read from Gmail, or several ticked
 * in the list): every earlier payment with the same name and exact amount, ticked, to untick any
 * that aren't part of it. Makes a SIP of them, or adds them to the SIP they already belong to
 * (resuming it if it was marked cancelled). Mount it with a `key` per pick so it starts fresh.
 */
export function MarkSipSheet({ picked, open, onOpenChange, onDone }: {
  picked: { note: string; amount: number }[]; open: boolean; onOpenChange: (o: boolean) => void; onDone?: () => void;
}) {
  const view = useView();
  const { accountName } = useApp();
  const create = useOp("sips.create");
  const mark = useOp("sips.mark");
  const undo = useSipUndo();
  const payments = useMemo(() => similarPayments(view, picked), [view, picked]);
  const existing = useMemo(() => picked.map((p) => sipFor(sipsOf(view), { type: "expense", ...p }, true)).find(Boolean), [view, picked]);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [name, setName] = useState(() => existing?.name ?? readSignal([...payments]).name ?? payments[0]?.note ?? "");
  const [busy, setBusy] = useState(false);
  const chosen = payments.filter((p) => !off.has(keyOf(p)));
  const rhythm = rhythmOf(chosen.map((p) => p.date).reverse()) ?? undefined;

  async function save() {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const args = sipArgs(chosen);
      if (existing) {
        await mark({ id: existing.id, ...args, resume: !!existing.stoppedAt });
        toast(`${chosen.length === 1 ? "Payment" : `${chosen.length} payments`} added to ${existing.name}${existing.stoppedAt ? ", running again" : ""}`, {
          duration: 8000, action: { label: "Undo", onClick: () => void undo({ sipId: existing.id, created: false, payments: chosen })() },
        });
      } else {
        const sipId = await create({ name: name.trim() || chosen[0].note, ...args, rhythm });
        toast(`${name.trim() || chosen[0].note} is a SIP now. Its payments, and later ones from Gmail, stay off the daily list.`, {
          duration: 8000, action: { label: "Undo", onClick: () => void undo({ sipId, created: true, payments: chosen })() },
        });
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const title = existing ? `Add to ${existing.name}` : "Mark as SIP";
  const description = payments.length
    ? `${payments.length} payment${payments.length === 1 ? "" : "s"} from Gmail with this name and amount${rhythm ? `, ${rhythmText(rhythm, chosen.map((p) => p.date))}` : ""}. Untick any that aren't part of it.`
    : "Only payments read from Gmail can be SIPs.";
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="space-y-3 px-2">
        {!existing ? (
          <div className="flex items-center gap-2">
            <label htmlFor="mark-sip-name" className="w-14 shrink-0 text-sm text-muted-foreground">Name</label>
            <Input id="mark-sip-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Parag Parikh Flexi Cap" />
          </div>
        ) : null}
        <div className="divide-y rounded-md border">
          {payments.map((p) => {
            const k = keyOf(p);
            const on = !off.has(k);
            return (
              <label key={k} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <Checkbox checked={on} onCheckedChange={(v) => setOff((s) => { const n = new Set(s); if (v) n.delete(k); else n.add(k); return n; })} aria-label={`Include ${dateLabel(p.date, { year: true })}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{dateLabel(p.date, { year: true })}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.note} · {stateOf(p)}{p.entry ? ` · ${accountName(p.entry.accountId)}` : ""}</span>
                </span>
                <Money amount={p.amount} />
              </label>
            );
          })}
        </div>
        <Button className="h-11 w-full" disabled={!chosen.length || busy || (!existing && !name.trim())} onClick={() => void save()}>
          {existing ? `Add ${chosen.length} to ${existing.name}` : `Make it a SIP · ${chosen.length} payment${chosen.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** What MarkSipSheet takes for an entry or a draft. */
export const pickOf = (x: { note: string; amount: number } | { proposal: { note: string; amount: number } }) =>
  "proposal" in x ? { note: x.proposal.note, amount: x.proposal.amount } : { note: x.note, amount: x.amount };
