import { useMemo, useState } from "react";
import { SlidersHorizontal, CheckSquare } from "lucide-react";
import { useView } from "@/lib/store";
import { txSearch, txTags } from "../../../shared/views";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { TransactionList } from "@/components/tx/TransactionList";
import { BulkBar } from "@/components/tx/BulkActions";
import { useBulkSelect } from "@/components/tx/useBulkSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/shell/Money";
import { sumKinds } from "../../../shared/ledger";
import { cn } from "@/lib/utils";

export default function SearchPage() {
  const { accounts, categories, ledger } = useApp();
  const [q, setQ] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"any" | "income" | "expense" | "transfer">("any");
  const [account, setAccount] = useState<string>("any");
  const [category, setCategory] = useState<string>("any");
  const [tag, setTag] = useState<string>("any");
  const view = useView();
  const tags = useMemo(() => txTags(view), [view]);
  const active = !!(q.trim() || from || to || type !== "any" || account !== "any" || category !== "any" || tag !== "any");
  const results = useMemo(() => active ? txSearch(view, {
    q: q.trim() || undefined, from: from || undefined, to: to || undefined, type: type === "any" ? undefined : type,
    accountIds: account === "any" ? undefined : [account], categoryIds: category === "any" ? undefined : [category], tag: tag === "any" ? undefined : tag,
  }) : undefined, [view, active, q, from, to, type, account, category, tag]);
  const bulk = useBulkSelect();
  const totals = useMemo(() => sumKinds(results ?? [], ledger), [results, ledger]);

  return (
    <>
      <PageHeader back="/" title="Search" right={
        <Button variant="ghost" size="icon" aria-label="Select" className={cn(bulk.active && "text-primary")} onClick={() => (bulk.active ? bulk.exit() : bulk.start())}><CheckSquare className="size-5" /></Button>
      } sub={
        <div className="mx-auto max-w-3xl px-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <Input autoFocus placeholder="Search notes, descriptions, tags" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant={showFilters ? "secondary" : "outline"} size="icon" aria-label="Filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="size-4" /></Button>
          </div>
          {showFilters ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="any">Any type</SelectItem><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent></Select>
              <Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any payment method</SelectItem>{accounts.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
              <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any category</SelectItem>{categories.filter((c) => !c.deletedAt).map((c) => <SelectItem key={c._id} value={c._id}>{c.parentId ? "  ↳ " : ""}{c.name}{c.parentId ? "" : ` (${c.type})`}</SelectItem>)}</SelectContent></Select>
              <Select value={tag} onValueChange={setTag}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any tag</SelectItem>{tags.map((t) => <SelectItem key={t.tag} value={t.tag}>#{t.tag} ({t.count})</SelectItem>)}</SelectContent></Select>
            </div>
          ) : null}
          {results ? <div className="text-xs text-muted-foreground flex gap-3"><span>{results.length} results</span><Money amount={totals.income} kind="income" /><Money amount={totals.expense} kind="expense" /></div> : null}
        </div>
      } />
      <Page className={cn(bulk.active && "pb-40")}>
        {!active ? <div className="p-10 text-center text-sm text-muted-foreground">Type to search, or open the filters.</div> : null}
        {active && results === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Searching…</div> : null}
        {results ? <TransactionList txs={results} selectable={bulk.active} selected={bulk.selected} onToggle={bulk.toggle} onLongPress={bulk.start} emptyText="No matches" /> : null}
      </Page>
      <BulkBar bulk={bulk} txs={results ?? []} />
    </>
  );
}
