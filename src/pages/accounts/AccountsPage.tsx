import { useState } from "react";
import { useNavigate } from "react-router";
import { CheckSquare, ChevronDown, FolderInput, Pencil, Plus, X } from "lucide-react";
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
import { MoveToGroupSheet } from "./MoveToGroupSheet";
import { CardThumb } from "@/components/CardFace";
import { cardColorOf } from "../../../shared/defaults";
import { SwipeToDelete } from "@/components/shell/SwipeToDelete";
import { DeletePaymentMethodDialog } from "./DeletePaymentMethodDialog";

export default function AccountsPage() {
  const nav = useNavigate();
  const { accountGroups, accountsSummary, accounts, loading } = useApp();
  const move = useOp("accounts.move");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  /** The row swiped open to show Delete, and the method waiting on the delete confirmation. */
  const [swiped, setSwiped] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ _id: Id<"accounts">; name: string } | null>(null);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pick = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exit = () => { setSelecting(false); setSelected(new Set()); };
  const startSelecting = () => { setSwiped(null); setSelecting(true); };
  const shown = accountGroups.flatMap((g) => g.accounts.filter((a) => !a.hidden));
  const chosen = shown.filter((a) => selected.has(a._id));
  // Tick the group in the sheet only when every chosen method is already in it.
  const where = new Set(chosen.map((a) => a.groupId ?? null));
  const current = where.size === 1 ? [...where][0] : undefined;

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
          if (!visible.length) return null;
          // Groups are only folders: a section shows card totals when everything in it is a credit card.
          const allCards = visible.every((a) => a.kind === "card");
          const open = selecting || !collapsed.has(g.id);
          return (
            <div key={g.id} className="mt-3">
              <button type="button" onClick={() => toggle(g.id)} disabled={selecting} className="w-full flex items-center px-4 py-1.5 text-sm text-muted-foreground">
                <ChevronDown className={cn("size-4 mr-1 transition-transform", !open && "-rotate-90")} />
                <span className={cn("flex-1 text-left", !g.group && "italic")}>{g.name}</span>
                {allCards ? (
                  <span className="grid grid-cols-2 gap-4 text-right text-xs"><span><div className="text-[10px]">Balance payable</div><Money amount={g.payable} kind="expense" /></span><span><div className="text-[10px]">Outst. balance</div><Money amount={g.outstanding} kind="expense" /></span></span>
                ) : <Money amount={g.total} kind={g.total < 0 ? "expense" : "income"} />}
              </button>
              {open ? (
                <div className="bg-card border-y">
                  {visible.map((a) => {
                    const row = cn("w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/40 text-left", selected.has(a._id) && "bg-primary/10");
                    const body = (
                      <>
                        {a.kind === "card" || a.kind === "debitCard" ? <CardThumb color={cardColorOf(a)} /> : null}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{a.name}</span>
                          {a.bankName || a.last4 ? <span className="block truncate text-xs text-muted-foreground">{[a.bankName, a.last4 && `•• ${a.last4}`].filter(Boolean).join(" · ")}</span> : null}
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
                          <button type="button" onClick={() => nav(`/payment-methods/${a._id}`)} className={row}>{body}</button>
                        )}
                      </SwipeToDelete>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </Page>
      {selecting ? (
        <div className="fixed bottom-[var(--tabbar-h)] md:bottom-0 inset-x-0 md:left-56 z-30 bg-background/95 backdrop-blur border-t md:safe-bottom">
          <div className="mx-auto max-w-3xl flex items-center gap-2 p-3 text-sm">
            <Button variant="outline" size="sm" onClick={() => setSelected(chosen.length === shown.length ? new Set() : new Set(shown.map((a) => a._id)))}>{chosen.length === shown.length && shown.length ? "Clear" : "Select all"}</Button>
            <span className="text-muted-foreground">{chosen.length} selected</span>
            <span className="flex-1" />
            <Button size="sm" disabled={!chosen.length} onClick={() => setMoving(true)}><FolderInput className="size-4" />Move to…</Button>
            <Button variant="ghost" size="icon" aria-label="Exit selection" onClick={exit}><X className="size-4" /></Button>
          </div>
        </div>
      ) : null}
      <DeletePaymentMethodDialog method={deleting} onOpenChange={(o) => { if (!o) { setDeleting(null); setSwiped(null); } }} />
      <MoveToGroupSheet open={moving} onOpenChange={setMoving} onPick={(id) => void moveTo(id)} current={current} title={`Move ${chosen.length} ${chosen.length === 1 ? "payment method" : "payment methods"} to`} />
    </>
  );
}
