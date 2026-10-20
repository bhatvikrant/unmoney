/**
 * /gmail: every draft from Gmail still waiting, in three groups. "Ready to save" has a method,
 * a category and a confident read, so one tap (or Save all) saves it as it stands. "Needs a
 * look" is missing something or was an uncertain read: it opens in the form. "Already added?"
 * matched an entry the user typed in: the same one, or new after all. Tapping any row opens it
 * in the form, beside the list on a wide screen.
 */
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Check, Mail, Settings, X } from "lucide-react";
import { toast } from "sonner";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useOpenEntry } from "@/lib/nav";
import { useShortcuts } from "@/lib/shortcuts";
import { dateLabel } from "@/lib/format";
import { draftMatches, draftsOpen } from "../../../shared/views";
import type { TxFields } from "../../../shared/ops";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { EmptyState, Section } from "@/components/shell/misc";
import { Money } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Draft = Doc<"drafts">;

/** The entry a draft would save as, when nothing is missing; null when the form has to fill a gap. */
export function draftFields(d: Draft, currencies: { code: string; decimals: number }[], decimals: number): TxFields | null {
  const p = d.proposal;
  if (!p.accountId || !p.amount) return null;
  if (p.type === "transfer" ? !p.toAccountId : !p.categoryId) return null;
  const cur = p.subCurrency ? currencies.find((c) => c.code === p.subCurrency) : undefined;
  const exchangeRate = cur && p.subAmount ? (p.subAmount / 10 ** cur.decimals) / (p.amount / 10 ** decimals) : undefined;
  return {
    type: p.type, date: p.date, time: p.time, accountId: p.accountId, toAccountId: p.type === "transfer" ? p.toAccountId : undefined,
    categoryId: p.type !== "transfer" ? p.categoryId : undefined, subcategoryId: p.type !== "transfer" ? p.subcategoryId : undefined,
    amount: p.amount, subAmount: cur ? p.subAmount : undefined, subCurrency: cur ? cur.code : undefined, exchangeRate,
    note: p.note, description: p.description, tags: [], photoIds: [],
  };
}

