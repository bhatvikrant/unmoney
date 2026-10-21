import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation } from "react-router";
import { useOpenEntry } from "@/lib/nav";
import { ArrowRight, Camera, Mail, Repeat, Star, Users } from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { useView } from "@/lib/store";
import { kindsOf, sumKinds } from "../../../shared/ledger";
import { WEEKDAY_SHORT, parts, weekday } from "../../../shared/dates";
import { Money } from "@/components/shell/Money";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { useConfirm } from "@/components/ConfirmDialog";
import { useUndoableDelete } from "@/lib/undo";
import { DeleteSeriesEntryDialog } from "./DeleteSeriesEntryDialog";
import { UpcomingRow, UpcomingSheet } from "./Upcoming";
import type { Occurrence } from "../../../shared/upcoming";

export type Tx = Doc<"transactions">;
export type Draft = Doc<"drafts">;

/** Ids of the entries that have been bookmarked, for the star in each row. */
function useBookmarkedIds(): Set<string> {
  const { bookmarks } = useView();
  return useMemo(() => new Set(bookmarks.flatMap((b) => (b.transactionId ? [b.transactionId as string] : []))), [bookmarks]);
}

export function TransactionRow({ tx, onClick, onLongPress, selected, onSelect, showDate, bookmarked, open, className }: {
  tx: Tx; onClick?: () => void; onLongPress?: () => void; selected?: boolean; onSelect?: (v: boolean) => void; showDate?: boolean; bookmarked?: boolean; className?: string;
  /** This entry is open in the panel beside the list. */
  open?: boolean;
}) {
  // Holding a row down starts selection; the click that follows the release must not also open the entry.
  const press = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });
  const cancelPress = () => window.clearTimeout(press.current.timer);
  const pressProps = onLongPress ? {
    onPointerDown: () => { press.current.fired = false; cancelPress(); press.current.timer = window.setTimeout(() => { press.current.fired = true; navigator.vibrate?.(10); onLongPress(); }, 450); },
    onPointerUp: cancelPress, onPointerLeave: cancelPress, onPointerCancel: cancelPress, onPointerMove: cancelPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } : {};
  const { accountName, categoryLabel, ledger, fmtSub } = useApp();
  const k = kindsOf(tx, ledger);
  const isTransfer = tx.type === "transfer";
  const kind = tx.type === "income" ? "income" : tx.type === "expense" ? "expense" : k.expense - (tx.feeAmount ?? 0) > 0 ? "expense" : "transfer";
  const label = isTransfer ? "Transfer" : categoryLabel(tx) || "—";
  const route = isTransfer ? `${accountName(tx.accountId)} → ${accountName(tx.toAccountId)}` : accountName(tx.accountId);
  const title = tx.note || (isTransfer ? route : label);
  const sub = isTransfer ? (tx.note ? route : "") : route;
  const amount = isTransfer ? tx.amount : tx.amount;
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm", onClick && "cursor-pointer hover:bg-accent/40 active:bg-accent", onLongPress && "select-none [-webkit-touch-callout:none]", selected && "bg-primary/10", open && "bg-accent", className)}
      aria-current={open || undefined}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } } : undefined}
      onClick={() => { if (press.current.fired) { press.current.fired = false; return; } onClick?.(); }} {...pressProps}>
      {onSelect ? <Checkbox checked={!!selected} onCheckedChange={(v) => onSelect(!!v)} onClick={(e) => e.stopPropagation()} /> : null}
      <div className="w-20 shrink-0 text-xs text-muted-foreground leading-tight line-clamp-2">
        {showDate ? <div className="text-foreground">{tx.date.slice(5).replace("-", "/")}</div> : null}
        {label}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate flex items-center gap-1.5">
          {bookmarked ? <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Bookmarked" /> : null}
          <span className="truncate">{title}</span>
          {tx.installmentIndex ? <Badge variant="secondary" className="text-[10px] px-1 py-0">{tx.installmentIndex}/{tx.installmentCount}</Badge> : null}
          {tx.repeatId && !tx.installmentIndex ? <Repeat className="size-3 text-muted-foreground shrink-0" /> : null}
          {tx.photoIds.length ? <Camera className="size-3 text-muted-foreground shrink-0" /> : null}
          {tx.split ? <Users className="size-3 text-muted-foreground shrink-0" aria-label="Split on UnSplit" /> : null}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
          {isTransfer && !tx.note ? null : sub}
          {tx.tags.length ? <span className="truncate">{tx.tags.map((t) => `#${t}`).join(" ")}</span> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        <Money amount={amount} kind={kind} />
        {tx.subAmount && tx.subCurrency ? <div className="text-[11px] text-muted-foreground">{fmtSub(tx.subAmount, tx.subCurrency)}</div> : null}
        {isTransfer && tx.feeAmount ? <div className="text-[11px] text-expense">fee <Money amount={tx.feeAmount} kind="expense" /></div> : null}
      </div>
    </div>
  );
}

