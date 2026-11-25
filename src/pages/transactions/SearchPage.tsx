import { useSearchParams } from "react-router";
import { useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { SlidersHorizontal, CheckSquare, Loader2, Sparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useStore, useView } from "@/lib/store";
import { txSearch, txTags } from "../../../shared/views";
import { todayISO } from "../../../shared/dates";
import { SEARCH_TIMEOUT_MS, validateAnswer } from "../../../shared/searchAi";
import { answerSearch } from "../../../shared/searchAnswer";
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

const PAGE = 300;
const FILTERS = ["from", "to", "type", "account", "category", "tag", "min", "max"];
/** A typed amount as a number, or nothing when the box is empty or holds no amount. */
const amountOf = (s: string) => (s.trim() && Number(s) >= 0 ? Number(s) : undefined);

export default function SearchPage() {
  const { accounts, categories, ledger, fmt } = useApp();
  // Kept in the URL, so opening a result and coming back finds the same search.
  const [sp, setSp] = useSearchParams();
  const param = <T extends string>(key: string, fallback: T) => [
    (sp.get(key) ?? fallback) as T,
    (v: string) => {
      // Start from the live URL, not the last render's params (which setSp's updater gets): two
      // changes in one frame (From and To) would otherwise each start from the old URL and the second would drop the first.
      const n = new URLSearchParams(window.location.search);
      if (v && v !== fallback) n.set(key, v); else n.delete(key);
      setSp(n, { replace: true });
    },
  ] as const;
  // What Ask AI last said, in place of the note under the box. It belongs to the text it was asked about, so typing clears it.
  const [aiNote, setAiNote] = useState("");
  // The question Ask AI is waiting on. Typing empties it, so an answer to text no longer in the box is dropped.
  const asked = useRef("");
  // The box keeps its own state: the router updates the URL inside a transition, and an input
  // driven from there would lose keystrokes and its caret. The URL just mirrors it.
  const [urlQ, setUrlQ] = param("q", "");
  const [q, setQState] = useState<string>(urlQ);
  // How Ask AI said to work out an answer to the question, as "spent.total.category.highest.5" (shared/searchAi.ts
  // SearchAnswer). It belongs to the question, so typing drops it; the filters below can change and it is worked out again.
  const [answerParam, setAnswerParam] = param("answer", "");
  const setQ = (v: string) => { setQState(v); setUrlQ(v); if (answerParam) setAnswerParam(""); setAiNote(""); asked.current = ""; };
  const [showFilters, setShowFilters] = useState(() => FILTERS.some((k) => sp.has(k)));
  const [from, setFrom] = param("from", "");
  const [to, setTo] = param("to", "");
  const [type, setType] = param<"any" | "income" | "expense" | "transfer">("type", "any");
  // one id as picked from the list, or several joined by commas when Ask AI understood more than one
  const [account, setAccount] = param<string>("account", "any");
  const [category, setCategory] = param<string>("category", "any");
  const [tag, setTag] = param("tag", "any");
  const [min, setMin] = param("min", "");
  const [max, setMax] = param("max", "");
  const view = useView();
  // Ask AI shows only for someone the superadmin turned AI on for (convex/lib/auth.ts aiAllowed)
  const { user } = useStore();
  const tags = useMemo(() => txTags(view), [view]);
  // checked again here: the URL can be typed into
  const answer = useMemo(() => {
    const [of, measure, by, order, limit] = answerParam.split(".");
    return validateAnswer({ of, measure, by, order, limit: Number(limit) });
  }, [answerParam]);
  // a question about everything ("how much did I save") has an answer and no filters
  const active = !!(q.trim() || from || to || type !== "any" || account !== "any" || category !== "any" || tag !== "any" || min || max || answer);
  const args = useMemo(() => ({
    q: q.trim() || undefined, from: from || undefined, to: to || undefined, type: type === "any" ? undefined : type,
    accountIds: account === "any" ? undefined : account.split(","), categoryIds: category === "any" ? undefined : category.split(","), tag: tag === "any" ? undefined : tag,
    min: amountOf(min), max: amountOf(max),
  }), [q, from, to, type, account, category, tag, min, max]);
  const results = useMemo(() => (active ? txSearch(view, args) : undefined), [view, active, args]);
  // The answer is worked out here, from the entries listed under it, so a changed filter changes it too.
  const answered = useMemo(() => (answer && results ? answerSearch(view, results, answer, args, fmt, todayISO()) : null), [view, results, answer, args, fmt]);
  const bulk = useBulkSelect();
  // every match counts in the totals and Select all; the list renders a page at a time
  const [more, setMore] = useState<{ for: typeof results; n: number }>({ for: undefined, n: PAGE });
  const shown = more.for === results ? more.n : PAGE; // a new search starts from the first page
  const totals = useMemo(() => sumKinds(results ?? [], ledger), [results, ledger]);

  /**
   * Ask AI: Claude turns the typed question into the filters above (convex/ai.ts askSearch) and the
   * search itself still runs here, on the device. For a question that wants a figure it also says how
   * to work one out, and that too is done here. Nothing is sent until the button is tapped. Offline,
   * on a slow or failed answer, or when no filter comes back, the typed text stays as it is and is
   * searched the plain way, with one line saying so.
   */
  const askSearch = useAction(api.ai.askSearch);
  const [asking, setAsking] = useState(false);
  async function ask() {
    const question = q.trim();
    const plain = (why: string) => setAiNote(`${why.replace(/\.?$/, ".")} Showing matches for the typed text.`);
    if (!navigator.onLine) return plain("You're offline");
    setAsking(true);
    asked.current = question;
    try {
      const f = await Promise.race([
        askSearch({ question, today: todayISO() }),
        new Promise<null>((done) => setTimeout(() => done(null), SEARCH_TIMEOUT_MS)),
      ]);
      if (asked.current !== question) return;
      if (!f) return plain("AI took too long");
      if (!Object.keys(f).length) return plain("AI found no filters in that");
      // The answer replaces the whole search, in one change to the URL.
      const n = new URLSearchParams();
      const put = (key: string, v?: string) => { if (v) n.set(key, v); };
      put("q", f.text); put("from", f.from); put("to", f.to); put("type", f.type);
      put("account", f.accountIds?.join(",")); put("category", f.categoryIds?.join(",")); put("tag", f.tag);
      put("min", f.min?.toString()); put("max", f.max?.toString());
      put("answer", f.answer && [f.answer.of, f.answer.measure, f.answer.by, f.answer.order, f.answer.limit].join("."));
      setSp(n, { replace: true });
      setQState(f.text ?? "");
      setShowFilters(true);
      setAiNote(f.answer ? `Answered "${question}" from the entries below. Change any filter and it is worked out again.` : `Filters set from "${question}". Change any of them below.`);
    } catch (e) {
      // a sentence meant for the person (the month's limit, too long, not set up), or the call never got through
      plain(e instanceof ConvexError ? String(e.data) : "AI couldn't be reached");
    } finally {
      setAsking(false);
    }
  }
  /** Several ids in one filter have no entry of their own in its list: this one stands for them. */
  const several = (ids: string, what: string) => (ids.includes(",") ? <SelectItem value={ids}>{ids.split(",").length} {what}</SelectItem> : null);

  return (
    <>
      <PageHeader back="/" title="Search" right={
        <Button variant="ghost" size="icon" aria-label="Select" className={cn(bulk.active && "text-primary")} onClick={() => (bulk.active ? bulk.exit() : bulk.start())}><CheckSquare className="size-5" /></Button>
      } sub={
        <div className="mx-auto max-w-3xl px-3 pb-2 space-y-2">
          <div className="flex gap-2">
            <Input autoFocus placeholder="Search notes, tags, categories, payment methods" value={q} onChange={(e) => setQ(e.target.value)} />
            {user?.ai ? <Button variant="outline" className="shrink-0" disabled={!q.trim() || asking} onClick={ask}>{asking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Ask AI</Button> : null}
            <Button variant={showFilters ? "secondary" : "outline"} size="icon" aria-label="Filters" onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="size-4" /></Button>
          </div>
          {user?.ai ? (
            <p role="status" className="text-xs text-muted-foreground">
              {aiNote || "Ask AI turns a question into filters. It sends what you typed and the names of your categories, payment methods and tags to Anthropic's Claude."}
            </p>
          ) : null}
          {showFilters ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}><SelectTrigger aria-label="Type"><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="any">Any type</SelectItem><SelectItem value="income">Income</SelectItem><SelectItem value="expense">Expense</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent></Select>
              <Select value={account} onValueChange={setAccount}><SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any payment method</SelectItem>{several(account, "payment methods")}{accounts.map((a) => <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>)}</SelectContent></Select>
              <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any category</SelectItem>{several(category, "categories")}{categories.filter((c) => !c.deletedAt).map((c) => <SelectItem key={c._id} value={c._id}>{c.parentId ? "  ↳ " : ""}{c.name}{c.parentId ? "" : ` (${c.type})`}</SelectItem>)}</SelectContent></Select>
              <Select value={tag} onValueChange={setTag}><SelectTrigger aria-label="Tag"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any tag</SelectItem>{tags.map((t) => <SelectItem key={t.tag} value={t.tag}>#{t.tag} ({t.count})</SelectItem>)}</SelectContent></Select>
              <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Amount from" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Smallest amount" />
              <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Amount to" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Largest amount" />
            </div>
          ) : null}
          {results ? <div className="text-xs text-muted-foreground flex gap-3"><span>{results.length} {results.length === 1 ? "result" : "results"}</span><Money amount={totals.income} kind="income" /><Money amount={totals.expense} kind="expense" /></div> : null}
        </div>
      } />
      <Page className={cn(bulk.active && "pb-40")}>
        {!active ? <div className="p-10 text-center text-sm text-muted-foreground">Type to search, or open the filters.{user?.ai ? ` Or type a question, like "food over 500 last month", and tap Ask AI.` : ""}</div> : null}
        {active && results === undefined ? <div className="p-8 text-center text-sm text-muted-foreground">Searching…</div> : null}
        {answered ? (
          <div className="bg-card border-b text-sm">
            <p role="status" className="px-4 py-3">{answered.text}</p>
            {/* a single row is already in the sentence */}
            {answered.rows.length > 1 ? answered.rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-3 px-4 py-2 border-t">
                <span className="min-w-0 truncate">{r.label}</span>
                {answered.kind === "count" ? <span className="tabular">{r.value}</span> : <Money amount={r.value} kind={answered.kind} />}
              </div>
            )) : null}
          </div>
        ) : null}
        {results ? <TransactionList txs={results.slice(0, shown)} selectable={bulk.active} selected={bulk.selected} onToggle={bulk.toggle} onLongPress={bulk.start} emptyText="No matches" /> : null}
        {results && results.length > shown ? (
          <div className="p-4 text-center"><Button variant="outline" onClick={() => setMore({ for: results, n: shown + PAGE })}>Show more ({results.length - shown} left)</Button></div>
        ) : null}
      </Page>
      <BulkBar bulk={bulk} txs={results ?? []} />
    </>
  );
}
