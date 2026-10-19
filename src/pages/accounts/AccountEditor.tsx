import { useOp } from "@/lib/store";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toMajor, toMinor } from "../../../shared/money";
import { ACCOUNT_KINDS, cardColorOf, type AccountKind } from "../../../shared/defaults";
import { CardColorPicker, CardFace } from "@/components/CardFace";
import { NO_GROUP, NO_GROUP_NAME } from "../../../shared/views";

/** Select value for "no linked account" (a Select item cannot have an empty value). */
const NONE = "none";

export default function AccountEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, accounts, groups } = useApp();
  const existing = id ? accounts.find((a) => a._id === id) : undefined;
  const liveGroups = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  const initial = useMemo(() => ({
    name: existing?.name ?? "",
    kind: (existing?.kind ?? "bank") as AccountKind,
    groupId: (existing?.groupId ?? NO_GROUP) as string,
    amount: existing ? String(toMajor(existing.initialBalance, settings.decimals)) : "0",
    includeInTotals: existing?.includeInTotals ?? true,
    hidden: existing?.hidden ?? false,
    transferAsExpense: existing?.transferAsExpense ?? false,
    description: existing?.description ?? "",
    billingAccountId: (existing?.billingAccountId ?? "") as string,
    settlementDay: String(existing?.settlementDay ?? 1),
    paymentDay: String(existing?.paymentDay ?? 15),
    linkedAccountId: (existing?.linkedAccountId ?? "") as string,
    bankName: existing?.bankName ?? "",
    last4: existing?.last4 ?? "",
    color: existing?.color ?? "",
  }), [existing, settings.decimals]);
  const [f, setF] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const create = useOp("accounts.create");
  const update = useOp("accounts.update");
  const remove = useOp("accounts.remove");
  const kind = f.kind;
  const isCard = kind === "card" || kind === "debitCard";
  const transferable = !["cash", "bank", "card", "debitCard", "upi"].includes(kind);
  // Something a card can bill or a linked method can draw from: not a card, and not itself drawing from another account.
  const others = accounts.filter((a) => a._id !== id && a.kind !== "card" && !a.linked);

  async function save() {
    try {
      const args = {
        name: f.name, kind, groupId: f.groupId === NO_GROUP ? undefined : (f.groupId as Id<"accountGroups">), initialBalance: toMinor(f.amount, settings.decimals), includeInTotals: f.includeInTotals, hidden: f.hidden,
        transferAsExpense: !!transferable && f.transferAsExpense, description: f.description || undefined,
        billingAccountId: kind === "card" && f.billingAccountId ? (f.billingAccountId as Id<"accounts">) : undefined,
        settlementDay: kind === "card" ? Number(f.settlementDay) : undefined, paymentDay: kind === "card" ? Number(f.paymentDay) : undefined,
        linkedAccountId: (kind === "debitCard" || kind === "upi") && f.linkedAccountId && f.linkedAccountId !== NONE ? (f.linkedAccountId as Id<"accounts">) : undefined,
        bankName: isCard ? f.bankName.trim() || undefined : undefined,
        last4: isCard ? f.last4 || undefined : undefined,
        color: isCard ? f.color || undefined : undefined,
      };
      if (args.last4 && args.last4.length !== 4) throw new Error("Enter all 4 last digits, or leave them empty");
      if (id) await update({ id: id as Id<"accounts">, ...args }); else await create(args);
      if (id) nav(-1); else nav("/payment-methods");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  }

  if (id && !existing) return <><PageHeader back="/payment-methods" title="" /><div className="p-8 text-center text-sm text-muted-foreground">Loading…</div></>;
  return (
    <>
      <PageHeader back title={id ? "Edit payment method" : "New payment method"} right={<Button size="sm" onClick={save} disabled={!f.name.trim()}>Save</Button>} />
      <Page className="p-4 space-y-4 pb-10">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Type</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as AccountKind })}><SelectTrigger className="w-full" aria-label="Type"><SelectValue /></SelectTrigger><SelectContent>{ACCOUNT_KINDS.map((k) => <SelectItem key={k.kind} value={k.kind}>{k.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label>Group</Label>
            <Select value={f.groupId} onValueChange={(v) => setF({ ...f, groupId: v })}><SelectTrigger className="w-full" aria-label="Group"><SelectValue /></SelectTrigger><SelectContent>{liveGroups.map((g) => <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>)}<SelectItem value={NO_GROUP}>{NO_GROUP_NAME}</SelectItem></SelectContent></Select>
          </div>
        </div>
        {isCard ? (
          // The card is the form: name, bank and last digits are typed onto it.
          <div className="space-y-3">
            <CardFace kind={kind} name={f.name} bankName={f.bankName} last4={f.last4} color={f.color || cardColorOf({ kind })} className="mx-auto"
              edit={{ autoFocus: !id, onChange: (field, value) => setF((p) => ({ ...p, [field]: value })) }} />
            <p className="text-center text-xs text-muted-foreground">Tap the card to type its name. Bank and last 4 digits are optional, just to tell your cards apart.</p>
            <div className="flex justify-center"><CardColorPicker value={f.color || cardColorOf({ kind })} onChange={(color) => setF((p) => ({ ...p, color }))} /></div>
          </div>
        ) : (
          <div className="space-y-1.5"><Label htmlFor="pm-name">Name</Label><Input id="pm-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!id} /></div>
        )}
        <div className="space-y-1.5"><Label>{id ? "Opening balance" : "Current balance"} ({settings.mainCurrency})</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><p className="text-xs text-muted-foreground">A negative amount records a liability (loan, overdraft, card debt).</p></div>
        {kind === "card" ? (
          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">Credit card</div>
            <div className="space-y-1.5"><Label>Billing account</Label>
              <Select value={f.billingAccountId} onValueChange={(v) => setF({ ...f, billingAccountId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Pick the account that pays this card" /></SelectTrigger><SelectContent>{others.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Settlement day</Label><Input type="number" min={1} max={31} value={f.settlementDay} onChange={(e) => setF({ ...f, settlementDay: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Payment day</Label><Input type="number" min={1} max={31} value={f.paymentDay} onChange={(e) => setF({ ...f, paymentDay: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Spending from the settlement day onward is "outstanding"; everything before it is "payable" on the payment day.</p>
          </div>
        ) : null}
        {kind === "debitCard" || kind === "upi" ? (
          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">{kind === "upi" ? "UPI" : "Debit card"}</div>
            <div className="space-y-1.5"><Label>Linked bank account{kind === "upi" ? " (optional)" : ""}</Label>
              <Select value={f.linkedAccountId || (kind === "upi" ? NONE : "")} onValueChange={(v) => setF({ ...f, linkedAccountId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Pick" /></SelectTrigger><SelectContent>{kind === "upi" ? <SelectItem value={NONE}>None, it holds its own balance</SelectItem> : null}{others.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <p className="text-xs text-muted-foreground">{kind === "upi" && (!f.linkedAccountId || f.linkedAccountId === NONE)
              ? "Without a linked account this UPI works like a wallet with its own balance."
              : `Spending on this ${kind === "upi" ? "UPI" : "card"} is taken from the linked account. It only shows this month's usage itself.`}</p>
          </div>
        ) : null}
        <div className="rounded-lg border divide-y">
          <label className="flex items-center justify-between px-3 py-2.5 text-sm"><span>Include in totals</span><Switch checked={f.includeInTotals} onCheckedChange={(v) => setF({ ...f, includeInTotals: v })} /></label>
          <label className="flex items-center justify-between px-3 py-2.5 text-sm"><span>Hide from lists</span><Switch checked={f.hidden} onCheckedChange={(v) => setF({ ...f, hidden: v })} /></label>
          {transferable ? <label className="flex items-center justify-between px-3 py-2.5 text-sm"><span>Count transfers in as expenses<div className="text-xs text-muted-foreground">For savings, insurance, investments and loans</div></span><Switch checked={f.transferAsExpense} onCheckedChange={(v) => setF({ ...f, transferAsExpense: v })} /></label> : null}
        </div>
        <div className="space-y-1.5"><Label>Description</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        {id ? <Button variant="outline" className="w-full text-destructive" onClick={() => setConfirm(true)}>Delete payment method</Button> : null}
      </Page>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {f.name}?</AlertDialogTitle><AlertDialogDescription>Its transactions are kept. You can restore it from Settings › Deleted payment methods.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async () => { await remove({ id: id as Id<"accounts"> }); nav("/payment-methods"); }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
