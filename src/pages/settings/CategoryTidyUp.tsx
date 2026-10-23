import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ChevronDown, Loader2, WandSparkles } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { applyOp, type CatType, type CleanupResult, type CleanupStep, type Snapshot } from "../../../shared/ops";
import { lintCategories, type QuickFix } from "../../../shared/categoryLint";
import { byDateDesc } from "../../../shared/views";
import { todayISO } from "../../../shared/dates";
import { AI_RUN_EVERY_MS, aiEligibility, stillRelevant, type AiSuggestion } from "../../../shared/tidyAi";
import { useOp, useStore, useView } from "@/lib/store";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { EmptyState, SegmentedTabs } from "@/components/shell/misc";
import { TransactionList, type Tx } from "@/components/tx/TransactionList";
import { CategoryPicker } from "@/components/tx/pickers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useBottomBar } from "@/components/shell/SplitLayout";

/** What the user chose on one card. `target` is a category id, or "new" with `newName`. */
type Choice = { checked: boolean; target?: string; newName: string };
type Card = QuickFix & { title: string; steps: CleanupStep[] | null; entries: Tx[]; total: number; error?: string };

const KIND_TITLES: Record<QuickFix["kind"], string> = { merge: "Merge", rename: "Rename", nest: "Group under", orphan: "Deleted but still used", remove: "Remove unused" };
const KINDS: QuickFix["kind"][] = ["merge", "rename", "nest", "orphan", "remove"];
const CONSENT_KEY = "unmoney:tidyAiConsent";

const defaultChoice = (f: QuickFix): Choice => ({
  checked: f.kind !== "orphan" && f.confidence !== "low",
  target: f.targetId ?? (f.kind === "merge" && f.newName ? "new" : undefined),
  newName: f.newName ?? "",
});

/** AI suggestions as cards. One touching a category a quick fix already covers is left out: the exact rule wins. */
function aiFixes(list: AiSuggestion[], rules: QuickFix[]): QuickFix[] {
  const covered = new Set(rules.flatMap((f) => f.ids as string[]));
  return list
    .filter((s) => ![...s.ids, s.targetId, s.parentId].some((id) => id && covered.has(id)))
    .map((s) => ({
      key: `ai:${s.kind}:${[...s.ids].sort().join(",")}`, type: s.type, kind: s.kind, ids: s.ids, targetId: s.targetId,
      parentId: s.parentId, newName: s.newName, reason: s.reason, source: "ai" as const, confidence: s.confidence,
    }));
}
const TYPES: { type: CatType; title: string }[] = [{ type: "expense", title: "Expenses" }, { type: "income", title: "Income" }];

/** Runs a plan against a copy of the local data, to show what it would do without changing anything. */
function dryRun(view: Snapshot, steps: CleanupStep[], userId: string): { snap: Snapshot; result: CleanupResult } | { error: string } {
  try {
    const out = applyOp(view, { id: "preview", kind: "categories.applyCleanup", args: { steps }, at: Date.now() }, { userId: userId as Id<"users"> });
    return { snap: out.snap, result: out.result as CleanupResult };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cannot apply this" };
  }
}