/** `totals: false` for a day with nothing saved yet (only drafts or upcoming rows): there is nothing to add up. */
export function DayHeader({ date, income, expense, totals = true }: { date: string; income: number; expense: number; totals?: boolean }) {
  const { d, y, m } = parts(date);
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b text-sm">
      <span className="text-xl font-semibold tabular w-8">{d}</span>
      <span className="text-[11px] text-muted-foreground">{String(m).padStart(2, "0")}/{y}</span>
      <span className="text-[10px] rounded bg-muted-foreground/70 text-background px-1.5 py-0.5">{WEEKDAY_SHORT[weekday(date)]}</span>
      <span className="flex-1" />
      {totals ? (
        <>
          <Money amount={income} kind="income" className="text-xs opacity-60" />
          <Money amount={expense} kind="expense" className="text-xs w-24 text-right opacity-60" />
        </>
      ) : null}
    </div>
  );
}

/**
 * A draft read from Gmail, on its day in the ledger: the same shape of row, faded, until it is
 * saved. Not selectable, not swipeable (that would read as deleting an entry); dismissing happens
 * in the form or on the review page.
 */
export function DraftRow({ draft, onClick, className }: { draft: Draft; onClick?: () => void; className?: string }) {
  const { accountName, categoryLabel, fmtSub } = useApp();
  const p = draft.proposal;
  const isTransfer = p.type === "transfer";
  const label = isTransfer ? "Transfer" : categoryLabel(p) || "—";
  const method = p.accountId ? (isTransfer ? `${accountName(p.accountId)} → ${accountName(p.toAccountId)}` : accountName(p.accountId)) : "";
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-2.5 border-b last:border-b-0 text-sm", onClick && "cursor-pointer hover:bg-accent/40 active:bg-accent", className)}
      role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} aria-label={`Unsaved entry from Gmail: ${p.note || label}`}
      onClick={onClick} onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="w-20 shrink-0 text-xs text-muted-foreground leading-tight line-clamp-2">{label}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate flex items-center gap-1.5">
          <Mail className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{p.note || label}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">
          Unsaved{method ? ` · ${method}` : ""}{!p.accountId ? <span className="text-amber-600 dark:text-amber-400"> · Pick payment method</span> : null}
        </div>
      </div>
      <div className="text-right shrink-0">
        <Money amount={p.amount} kind={p.type === "income" ? "income" : p.type === "expense" ? "expense" : "transfer"} />
        {p.subAmount && p.subCurrency ? <div className="text-[11px] text-muted-foreground">{fmtSub(p.subAmount, p.subCurrency)}</div> : null}
      </div>
    </div>
  );
}

/** A row's key: a draft and the entry it becomes share one, so the row fades up in place instead of remounting. */
const rowKey = (t: Tx) => (t.source ? `g:${t.source.messageId}` : t._id);

