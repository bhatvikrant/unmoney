import { useState } from "react";
import { toast } from "sonner";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { amountInput, LOCALE_DECIMAL } from "@/lib/format";
import { parseNumber } from "../../../shared/money";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Kinds whose balance is money owed: the user types what they owe, as their statement shows it. */
const OWED = new Set(["card", "loan", "overdraft"]);

/**
 * "What does the bank say?": the user types the real balance and the difference is saved as a
 * transfer from the hidden Balance adjustments account (accounts.adjustBalance), so income and
 * spending are left alone. A match only marks the method reconciled.
 */
export function AdjustBalanceDialog({ open, onOpenChange, account, kind, balance, today }: {
  open: boolean; onOpenChange: (o: boolean) => void; account: Doc<"accounts">; kind: string; balance: number; today: string;
}) {
  const { settings } = useApp();
  const adjust = useOp("accounts.adjustBalance");
  const owed = OWED.has(kind);
  // shown the way the statement shows it: what is owed, for a card
  const shown = owed ? -balance : balance;
  const [text, setText] = useState("");
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setText(amountInput(shown, settings.decimals));
  }
  const n = parseNumber(text, LOCALE_DECIMAL);
  const typed = n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** settings.decimals);
  const target = typed === null ? null : owed ? -typed : typed;
  const delta = target === null ? 0 : target - balance;

  async function save() {
    if (target === null) return;
    try {
      const id = await adjust({ id: account._id, delta, balance: target, date: today });
      onOpenChange(false);
      if (!id) toast.success(`${account.name} matches · reconciled today`);
      else toast.success(`${account.name} adjusted · reconciled today`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust balance</DialogTitle>
          <DialogDescription>UnMoney shows <Money amount={shown} /> {owed ? "owed" : ""} on {account.name} today.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-balance">{owed ? `What ${account.name} says you owe` : `What ${account.name} says the balance is`}</Label>
          <Input id="adjust-balance" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {target === null ? "Type an amount." : delta === 0 ? "That matches. It will be marked as reconciled today." : (
            <>The difference, <Money amount={owed ? -delta : delta} sign className="text-foreground" />, is saved as a transfer {delta > 0 ? "from" : "to"} Balance adjustments. It doesn't count as income or spending.</>
          )}
        </p>
        <DialogFooter>
          <Button disabled={target === null} onClick={() => void save()}>{delta === 0 ? "Mark reconciled" : "Save adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