export default function CategoryTidyUp() {
  const bar = useBottomBar();
  const view = useView();
  const { userId } = useStore();
  const { categoryById } = useApp();
  const nav = useNavigate();
  const apply = useOp("categories.applyCleanup");
  // Worked out once, so the cards stay put while the user edits them.
  const [rules] = useState(() => lintCategories(view));
  // AI suggestions: from a run just now, or else from this month's earlier run.
  const status = useQuery(api.ai.status);
  const [now] = useState(() => Date.now());
  const recent = status && now - status.lastRunAt < AI_RUN_EVERY_MS ? status : null;
  const [fresh, setFresh] = useState<AiSuggestion[] | null>(null);
  const aiList = fresh ?? recent?.result ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ai = useMemo(() => (aiList ? aiFixes(stillRelevant(aiList, view), rules) : []), [aiList, rules]);
  const fixes = useMemo(() => [...rules, ...ai], [rules, ai]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const choiceOf = (f: QuickFix) => choices[f.key] ?? defaultChoice(f);
  const [picking, setPicking] = useState<QuickFix | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string | undefined) => {
    const c = id ? categoryById.get(id) : undefined;
    if (!c) return "?";
    const parent = c.parentId ? categoryById.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };

  const cards = useMemo<Card[]>(() => {
    const txById = new Map(view.transactions.map((t) => [t._id as string, t]));
    return fixes.map((f) => {
      const ch = choiceOf(f);
      const steps = stepsFor(f, ch, nameOf);
      let entries: Tx[] = [];
      let err: string | undefined;
      if (steps) {
        const out = dryRun(view, steps, userId ?? "");
        if ("error" in out) err = out.error;
        else {
          if (out.result.skipped.length) err = out.result.skipped[0].reason;
          const rec = out.snap.categoryCleanups.find((r) => r._id === out.result.cleanupId);
          entries = (rec?.entries ?? []).flatMap((e) => txById.get(e.id) ?? []).sort(byDateDesc);
        }
      }
      return { ...f, title: titleFor(f, ch, nameOf), steps, entries, total: entries.reduce((s, t) => s + t.amount, 0), error: err };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixes, choices, view, userId, categoryById]);

  const chosen = cards.filter((c) => choiceOf(c).checked && c.steps && !c.error);
  const plan = useMemo(() => {
    const steps = chosen.flatMap((c) => c.steps!);
    return steps.length ? dryRun(view, steps, userId ?? "") : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.map((c) => c.key + JSON.stringify(c.steps)).join("|"), view, userId]);
  const changed = plan && !("error" in plan) ? plan.result.changedEntries : 0;

  const set = (f: QuickFix, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [f.key]: { ...(c[f.key] ?? defaultChoice(f)), ...patch } }));
  const setMany = (list: QuickFix[], checked: boolean) => setChoices((c) => ({ ...c, ...Object.fromEntries(list.map((f) => [f.key, { ...(c[f.key] ?? defaultChoice(f)), checked }])) }));

  async function run() {
    setConfirm(false);
    try {
      const result = await apply({ steps: chosen.flatMap((c) => c.steps!) });
      nav("/settings/categories", { replace: true, state: { tidySkipped: result.skipped.map((s) => s.reason) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the changes");
    }
  }

  return (
    <>
      <PageHeader back="/settings/categories" title="Tidy up categories" />
      <Page className="pb-36">
        <AiPanel recentAt={recent?.lastRunAt} found={aiList ? ai.length : null} onResult={setFresh} />
        {!fixes.length ? (
          <EmptyState title="Your categories look tidy" hint="No look-alike names, unused categories or deleted ones still in use." />
        ) : (
          <>
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {fixes.length} {fixes.length === 1 ? "suggestion" : "suggestions"}
              {changed ? ` · ${changed} ${changed === 1 ? "entry" : "entries"} would change` : ""}
            </p>
            {TYPES.map(({ type, title }) => {
              const mine = cards.filter((c) => c.type === type);
              if (!mine.length) return <div key={type} className="px-4 pb-3 text-sm text-muted-foreground">{title} look tidy.</div>;
              const usable = mine.filter((c) => c.steps && !c.error);
              const allOn = usable.length > 0 && usable.every((c) => choiceOf(c).checked);
              return (
                <section key={type} className="mb-4">
                  <label className="flex items-center gap-3 px-4 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    <Checkbox checked={allOn} disabled={!usable.length} onCheckedChange={(v) => setMany(usable, !!v)} aria-label={`Tick all ${title.toLowerCase()} suggestions`} />
                    {title} · {mine.length}
                  </label>
                  <div className="bg-card border-y md:border md:rounded-lg md:mx-4">
                    {KINDS.map((kind) => {
                      const list = mine.filter((c) => c.kind === kind);
                      if (!list.length) return null;
                      return (
                        <div key={kind}>
                          <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">{KIND_TITLES[kind]}</div>
                          {list.map((c) => (
                            <FixCard key={c.key} card={c} choice={choiceOf(c)} nameOf={nameOf} categories={view.categories}
                              onChange={(patch) => set(c, patch)} onPick={() => setPicking(c)} />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </Page>

      {fixes.length ? (
        <div className={cn(bar, "z-30 bg-background border-t md:safe-bottom")}>
          <div className="mx-auto max-w-3xl space-y-2 p-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button variant="outline" className="h-10" disabled={!plan || "error" in plan} onClick={() => setPreview(true)}>Preview new list</Button>
              <Button className="h-10 flex-1" disabled={!chosen.length || !plan || "error" in plan} onClick={() => setConfirm(true)}>
                Apply {chosen.length} {chosen.length === 1 ? "change" : "changes"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {picking ? (
        <CategoryPicker open type={picking.type} onOpenChange={(o) => !o && setPicking(null)}
          onPick={(cat, sub) => { set(picking, { target: sub ?? cat, checked: true }); setPicking(null); }} />
      ) : null}

      <PreviewSheet open={preview} onOpenChange={setPreview} snap={plan && !("error" in plan) ? plan.snap : view} />

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply {chosen.length} {chosen.length === 1 ? "change" : "changes"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {changed ? `${changed} ${changed === 1 ? "entry moves" : "entries move"} to new categories, and past stats will show them there. ` : ""}
              You can undo this from the categories page for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Apply</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The plan steps one card stands for, or null while it still needs the user to choose something. */
function stepsFor(f: QuickFix, ch: Choice, nameOf: (id?: string) => string): CleanupStep[] | null {
  if (f.kind === "remove") return [{ kind: "remove", id: f.ids[0], label: `Removed ${nameOf(f.ids[0])}` }];
  if (f.kind === "rename") {
    const name = ch.newName.trim();
    return name ? [{ kind: "rename", id: f.ids[0], name, label: `Renamed ${nameOf(f.ids[0])} to ${name}` }] : null;
  }
  if (f.kind === "nest") return [{ kind: "nest", id: f.ids[0], parent: { id: f.parentId! }, label: `Moved ${nameOf(f.ids[0])} under ${nameOf(f.parentId)}` }];
  if (!ch.target) return null;
  const others = (target: string) => f.ids.filter((id) => id !== target).map((id) => nameOf(id)).join(", ");
  if (f.kind === "orphan") {
    return [{ kind: "merge", sourceIds: f.ids, target: { id: ch.target as Id<"categories"> }, label: `Moved entries from deleted ${nameOf(f.ids[0])} to ${nameOf(ch.target)}` }];
  }
  if (ch.target === "new") {
    const name = ch.newName.trim();
    if (!name) return null;
    const key = `${f.key}:new`;
    return [
      { kind: "create", key, type: f.type, name, parent: f.parentId ? { id: f.parentId } : undefined },
      { kind: "merge", sourceIds: f.ids, target: { newKey: key }, label: `Merged ${f.ids.map((id) => nameOf(id)).join(", ")} into ${name}` },
    ];
  }
  return [{ kind: "merge", sourceIds: f.ids, target: { id: ch.target as Id<"categories"> }, label: `Merged ${others(ch.target)} into ${nameOf(ch.target)}` }];
}

function titleFor(f: QuickFix, ch: Choice, nameOf: (id?: string) => string): string {
  if (f.kind === "remove") return nameOf(f.ids[0]);
  if (f.kind === "rename") return `${nameOf(f.ids[0])} → ${ch.newName.trim() || "new name"}`;
  if (f.kind === "nest") return `${nameOf(f.ids[0])} → under ${nameOf(f.parentId)}`;
  if (f.kind === "orphan") return `${nameOf(f.ids[0])} → ${ch.target ? nameOf(ch.target) : "choose a category"}`;
  const target = ch.target === "new" ? ch.newName.trim() || "new name" : ch.target;
  const sources = f.ids.filter((id) => id !== target).map((id) => nameOf(id));
  return `${sources.join(", ")} → ${ch.target === "new" ? target : nameOf(target)}`;
}

function FixCard({ card, choice, nameOf, categories, onChange, onPick }: {
  card: Card; choice: Choice; nameOf: (id?: string) => string; categories: Doc<"categories">[];
  onChange: (patch: Partial<Choice>) => void; onPick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { fmt } = useApp();
  const liveIds = card.ids.filter((id) => !categories.find((c) => c._id === id)?.deletedAt);
  const usable = !!card.steps && !card.error;
  const chip = (active: boolean) => cn("rounded-full border px-2.5 py-0.5 text-xs", active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent");
  return (
    <div className="flex gap-3 border-b last:border-b-0 px-4 py-3">
      <Checkbox className="mt-0.5" checked={choice.checked && usable} disabled={!usable} onCheckedChange={(v) => onChange({ checked: !!v })} aria-label={card.title} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="text-sm font-medium break-words">{card.title}</div>
        <div className="text-xs text-muted-foreground">{card.reason}</div>
        {card.source === "ai" ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <WandSparkles className="size-3" /> Suggested by AI{card.confidence === "low" ? " · not sure" : ""}
          </div>
        ) : null}
        {card.kind === "rename" ? (
          <Input value={choice.newName} maxLength={40} placeholder="New name" aria-label="New name" className="h-8 max-w-64"
            onChange={(e) => onChange({ newName: e.target.value })} />
        ) : null}
        {card.kind === "merge" && liveIds.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Keep</span>
            {liveIds.map((id) => (
              <button key={id} type="button" className={chip(choice.target === id)} onClick={() => onChange({ target: id })}>{nameOf(id)}</button>
            ))}
            <button type="button" className={chip(choice.target === "new")} onClick={() => onChange({ target: "new" })}>New name</button>
          </div>
        ) : null}
        {card.kind === "merge" && choice.target === "new" ? (
          <Input autoFocus value={choice.newName} maxLength={40} placeholder="Name for the merged category" aria-label="Name for the merged category" className="h-8 max-w-64"
            onChange={(e) => onChange({ newName: e.target.value })} />
        ) : null}
        {card.kind === "orphan" ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onPick}>{choice.target ? "Change category" : "Choose a category"}</Button>
        ) : null}
        {card.entries.length ? (
          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open}>
            {card.entries.length} {card.entries.length === 1 ? "entry" : "entries"} · {fmt(card.total)}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
        {card.error ? <div className="text-xs text-destructive">{card.error}</div> : null}
        {open ? (
          <div className="-mx-4 mt-1 border-t">
            <TransactionList txs={card.entries.slice(0, 20)} />
            {card.entries.length > 20 ? <div className="px-4 py-2 text-xs text-muted-foreground">and {card.entries.length - 20} more</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The category lists as they would look after the ticked changes. */
function PreviewSheet({ open, onOpenChange, snap }: { open: boolean; onOpenChange: (o: boolean) => void; snap: Snapshot }) {
  const [type, setType] = useState<CatType>("expense");
  const live = snap.categories.filter((c) => c.type === type && !c.deletedAt).sort((a, b) => a.order - b.order);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="New category list">
      <SegmentedTabs value={type} onChange={setType} items={[{ value: "expense", label: "Expenses" }, { value: "income", label: "Income" }]} />
      <div className="py-1 text-sm">
        {live.filter((c) => !c.parentId).map((c) => (
          <div key={c._id}>
            <div className="px-3 py-1.5 font-medium">{c.name}</div>
            {live.filter((s) => s.parentId === c._id).map((s) => <div key={s._id} className="pl-8 pr-3 py-1 text-muted-foreground">{s.name}</div>)}
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

/**
 * The AI half: asks Claude for suggestions once the user has agreed to send a summary, shows the
 * last run's suggestions for the rest of the month, and says why it can't run when it can't.
 */
function AiPanel({ recentAt, found, onResult }: { recentAt?: number; found: number | null; onResult: (list: AiSuggestion[]) => void }) {
  const view = useView();
  const { status: sync } = useStore();
  const suggest = useAction(api.ai.suggestCategoryCleanup);
  const [state, setState] = useState<{ kind: "idle" | "running" | "error"; text?: string }>({ kind: "idle" });
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState(true);
  const eligible = useMemo(() => aiEligibility(view), [view]);
  const nextOn = recentAt ? new Date(recentAt + AI_RUN_EVERY_MS).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";

  async function run(includeNotes: boolean) {
    setConsent(false);
    setState({ kind: "running" });
    try {
      const res = await suggest({ includeNotes, today: todayISO() });
      onResult(res.suggestions);
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", text: e instanceof ConvexError ? String(e.data) : "Couldn't get AI suggestions. Try again later." });
    }
  }
  const start = () => {
    let saved: { notes: boolean } | null = null;
    try { saved = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null"); } catch { /* none */ }
    if (saved) void run(saved.notes);
    else setConsent(true);
  };
  const agree = () => {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ notes })); } catch { /* private mode */ }
    void run(notes);
  };

  let line: string;
  let canRun = false;
  const foundText = found ? `${found} AI ${found === 1 ? "suggestion" : "suggestions"} below` : "AI found nothing else to change";
  if (state.kind === "running") line = "Reading your categories…";
  else if (state.kind === "error") { line = state.text!; canRun = !recentAt; }
  else if (found !== null) line = recentAt ? `${foundText} · new suggestions on ${nextOn}` : foundText;
  else if (recentAt) line = `New AI suggestions on ${nextOn}`;
  else if (!eligible.ok) line = eligible.reason;
  else if (!sync.connected) line = "AI suggestions need a connection";
  else if (sync.pending) line = "Syncing your changes… try again in a moment";
  else { line = "Claude looks for look-alikes, vague names and categories that belong together. Once a month."; canRun = true; }
  if (canRun && (!eligible.ok || !sync.connected || sync.pending)) canRun = false;

  return (
    <>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
        {state.kind === "running" ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <WandSparkles className="size-4 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">AI suggestions</div>
          <div className={cn("text-xs", state.kind === "error" ? "text-destructive" : "text-muted-foreground")}>{line}</div>
        </div>
        {canRun ? <Button size="sm" className="h-8" onClick={start}>{state.kind === "error" ? "Try again" : "Get suggestions"}</Button> : null}
      </div>
      <BottomSheet open={consent} onOpenChange={setConsent} title="Tidy up uses AI">
        <div className="space-y-3 px-2 pb-2 text-sm">
          <p className="text-muted-foreground">
            To suggest changes, UnMoney sends Anthropic's Claude a summary of your expense and income categories: their names, how many entries each
            has, their totals, and the most common notes. It does not send dates, accounts, photos or individual entries. Nothing changes until you
            approve it.
          </p>
          <label className="flex items-center gap-2">
            <Checkbox checked={notes} onCheckedChange={(v) => setNotes(!!v)} />
            Include notes (better suggestions)
          </label>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setConsent(false)}>Not now</Button>
            <Button className="flex-1" onClick={agree}>Continue</Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
