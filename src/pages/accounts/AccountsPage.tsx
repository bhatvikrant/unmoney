import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shell/Money";
import { EmptyState } from "@/components/shell/misc";
import { cn } from "@/lib/utils";

export default function AccountsPage() {
  const nav = useNavigate();
  const { accountGroups, accountsSummary, accounts, loading } = useApp();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <>
      <PageHeader title="Accounts" right={<><Button variant="ghost" size="icon" aria-label="Reorder" onClick={() => nav("/accounts/order")}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="Add account" onClick={() => nav("/accounts/new")}><Plus className="size-5" /></Button></>}
        sub={
          <div className="mx-auto max-w-3xl grid grid-cols-3 text-center py-2 text-sm">
            <div><div className="text-xs text-muted-foreground">Assets</div><Money amount={accountsSummary.assets} kind="income" className="font-medium" /></div>
            <div><div className="text-xs text-muted-foreground">Liabilities</div><Money amount={accountsSummary.liabilities} kind="expense" className="font-medium" /></div>
            <div><div className="text-xs text-muted-foreground">Total</div><Money amount={accountsSummary.total} className="font-medium" /></div>
          </div>
        } />
      <Page className="pb-8">
        {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div> : null}
        {!loading && !accounts.length ? <EmptyState title="No accounts" action={<Button onClick={() => nav("/accounts/new")}>Add an account</Button>} /> : null}
        {accountGroups.map((g) => {
          const visible = g.accounts.filter((a) => !a.hidden);
          if (!visible.length) return null;
          const isCard = g.group.kind === "card";
          const open = !collapsed.has(g.group._id);
          return (
            <div key={g.group._id} className="mt-3">
              <button type="button" onClick={() => toggle(g.group._id)} className="w-full flex items-center px-4 py-1.5 text-sm text-muted-foreground">
                <ChevronDown className={cn("size-4 mr-1 transition-transform", !open && "-rotate-90")} />
                <span className="flex-1 text-left">{g.group.name}</span>
                {isCard ? (
                  <span className="grid grid-cols-2 gap-4 text-right text-xs"><span><div className="text-[10px]">Balance payable</div><Money amount={g.payable} kind="expense" /></span><span><div className="text-[10px]">Outst. balance</div><Money amount={g.outstanding} kind="expense" /></span></span>
                ) : <Money amount={g.total} kind={g.total < 0 ? "expense" : "income"} />}
              </button>
              {open ? (
                <div className="bg-card border-y">
                  {visible.map((a) => (
                    <button key={a._id} type="button" onClick={() => nav(`/accounts/${a._id}`)} className="w-full flex items-center px-4 py-3 border-b last:border-b-0 text-sm hover:bg-accent/40 text-left">
                      <span className="flex-1 truncate">{a.name}</span>
                      {isCard ? (
                        <span className="grid grid-cols-2 gap-4 text-right text-xs"><span><Money amount={a.payable ?? 0} kind="expense" /><div className="text-[10px] text-muted-foreground"><Money amount={a.balance} muted /></div></span><Money amount={a.outstanding ?? 0} kind="expense" /></span>
                      ) : a.kind === "debitCard" ? (
                        <span className="text-right"><Money amount={-(a.monthlyUsage ?? 0)} className="text-muted-foreground" /><div className="text-[10px] text-muted-foreground">this month</div></span>
                      ) : (
                        <Money amount={a.balance} kind={!a.includeInTotals ? "plain" : a.balance < 0 ? "expense" : "income"} />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </Page>
    </>
  );
}
