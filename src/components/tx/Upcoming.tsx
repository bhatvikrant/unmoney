import { useNavigate } from "react-router";
import { Repeat } from "lucide-react";
import { toast } from "sonner";
import type { Occurrence } from "../../../shared/upcoming";
import { useApp } from "@/lib/app";
import { useStore } from "@/lib/store";
import { useOpenEntry } from "@/lib/nav";
import { useToday } from "@/lib/today";
import { dateLabel } from "@/lib/format";
import { Money } from "@/components/shell/Money";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { FREQ_LABEL } from "./RepeatSheet";
import { cn } from "@/lib/utils";

/** Money kind of a schedule's template, for colouring its amount. */
const kindOf = (o: Occurrence) => (o.repeat.template.type === "income" ? "income" : o.repeat.template.type === "expense" ? "expense" : "transfer");

/**
 * A coming date of a repeat schedule, on its day in the ledger: the shape of an entry row, faded
 * by the caller, never counted. Tapping it offers Add now / Skip (UpcomingSheet).
 */
export function UpcomingRow({ occ, onClick, showDate, className }: { occ: Occurrence; onClick?: () => void; showDate?: boolean; className?: string }) {
  const { accountName, categoryLabel } = useApp();
  const t = occ.repeat.template;
  const isTransfer = t.type === "transfer";
  const label = isTransfer ? "Transfer" : categoryLabel(t) || "—";
  const method = isTransfer ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId);
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm", onClick && "cursor-pointer hover:bg-accent/40 active:bg-accent", className)}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} aria-label={`Upcoming on ${dateLabel(occ.date)}: ${t.note || label}`}
      onClick={onClick} onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="w-20 shrink-0 text-xs text-muted-foreground leading-tight line-clamp-2">
        {showDate ? <div className="text-foreground">{dateLabel(occ.date)}</div> : null}
        {label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate flex items-center gap-1.5">
          <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t.note || label}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">Upcoming · {method}</div>
      </div>
      <Money amount={t.amount} kind={kindOf(occ)} className="shrink-0" />
    </div>
  );
}

/** Add the next date now (paying early) or skip it, each with Undo. */
export function useUpcomingActions() {
  const { dispatch } = useStore();
  const openEntry = useOpenEntry();
  const today = useToday();
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  // Putting the schedule back on the date brings it back to life too, if that was its last one.
  const restore = (o: Occurrence) => dispatch("repeats.update", { id: o.repeat._id, nextDate: o.date, active: true });
  return {
    async addNow(o: Occurrence) {
      try {
        const id = await dispatch("repeats.addNext", { id: o.repeat._id, date: o.date, entryDate: today });
        toast("Added to today", {
          duration: 8000,
          action: { label: "Undo", onClick: () => void dispatch("transactions.remove", { id }).then(() => restore(o)).catch(fail) },
          cancel: { label: "Open", onClick: () => openEntry(id) },
        });
      } catch (e) { fail(e); }
    },
    async skip(o: Occurrence) {
      try {
        await dispatch("repeats.skip", { id: o.repeat._id, date: o.date });
        toast(`Skipped ${dateLabel(o.date)}`, { duration: 8000, action: { label: "Undo", onClick: () => void restore(o).catch(fail) } });
      } catch (e) { fail(e); }
    },
  };
}

/** What a coming date is, and what can be done with it: the next one can be added now or skipped. */
export function UpcomingSheet({ occ, onOpenChange }: { occ: Occurrence | null; onOpenChange: (open: boolean) => void }) {
  const nav = useNavigate();
  const { accountName, categoryLabel } = useApp();
  const actions = useUpcomingActions();
  const t = occ?.repeat.template;
  const close = () => onOpenChange(false);
  return (
    <BottomSheet open={!!occ} onOpenChange={onOpenChange} title={occ && t ? t.note || categoryLabel(t) || "Transfer" : ""} description={occ ? `Upcoming on ${dateLabel(occ.date, { weekday: true, year: true })}` : undefined}>
      {occ && t ? (
        <div className="px-2">
          <div className="border-y bg-card text-sm">
            <div className="flex justify-between px-3 py-2.5 border-b"><span className="text-muted-foreground">Amount</span><Money amount={t.amount} kind={kindOf(occ)} /></div>
            <div className="flex justify-between gap-3 px-3 py-2.5 border-b"><span className="text-muted-foreground">{t.type === "transfer" ? "From → To" : "Payment method"}</span><span className="truncate">{t.type === "transfer" ? `${accountName(t.accountId)} → ${accountName(t.toAccountId)}` : accountName(t.accountId)}</span></div>
            {t.type !== "transfer" ? <div className="flex justify-between gap-3 px-3 py-2.5 border-b"><span className="text-muted-foreground">Category</span><span className="truncate">{categoryLabel(t)}</span></div> : null}
            <div className="flex justify-between gap-3 px-3 py-2.5"><span className="text-muted-foreground">Repeats</span><span className="truncate">{FREQ_LABEL[occ.repeat.frequency]}{occ.repeat.endDate ? ` until ${dateLabel(occ.repeat.endDate, { year: true })}` : ""}</span></div>
          </div>
          {occ.isNext ? (
            <div className="flex flex-col gap-2 pt-4">
              <Button onClick={() => { close(); void actions.addNow(occ); }}>Add now</Button>
              <Button variant="outline" onClick={() => { close(); void actions.skip(occ); }}>Skip this one</Button>
              <Button variant="ghost" onClick={() => { close(); nav(`/settings/repeats?id=${occ.repeat._id}`); }}>Edit schedule</Button>
            </div>
          ) : (
            <>
              <p className="px-1 pt-3 text-xs text-muted-foreground">Add or skip the {dateLabel(occ.repeat.nextDate)} one first.</p>
              <div className="flex flex-col gap-2 pt-3"><Button variant="outline" onClick={() => { close(); nav(`/settings/repeats?id=${occ.repeat._id}`); }}>Edit schedule</Button></div>
            </>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}
