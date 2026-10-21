/**
 * /gmail: the entries Gmail found, as a list to pick from before anything is imported. Every one
 * starts ticked, except those that look like an entry the user already has; the bar at the bottom
 * says how many are ticked and what they add up to, and imports them in one go. A gap the mail
 * left (no payment method, no category) is filled with the default method and "Other", and the
 * row says so; tapping a row opens it in the entry form to change anything first. Unticked ones
 * stay here, and in the ledger as faded rows, until they are imported or dismissed.
 */
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Link2, Mail, Settings, X } from "lucide-react";
import { toast } from "sonner";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useOp, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useOpenEntry } from "@/lib/nav";
import { useShortcuts } from "@/lib/shortcuts";
import { dateLabel } from "@/lib/format";
import { draftMatches, draftsOpen } from "../../../shared/views";
import { importable, type Importable } from "../../../shared/gmail/importable";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { useBottomBar } from "@/components/shell/SplitLayout";
import { EmptyState, Section } from "@/components/shell/misc";
import { EntryMoney } from "@/components/shell/Money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";

type Draft = Doc<"drafts">;
type Item = { draft: Draft; ready: Importable | null; matched?: Doc<"transactions"> };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function GmailReviewPage() {
  const nav = useNavigate();
  const view = useView();
  const { settings, currencies, fmt } = useApp();
  const openEntry = useOpenEntry();
  const confirm = useConfirm();
  const bar = useBottomBar();
  const accept = useOp("drafts.accept");
  const dismiss = useOp("drafts.dismiss");
  const link = useOp("drafts.link");
  const entryOpen = /\/t\//.test(useLocation().pathname);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => draftMatches(view), [view]);
  const items = useMemo<Item[]>(() => {
    const txById = new Map(view.transactions.map((t) => [t._id as string, t]));
    const ctx = { accounts: view.accounts, categories: view.categories, currencies, decimals: settings.decimals, defaultAccountId: settings.defaultAccountId };
    return draftsOpen(view).map((draft) => {
      const txId = matches.get(draft._id);
      return { draft, ready: importable(draft, ctx), matched: txId ? txById.get(txId) : undefined };
    });
  }, [view, matches, currencies, settings.decimals, settings.defaultAccountId]);
  const fresh = useMemo(() => items.filter((i) => !i.matched), [items]);
  const maybeAdded = useMemo(() => items.filter((i) => i.matched), [items]);

  // Rows the user flipped away from their default: fresh ones start ticked, "already added?" ones
  // unticked. Keeping the flips (not the ticks) means mail that arrives while the page is open
  // shows up ticked too.
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const isOn = (i: Item) => !!i.ready && (!i.matched !== flipped.has(i.draft._id));
  const toggle = (i: Item) => setFlipped((s) => { const n = new Set(s); if (n.has(i.draft._id)) n.delete(i.draft._id); else n.add(i.draft._id); return n; });
  const selected = items.filter(isOn);
  // "Select all" is about the new entries: the "maybe already added" ones keep their own ticks
  const selectable = fresh.filter((i) => i.ready);
  const allOn = selectable.length > 0 && selectable.every(isOn);
  const setAll = (on: boolean) => setFlipped((s) => {
    const n = new Set([...s].filter((id) => !selectable.some((i) => i.draft._id === id)));
    if (!on) for (const i of selectable) n.add(i.draft._id);
    return n;
  });
  let out = 0, inn = 0;
  for (const i of selected) {
    if (i.draft.proposal.type === "expense") out += i.draft.proposal.amount;
    else if (i.draft.proposal.type === "income") inn += i.draft.proposal.amount;
  }

  async function importSelected() {
    setBusy(true);
    let done = 0, failed = 0;
    for (const i of selected) {
      try { await accept({ id: i.draft._id, ...i.ready!.fields }); done++; } catch { failed++; }
    }
    setBusy(false);
    // imported rows leave the list; the ones the user unticked stay unticked
    if (done) toast.success(`Imported ${plural(done, "entry", "entries")}`, { action: { label: "Open ledger", onClick: () => nav("/") } });
    if (failed) toast.error(`${plural(failed, "entry", "entries")} could not be imported. Open ${failed === 1 ? "it" : "them"} to check.`);
  }
  async function dismissSelected() {
    const n = selected.length;
    if (!(await confirm({ title: `Dismiss ${plural(n, "entry", "entries")}?`, description: "They won't be imported, and these mails won't be offered again.", action: "Dismiss" }))) return;
    await dismiss({ ids: selected.map((i) => i.draft._id) });
    toast(`Dismissed ${plural(n, "entry", "entries")}`);
  }
  async function dismissOne(d: Draft) {
    await dismiss({ ids: [d._id] });
    toast("Dismissed. This mail won't be offered again.");
  }
  async function sameEntry(d: Draft, txId: Id<"transactions">) {
    await link({ id: d._id, transactionId: txId });
    toast("Linked to the entry you already had");
  }

  // keyboard: j/k move, space ticks, Enter opens, x dismisses
  const order = [...fresh, ...maybeAdded];
  const [cursor, setCursor] = useState<string | null>(null);
  const at = cursor ? order.find((i) => i.draft._id === cursor) : undefined;
  const move = (step: number) => {
    if (!order.length) return;
    const idx = at ? order.indexOf(at) : -1;
    setCursor(order[Math.min(order.length - 1, Math.max(0, idx + step))].draft._id);
  };
  useShortcuts({
    j: () => move(1), k: () => move(-1),
    " ": () => { if (at?.ready) toggle(at); },
    Enter: () => { if (at) openEntry("new", { draft: at.draft._id }); },
    x: () => { if (at) void dismissOne(at.draft); },
  }, !entryOpen);

  const row = (i: Item) => (
    <ReviewRow key={i.draft._id} item={i} on={isOn(i)} focused={cursor === i.draft._id}
      onToggle={() => toggle(i)} onOpen={() => openEntry("new", { draft: i.draft._id })} onFocus={() => setCursor(i.draft._id)}
      onDismiss={() => void dismissOne(i.draft)} onSame={i.matched ? () => void sameEntry(i.draft, i.matched!._id) : undefined} />
  );
  const importLabel = busy ? "Importing…" : selected.length > 1 && selected.length === items.length ? `Import all ${selected.length}` : selected.length ? `Import ${selected.length}` : "Import";

  return (
    <>
      <PageHeader back="/" title="From Gmail" right={<Button variant="ghost" size="icon" aria-label="Gmail settings" onClick={() => nav("/settings/gmail")}><Settings className="size-5" /></Button>} />
      <Page className={cn(items.length ? "pb-40" : "pb-10")}>
        {!items.length ? (
          <EmptyState title="Nothing from Gmail to import" hint="New money mail is checked every hour. What it finds shows up here to pick from, and as faded rows on their days." action={<Button variant="outline" size="sm" onClick={() => nav("/settings/gmail")}><Mail className="size-4" />Gmail settings</Button>} />
        ) : (
          <>
            <div className="px-4 pt-4 text-sm">
              <div className="font-medium">{plural(items.length, "entry", "entries")} found in your Gmail</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fresh.length ? "Untick any you don't want, then import the rest." : "Tick any you still want to import, or link them to the entries you have."} Tap a row to check or change it first.</div>
            </div>
            {/* "Select all" only covers new entries, so with none left it would just sit there disabled */}
            {selectable.length ? <label className="mt-3 flex cursor-pointer items-center gap-3 border-y bg-muted/40 px-4 py-2 text-sm md:mx-4 md:rounded-lg md:border">
              <Checkbox checked={allOn} disabled={!selectable.length} onCheckedChange={(v) => setAll(!!v)} aria-label="Select all" />
              <span className="flex-1">{allOn ? "All selected" : "Select all"}</span>
              <span className="tabular text-xs text-muted-foreground">{selected.length} of {items.length} to import</span>
            </label> : <div className="mt-3" />}

            {fresh.length ? <Section title={`New · ${fresh.length}`}>{fresh.map(row)}</Section> : null}
            {maybeAdded.length ? (
              <Section title={`Maybe already added · ${maybeAdded.length}`}>
                <div className="border-b px-4 py-2 text-xs text-muted-foreground">Each of these looks like an entry you typed in, so it starts unticked. Tick it to import it as a new entry anyway, or link it to the one you have.</div>
                {maybeAdded.map(row)}
              </Section>
            ) : null}
          </>
        )}
      </Page>

      {items.length ? (
        <div className={cn(bar, "z-30 border-t bg-background/95 backdrop-blur md:safe-bottom", entryOpen && bar.startsWith("fixed") && "lg:right-[440px]")}>
          <div className="mx-auto max-w-3xl space-y-2 p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{selected.length ? `${plural(selected.length, "entry", "entries")} to import` : "Nothing selected"}</span>
              <span className="tabular">
                {out ? <span className="text-expense">{fmt(out)} out</span> : null}
                {out && inn ? " · " : null}
                {inn ? <span className="text-income">{fmt(inn)} in</span> : null}
              </span>
            </div>
            <div className="flex gap-2">
              <Button className="h-11 flex-1 text-base" disabled={busy || !selected.length} onClick={() => void importSelected()}>{importLabel}</Button>
              <Button variant="outline" className="h-11 text-base" disabled={busy || !selected.length} onClick={() => void dismissSelected()}>Dismiss</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ReviewRow({ item, on, focused, onToggle, onOpen, onFocus, onDismiss, onSame }: {
  item: Item; on: boolean; focused: boolean; onToggle: () => void; onOpen: () => void; onFocus: () => void; onDismiss: () => void; onSame?: () => void;
}) {
  const { accountName, categoryLabel, fmt } = useApp();
  const { draft: d, ready, matched } = item;
  const p = d.proposal;
  const f = ready?.fields;
  const isTransfer = p.type === "transfer";
  const label = isTransfer ? "Transfer" : f?.categoryId ? categoryLabel(f) : "No category";
  const method = isTransfer ? (p.accountId && p.toAccountId ? `${accountName(p.accountId)} → ${accountName(p.toAccountId)}` : "") : f ? accountName(f.accountId) : "";
  const filled = ready?.filled ?? [];
  const guess = (what: "method" | "category") => filled.includes(what) && "text-amber-600 dark:text-amber-400";
  return (
    <div className={cn("flex items-start gap-3 border-b px-4 py-2.5 text-sm last:border-b-0", focused && "bg-accent/40")} onMouseEnter={onFocus}>
      <Checkbox className="mt-1" checked={on} disabled={!ready} onCheckedChange={onToggle} aria-label={`Import ${p.note || label}`} />
      <div role="button" tabIndex={0} className={cn("flex min-w-0 flex-1 cursor-pointer items-start gap-3", !on && "opacity-60")} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOpen(); } }}>
        <div className="w-16 shrink-0 text-xs leading-tight text-muted-foreground">
          <div className="text-foreground">{dateLabel(p.date)}</div>
          <div className={cn("line-clamp-2", guess("category"))}>{label}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate">{p.note || label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {method ? <span className={cn(guess("method"))}>{method}</span> : <span className="text-amber-600 dark:text-amber-400">Open it to pick both methods</span>}
            {p.description ? ` · ${p.description}` : ""}
          </div>
          {filled.length ? <div className="text-[11px] text-amber-600 dark:text-amber-400">{filled.length === 2 ? "Method and category" : filled[0] === "method" ? "Method" : "Category"} filled in; tap to change</div> : null}
          {matched ? <div className="mt-0.5 truncate text-xs text-muted-foreground">Looks like: {matched.note || categoryLabel(matched) || "an entry"} · {fmt(matched.amount)} · {dateLabel(matched.date)}</div> : null}
        </div>
        <div className="shrink-0 text-right">
          <EntryMoney type={p.type} amount={p.amount} />
          {d.confidence !== "high" ? <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{d.confidence}</div> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Dismiss" title="Dismiss (x)" onClick={onDismiss}><X className="size-4" /></Button>
        {onSame ? <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Same entry: link it" title="Same entry: link it" onClick={onSame}><Link2 className="size-4" /></Button> : null}
      </div>
    </div>
  );
}
