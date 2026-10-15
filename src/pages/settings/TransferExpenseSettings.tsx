import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Switch } from "@/components/ui/switch";

export default function TransferExpenseSettings() {
  const { accountGroups } = useApp();
  const update = useMutation(api.accounts.update);
  const setHidden = useMutation(api.accounts.setHidden);
  return (
    <>
      <PageHeader back="/settings" title="Account settings" />
      <Page className="pb-8">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wide"><span>Account</span><span className="text-center w-16">In totals</span><span className="text-center w-16">Visible</span><span className="text-center w-16">Transfer = expense</span></div>
        {accountGroups.map((g) => (
          <div key={g.group._id} className="mb-3">
            <div className="px-4 py-1 text-xs text-muted-foreground">{g.group.name}</div>
            <div className="bg-card border-y">
              {g.accounts.map((a) => {
                const transferable = !["cash", "bank", "card", "debitCard"].includes(g.group.kind);
                const patch = (p: Partial<{ includeInTotals: boolean; transferAsExpense: boolean }>) => update({
                  id: a._id, name: a.name, groupId: a.groupId, initialBalance: a.initialBalance, includeInTotals: a.includeInTotals, hidden: a.hidden,
                  transferAsExpense: a.transferAsExpense, description: a.description, billingAccountId: a.billingAccountId, settlementDay: a.settlementDay,
                  paymentDay: a.paymentDay, linkedAccountId: a.linkedAccountId, ...p,
                });
                return (
                  <div key={a._id} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-4 py-2 border-b last:border-b-0 text-sm">
                    <span className="truncate">{a.name}</span>
                    <span className="w-16 flex justify-center"><Switch checked={a.includeInTotals} onCheckedChange={(v) => patch({ includeInTotals: v })} /></span>
                    <span className="w-16 flex justify-center"><Switch checked={!a.hidden} onCheckedChange={(v) => setHidden({ id: a._id, hidden: !v })} /></span>
                    <span className="w-16 flex justify-center">{transferable ? <Switch checked={a.transferAsExpense} onCheckedChange={(v) => patch({ transferAsExpense: v })} /> : <span className="text-xs text-muted-foreground">—</span>}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <p className="px-4 text-xs text-muted-foreground">"Transfer = expense" counts money moved into a savings, insurance, investment or loan account as spending on the Transactions and Stats tabs.</p>
      </Page>
    </>
  );
}
