import { useState } from "react";
import type { AccountRow } from "@/lib/app";
import { useLocation, useNavigate } from "react-router";
import { Archive, ArchiveRestore, CheckSquare, ChevronDown, FolderInput, Merge, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { useOp } from "@/lib/store";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Money } from "@/components/shell/Money";
import { EmptyState } from "@/components/shell/misc";
import { cn } from "@/lib/utils";
import { useBottomBar } from "@/components/shell/SplitLayout";
import { MoveToGroupSheet } from "./MoveToGroupSheet";
import { CardThumb } from "@/components/CardFace";
import { cardColorOf } from "../../../shared/defaults";
import { SwipeToDelete } from "@/components/shell/SwipeToDelete";
import { DeletePaymentMethodDialog } from "./DeletePaymentMethodDialog";
import { MergePaymentMethodsDialog } from "./MergePaymentMethodsDialog";
import { HistorySection } from "@/components/HistorySection";
import { useToday } from "@/lib/today";
import { dateLabel } from "@/lib/format";

/** A section's header: a tinted band, so the rows under it read as its contents. */
const sectionHead = "w-full flex items-center px-4 py-2 text-sm text-muted-foreground bg-muted/60";

export default function AccountsPage() {
  const bar = useBottomBar();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { accountGroups, archivedAccounts, accountsSummary, accounts, loading } = useApp();
  const move = useOp("accounts.move");
  const setArchived = useOp("accounts.setArchived");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Groups whose hidden methods are shown (dimmed) under the rest. */
  const [showHidden, setShowHidden] = useState<Set<string>>(new Set());
  const today = useToday();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  /** How many the Move to sheet is moving, set when it opens so its title holds while it closes (the selection clears first). */
  const [moveCount, setMoveCount] = useState(0);
  const [merging, setMerging] = useState<AccountRow[] | null>(null);
  /** The row swiped open to show Delete, and the method waiting on the delete confirmation. */
  const [swiped, setSwiped] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ _id: Id<"accounts">; name: string } | null>(null);
  const flip = (s: Set<string>, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const toggle = (id: string) => setCollapsed((s) => flip(s, id));
  const pick = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exit = () => { setSelecting(false); setSelected(new Set()); };
  const startSelecting = () => { setSwiped(null); setSelecting(true); };
  // What can be ticked: the methods on screen, archived ones included while that section is open.
  const shown = [...accountGroups.flatMap((g) => g.accounts.filter((a) => !a.hidden)), ...(showArchived ? archivedAccounts : [])];
  const chosen = shown.filter((a) => selected.has(a._id));
  // Tick the group in the sheet only when every chosen method is already in it.
  const where = new Set(chosen.map((a) => a.groupId ?? null));
  const current = where.size === 1 ? [...where][0] : undefined;

  /** One method's row: indented under its group's name when it is in one, dimmed when archived. */
  const renderRow = (a: AccountRow, { dim = false, indent = false } = {}) => {
    // what is payable on a card falls due on its payment day; past it, the card is overdue
    const due = a.kind === "card" && a.nextPayment && (a.payable ?? 0) > 0
      ? (today > a.nextPayment ? { text: "Overdue", overdue: true } : { text: `Due ${dateLabel(a.nextPayment)}`, overdue: false })
      : null;
    const row = cn("w-full flex items-center gap-3 py-3 pr-4 text-sm hover:bg-accent/40 text-left", indent ? "pl-9" : "pl-4", selected.has(a._id) && "bg-primary/10", dim && "text-muted-foreground [&_.tabular]:opacity-70");
    const body = (
      <>
        {a.kind === "card" || a.kind === "debitCard" ? <CardThumb color={cardColorOf(a)} /> : null}
        <span className="flex-1 min-w-0">
          <span className="block truncate">{a.name}</span>
          {a.bankName || a.last4 || due ? (
            <span className="block truncate text-xs text-muted-foreground">
              {[a.bankName, a.last4 && `•• ${a.last4}`].filter(Boolean).join(" · ")}
              {due ? <>{a.bankName || a.last4 ? " · " : ""}<span className={cn(due.overdue && "text-destructive font-medium")}>{due.text}</span></> : null}
            </span>
          ) : null}
        </span>
        {a.kind === "card" ? (
          <span className="grid grid-cols-2 gap-4 text-right text-xs"><span><Money amount={a.payable ?? 0} kind="expense" /><div className="text-[10px] text-muted-foreground"><Money amount={a.balance} muted /></div></span><span><Money amount={a.outstanding ?? 0} kind="expense" />{a.upcoming ? <div className="text-[10px] text-muted-foreground"><Money amount={-a.upcoming} sign muted /> upcoming</div> : null}</span></span>
        ) : a.linked ? (
          <span className="text-right"><Money amount={-(a.monthlyUsage ?? 0)} className="text-muted-foreground" /><div className="text-[10px] text-muted-foreground">this month</div></span>
        ) : (
          <span className="text-right">
            <Money amount={a.balance} kind={!a.includeInTotals ? "plain" : a.balance < 0 ? "expense" : "income"} />
            {/* future-dated entries are not in the balance yet */}
            {a.upcoming ? <div className="text-[10px] text-muted-foreground"><Money amount={a.upcoming} sign muted /> upcoming</div> : null}
          </span>
        )}
      </>
    );
    return (
      <SwipeToDelete key={a._id} className="border-b last:border-b-0" disabled={selecting}
        open={swiped === a._id} onOpenChange={(o) => setSwiped(o ? a._id : null)} onDelete={() => setDeleting(a)}>
        {selecting ? (
          <label className={cn(row, "cursor-pointer")}><Checkbox checked={selected.has(a._id)} onCheckedChange={() => pick(a._id)} aria-label={`Select ${a.name}`} />{body}</label>
        ) : (
          <button type="button" aria-current={pathname === `/payment-methods/${a._id}` || pathname.startsWith(`/payment-methods/${a._id}/`) || undefined} onClick={() => nav(`/payment-methods/${a._id}`)} className={cn(row, "aria-[current]:bg-accent")}>{body}</button>
        )}
      </SwipeToDelete>
    );
  };

  // Archive the ticked methods, or bring them back when every one of them is archived already.
  const unarchiving = chosen.length > 0 && chosen.every((a) => a.archivedAt);
  async function archiveChosen() {
    try {
      await setArchived({ ids: chosen.map((a) => a._id), archived: !unarchiving });
      exit();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not change them"); }
  }

  async function moveTo(groupId: Id<"accountGroups"> | undefined) {
    try {
      await move({ ids: chosen.map((a) => a._id), groupId });
      exit();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not move them"); }
  }

  return (
    <>
      <PageHeader title="Payment methods"
        left={accounts.length ? <Button variant="ghost" size="icon" aria-label={selecting ? "Stop selecting" : "Select payment methods"} className={cn(selecting && "text-primary")} onClick={() => (selecting ? exit() : startSelecting())}><CheckSquare className="size-5" /></Button> : null}
        right={<><Button variant="ghost" size="icon" aria-label="Order and visibility" onClick={() => nav("/payment-methods/order")}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="Add payment method" onClick={() => nav("/payment-methods/new")}><Plus className="size-5" /></Button></>}
        sub={
          <div className="mx-auto max-w-3xl grid grid-cols-3 text-center py-2 text-sm">
            <div><div className="text-xs text-muted-foreground">Assets</div><Money amount={accountsSummary.assets} kind="income" className="font-medium" /></div>
            <div><div className="text-xs text-muted-foreground">Liabilities</div><Money amount={accountsSummary.liabilities} kind="expense" className="font-medium" /></div>
            <div><div className="text-xs text-muted-foreground">Total</div><Money amount={accountsSummary.total} className="font-medium" /></div>
          </div>
        } />
      <Page className={cn("pb-8", selecting && "pb-32")}>
        {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div> : null}
        {!loading && !accounts.length ? <EmptyState title="No payment methods" action={<Button onClick={() => nav("/payment-methods/new")}>Add a payment method</Button>} /> : null}
        {accountGroups.map((g) => {
          const visible = g.accounts.filter((a) => !a.hidden);
          // hidden methods still count in the totals: a dimmed row says how many, and shows them
          const hidden = g.accounts.filter((a) => a.hidden);
          const hiddenOpen = showHidden.has(g.id);
          if (!visible.length && selecting) return null;
          // Groups are only folders: a section shows card totals when everything in it is a credit card.
          const allCards = (visible.length ? visible : hidden).every((a) => a.kind === "card");
          const open = selecting || !collapsed.has(g.id);
          return (
            <div key={g.id} className="mt-3 border-y">
              <button type="button" onClick={() => toggle(g.id)} disabled={selecting} aria-expanded={open} className={sectionHead}>
                <ChevronDown className={cn("size-4 mr-1 transition-transform", !open && "-rotate-90")} />
                <span className={cn("flex-1 text-left", g.group ? "font-medium text-foreground/80" : "italic")}>{g.name}</span>
                {allCards ? (
                  <span className="grid grid-cols-2 gap-4 text-right text-xs"><span><div className="text-[10px]">Balance payable</div><Money amount={g.payable} kind="expense" /></span><span><div className="text-[10px]">Outst. balance</div><Money amount={g.outstanding} kind="expense" /></span></span>
                ) : <Money amount={g.total} kind={g.total < 0 ? "expense" : "income"} />}
              </button>
              {open ? (
                <div className="bg-card border-t">
                  {visible.map((a) => renderRow(a, { indent: !!g.group }))}
                  {hidden.length && !selecting ? (
                    <>
                      {hiddenOpen ? hidden.map((a) => renderRow(a, { indent: !!g.group, dim: true })) : null}
                      <button type="button" aria-expanded={hiddenOpen} onClick={() => setShowHidden((s) => flip(s, g.id))}
                        className={cn("w-full flex items-center gap-1 py-2 pr-4 text-xs text-muted-foreground hover:bg-accent/40 text-left border-t", g.group ? "pl-9" : "pl-4")}>
                        <ChevronDown className={cn("size-3.5 transition-transform", !hiddenOpen && "-rotate-90")} />
                        {hiddenOpen ? "Hide" : `${hidden.length} hidden`}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {archivedAccounts.length ? (
          <div className="mt-6 border-y">
            <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived} className={sectionHead}>
              <ChevronDown className={cn("size-4 mr-1 transition-transform", !showArchived && "-rotate-90")} />
              <Archive className="size-3.5 mr-1.5" />
              <span className="flex-1 text-left">Archived</span>
              <span className="text-xs tabular">{archivedAccounts.length}</span>
            </button>
            {showArchived ? (
              <>
                <div className="bg-card border-t">{archivedAccounts.map((a) => renderRow(a, { dim: true }))}</div>
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">Not offered when adding entries. Their entries and balances are kept and still count. Open one to unarchive it.</p>
              </>
            ) : null}
          </div>
        ) : null}
        <HistorySection scope="accounts" />
      </Page>
      {selecting ? (
        <div className={cn(bar, "z-30 bg-background/95 backdrop-blur border-t md:safe-bottom")}>
          <div className="mx-auto max-w-3xl flex items-center gap-2 p-3 text-sm">
            <Button variant="outline" size="sm" onClick={() => setSelected(chosen.length === shown.length ? new Set() : new Set(shown.map((a) => a._id)))}>{chosen.length === shown.length && shown.length ? "Clear" : "Select all"}</Button>
            <span className="text-muted-foreground">{chosen.length}<span className="hidden sm:inline"> selected</span></span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" disabled={!chosen.length} onClick={() => void archiveChosen()} aria-label={unarchiving ? "Unarchive" : "Archive"}>
              {unarchiving ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}<span className="hidden sm:inline">{unarchiving ? "Unarchive" : "Archive"}</span>
            </Button>
            <Button variant="outline" size="sm" disabled={chosen.length < 2} onClick={() => setMerging(chosen)} aria-label="Merge">
              <Merge className="size-4" /><span className="hidden sm:inline">Merge</span>
            </Button>
            <Button size="sm" disabled={!chosen.length} onClick={() => { setMoveCount(chosen.length); setMoving(true); }} aria-label="Move to group"><FolderInput className="size-4" /><span className="hidden sm:inline">Move to…</span></Button>
            <Button variant="ghost" size="icon" aria-label="Exit selection" onClick={exit}><X className="size-4" /></Button>
          </div>
        </div>
      ) : null}
      <MergePaymentMethodsDialog methods={merging} onOpenChange={(o) => { if (!o) setMerging(null); }} onMerged={() => { setMerging(null); exit(); }} />
      <DeletePaymentMethodDialog method={deleting} onOpenChange={(o) => { if (!o) { setDeleting(null); setSwiped(null); } }} />
      <MoveToGroupSheet open={moving} onOpenChange={setMoving} onPick={(id) => void moveTo(id)} current={current} title={`Move ${moveCount} ${moveCount === 1 ? "payment method" : "payment methods"} to`} />
    </>
  );
}