export default function GmailReviewPage() {
  const nav = useNavigate();
  const view = useView();
  const { settings, currencies } = useApp();
  const openEntry = useOpenEntry();
  const accept = useOp("drafts.accept");
  const dismiss = useOp("drafts.dismiss");
  const link = useOp("drafts.link");
  const unmatch = useOp("drafts.unmatch");
  const entryOpen = /\/t\//.test(useLocation().pathname);

  const all = useMemo(() => draftsOpen(view), [view]);
  const matches = useMemo(() => draftMatches(view), [view]);
  const txById = useMemo(() => new Map(view.transactions.map((t) => [t._id as string, t])), [view.transactions]);
  const groups = useMemo(() => {
    const ready: Draft[] = [], look: Draft[] = [], matched: { draft: Draft; tx: Doc<"transactions"> }[] = [];
    for (const d of all) {
      const txId = matches.get(d._id);
      const tx = txId ? txById.get(txId) : undefined;
      if (tx) matched.push({ draft: d, tx });
      else if (d.confidence === "high" && draftFields(d, currencies, settings.decimals)) ready.push(d);
      else look.push(d);
    }
    return { ready, look, matched };
  }, [all, matches, txById, currencies, settings.decimals]);
  const order = useMemo(() => [...groups.ready, ...groups.look, ...groups.matched.map((m) => m.draft)], [groups]);

  // keyboard: j/k move, Enter opens, s saves a ready one, x dismisses
  const [cursor, setCursor] = useState<string | null>(null);
  const at = cursor ? order.find((d) => d._id === cursor) : undefined;
  const move = (step: number) => {
    if (!order.length) return;
    const i = at ? order.findIndex((d) => d._id === at._id) : -1;
    setCursor(order[Math.min(order.length - 1, Math.max(0, i + step))]._id);
  };
  useShortcuts({
    j: () => move(1), k: () => move(-1),
    Enter: () => { if (at) openEntry("new", { draft: at._id }); },
    s: () => { if (at) void saveOne(at); },
    x: () => { if (at) void dismissOne(at); },
  }, !entryOpen);

  async function saveOne(d: Draft) {
    const fields = draftFields(d, currencies, settings.decimals);
    if (!fields) { openEntry("new", { draft: d._id }); return; }
    try {
      await accept({ id: d._id, ...fields });
      toast.success(`Saved ${d.proposal.note || "the entry"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }
  async function saveAll() {
    let n = 0;
    for (const d of groups.ready) {
      const fields = draftFields(d, currencies, settings.decimals);
      if (!fields) continue;
      try { await accept({ id: d._id, ...fields }); n++; } catch { /* the row stays, with its own Save */ }
    }
    toast.success(`Saved ${n} ${n === 1 ? "entry" : "entries"}`);
  }
  async function dismissOne(d: Draft) {
    try {
      await dismiss({ ids: [d._id] });
      toast("Dismissed. This mail won't be offered again.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not dismiss");
    }
  }
  async function sameEntry(d: Draft, txId: Id<"transactions">) {
    try {
      await link({ id: d._id, transactionId: txId });
      toast("Linked to the entry you already had");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link");
    }
  }
  async function itsNew(d: Draft) {
    try {
      await unmatch({ id: d._id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  return (
    <>
      <PageHeader back="/" title="From Gmail" right={<Button variant="ghost" size="icon" aria-label="Gmail settings" onClick={() => nav("/settings/gmail")}><Settings className="size-5" /></Button>} />
      <Page className="pb-10">
        {!all.length ? (
          <EmptyState title="Nothing from Gmail to review" hint="New money mail is checked every hour. Entries it finds show up here and as faded rows on their days." action={<Button variant="outline" size="sm" onClick={() => nav("/settings/gmail")}><Mail className="size-4" />Gmail settings</Button>} />
        ) : null}

        {groups.ready.length ? (
          <Section title={<span className="flex items-center justify-between">Ready to save · {groups.ready.length}<Button variant="ghost" size="sm" className="-my-1 h-7 text-xs" onClick={() => void saveAll()}>Save all</Button></span>}>
            {groups.ready.map((d) => (
              <ReviewRow key={d._id} draft={d} focused={cursor === d._id} onOpen={() => openEntry("new", { draft: d._id })} onFocus={() => setCursor(d._id)}
                actions={<>
                  <Button size="sm" className="h-7" onClick={() => void saveOne(d)}><Check className="size-3.5" />Save</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => void dismissOne(d)}><X className="size-3.5" />Dismiss</Button>
                </>} />
            ))}
          </Section>
        ) : null}

        {groups.look.length ? (
          <Section title={`Needs a look · ${groups.look.length}`}>
            {groups.look.map((d) => (
              <ReviewRow key={d._id} draft={d} focused={cursor === d._id} onOpen={() => openEntry("new", { draft: d._id })} onFocus={() => setCursor(d._id)}
                actions={<>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => openEntry("new", { draft: d._id })}>Check</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => void dismissOne(d)}><X className="size-3.5" />Dismiss</Button>
                </>} />
            ))}
          </Section>
        ) : null}

        {groups.matched.length ? (
          <Section title={`Already added? · ${groups.matched.length}`}>
            {groups.matched.map(({ draft: d, tx }) => (
              <ReviewRow key={d._id} draft={d} focused={cursor === d._id} onOpen={() => openEntry("new", { draft: d._id })} onFocus={() => setCursor(d._id)} matched={tx}
                actions={<>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => void sameEntry(d, tx._id)}>Same entry</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => void itsNew(d)}>No, it's new</Button>
                </>} />
            ))}
          </Section>
        ) : null}

        {all.length ? <p className="px-4 pt-6 text-xs text-muted-foreground">Tap a row to check or change it before saving. On a keyboard: j and k move, Enter opens, s saves, x dismisses.</p> : null}
      </Page>
    </>
  );
}

function ReviewRow({ draft: d, matched, actions, focused, onOpen, onFocus }: { draft: Draft; matched?: Doc<"transactions">; actions: React.ReactNode; focused: boolean; onOpen: () => void; onFocus: () => void }) {
  const { accountName, categoryLabel, fmt } = useApp();
  const p = d.proposal;
  const isTransfer = p.type === "transfer";
  const label = isTransfer ? "Transfer" : categoryLabel(p) || "No category";
  const method = p.accountId ? (isTransfer ? `${accountName(p.accountId)} → ${accountName(p.toAccountId)}` : accountName(p.accountId)) : "";
  return (
    <div className={cn("border-b last:border-b-0", focused && "bg-accent/40")} onMouseEnter={onFocus}>
      <div role="button" tabIndex={0} className="flex items-center gap-3 px-4 pt-2.5 pb-1 text-sm cursor-pointer hover:bg-accent/40" onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
        <div className="w-20 shrink-0 text-xs text-muted-foreground leading-tight">
          <div className="text-foreground">{dateLabel(p.date)}</div>
          <div className={cn("line-clamp-2", !p.categoryId && !isTransfer && "text-amber-600 dark:text-amber-400")}>{label}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate">{p.note || label}</div>
          <div className="text-xs text-muted-foreground truncate">
            {method || <span className="text-amber-600 dark:text-amber-400">Pick payment method</span>}
            {p.description ? ` · ${p.description}` : ""}
          </div>
          {matched ? <div className="mt-0.5 text-xs text-muted-foreground truncate">Looks like: {matched.note || categoryLabel(matched) || "an entry"} · {fmt(matched.amount)} · {dateLabel(matched.date)} · {accountName(matched.accountId)}</div> : null}
        </div>
        <div className="text-right shrink-0">
          <Money amount={p.amount} kind={p.type === "income" ? "income" : p.type === "expense" ? "expense" : "transfer"} />
          {d.confidence !== "high" ? <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{d.confidence}</div> : null}
        </div>
      </div>
      <div className="flex items-center gap-1 px-4 pb-2 pl-[6.75rem]">{actions}</div>
    </div>
  );
}