/** Faded while the row is a draft, solid once saved; a 300 ms fade between the two, none under reduced motion. */
function Fade({ faded, children }: { faded: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <motion.div initial={false} animate={{ opacity: faded ? 0.55 : 1 }} transition={{ duration: reduced ? 0 : 0.3 }}>{children}</motion.div>;
}

/**
 * Entries grouped by day, with any drafts from Gmail and coming dates of repeats (`upcoming`) at the
 * end of their day, faded. Every entry row
 * slides left to uncover Delete (off while selecting), wherever the list is shown: the month, a
 * day, a search, a payment method, a category. Day totals count entries only.
 */
export function TransactionList({ txs, drafts, upcoming, selectable, selected, onToggle, onLongPress, emptyText = "No transactions", className }: {
  txs: Tx[]; drafts?: Draft[]; upcoming?: Occurrence[]; selectable?: boolean; selected?: Set<string>; onToggle?: (id: string, v: boolean) => void; onLongPress?: (id: string) => void;
  emptyText?: string; className?: string;
}) {
  const undoable = useUndoableDelete();
  const confirm = useConfirm();
  /** The row swiped open, and an entry of a series waiting on "only this one / this and future". */
  const swipe = useSwipedRow();
  const [series, setSeries] = useState<Tx | null>(null);
  const [occ, setOcc] = useState<Occurrence | null>(null);
  // Deletes like the editor does: at once with Undo in the toast, or asking first for an entry in a series.
  const remove = (t: Tx) => {
    if (t.repeatId) setSeries(t);
    else void confirm({ title: "Delete this entry?", description: "You can undo this for a few seconds afterwards." })
      .then((ok) => (ok ? undoable.entry(t._id) : undefined)).finally(swipe.close);
  };
  const openEntry = useOpenEntry();
  // From the path (/t/:id, /search/t/:id): a list in a parent route does not get its child route's params.
  const openId = useLocation().pathname.match(/\/t\/([^/]+)$/)?.[1];
  const { ledger } = useApp();
  const bookmarked = useBookmarkedIds();
  const groups = useMemo(() => {
    const map = new Map<string, { txs: Tx[]; drafts: Draft[]; upcoming: Occurrence[] }>();
    const day = (date: string) => {
      let g = map.get(date);
      if (!g) { g = { txs: [], drafts: [], upcoming: [] }; map.set(date, g); }
      return g;
    };
    for (const t of txs) day(t.date).txs.push(t);
    for (const d of drafts ?? []) day(d.proposal.date).drafts.push(d);
    for (const o of upcoming ?? []) day(o.date).upcoming.push(o);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [txs, drafts, upcoming]);
  if (!txs.length && !drafts?.length && !upcoming?.length) return <div className="py-12 text-center text-sm text-muted-foreground">{emptyText}</div>;
  return (
    <div className={className}>
      {groups.map(([date, { txs: list, drafts: dayDrafts, upcoming: dayUpcoming }]) => {
        const k = sumKinds(list, ledger);
        return (
          <Fragment key={date}>
            <DayHeader date={date} income={k.income} expense={k.expense} totals={list.length > 0} />
            {list.map((t) => (
              <Fade key={rowKey(t)} faded={false}>
                <SwipeToDelete className="border-b last:border-b-0" disabled={selectable} {...swipe.row(t._id)} onDelete={() => remove(t)}>
                  <TransactionRow
                    tx={t}
                    onClick={selectable ? () => onToggle?.(t._id, !selected?.has(t._id)) : () => openEntry(t._id)}
                    open={t._id === openId}
                    onLongPress={!selectable && onLongPress ? () => onLongPress(t._id) : undefined}
                    selected={selected?.has(t._id)}
                    bookmarked={bookmarked.has(t._id)}
                    onSelect={selectable ? (v) => onToggle?.(t._id, v) : undefined}
                    className="border-b-0"
                  />
                </SwipeToDelete>
              </Fade>
            ))}
            {dayDrafts.map((d) => (
              <Fade key={`g:${d.messageId}`} faded>
                <DraftRow draft={d} onClick={selectable ? undefined : () => openEntry("new", { draft: d._id })} />
              </Fade>
            ))}
            {dayUpcoming.map((o) => (
              <Fade key={`r:${o.repeat._id}:${o.date}`} faded>
                <UpcomingRow occ={o} onClick={selectable ? undefined : () => setOcc(o)} />
              </Fade>
            ))}
          </Fragment>
        );
      })}
      <DeleteSeriesEntryDialog open={!!series} onOpenChange={(o) => { if (!o) { setSeries(null); swipe.close(); } }}
        onPick={(scope) => { if (series) void undoable.entry(series._id, scope); }} />
      <UpcomingSheet occ={occ} onOpenChange={(o) => { if (!o) setOcc(null); }} />
    </div>
  );
}

export function TransferArrow() {
  return <ArrowRight className="size-3 inline" />;
}
