import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Pencil, Eye, EyeOff, Search, X, ArrowDownAZ, ArrowDownZA } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOverText, useShortMoney } from "@/lib/budgetText";

export function AccountPicker({ open, onOpenChange, onPick, title = "Payment method", exclude }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (id: Id<"accounts">) => void; title?: string; exclude?: string;
}) {
  const { accountGroups } = useApp();
  const [showHidden, setShowHidden] = useState(false);
  const [byGroup, setByGroup] = useState(true);
  const visible = accountGroups.map((g) => ({ ...g, accounts: g.accounts.filter((a) => (showHidden || !a.hidden) && a._id !== exclude) })).filter((g) => g.accounts.length);
  const flat = visible.flatMap((g) => g.accounts);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex items-center justify-between px-2 pb-2 text-xs text-muted-foreground">
        <button type="button" className="underline-offset-4 hover:underline" onClick={() => setByGroup(!byGroup)}>{byGroup ? "View all" : "View by group"}</button>
        <button type="button" className="flex items-center gap-1 underline-offset-4 hover:underline" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {showHidden ? "Hide hidden" : "Show hidden"}
        </button>
      </div>
      {byGroup ? (
        visible.map((g) => (
          <div key={g.id} className="mb-2">
            <div className="px-2 text-xs text-muted-foreground py-1">{g.name}</div>
            <div className="grid grid-cols-3 gap-1.5">
              {g.accounts.map((a) => (
                <button key={a._id} type="button" onClick={() => { onPick(a._id); onOpenChange(false); }} className="rounded-md border px-2 py-2 text-sm text-left truncate hover:bg-accent">
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {flat.map((a) => (
            <button key={a._id} type="button" onClick={() => { onPick(a._id); onOpenChange(false); }} className="rounded-md border px-2 py-2 text-sm text-left truncate hover:bg-accent">{a.name}</button>
          ))}
        </div>
      )}
      {!flat.length ? <div className="text-sm text-muted-foreground p-4 text-center">No payment methods yet. Add one from the Payment methods tab.</div> : null}
    </BottomSheet>
  );
}

export function CategoryPicker({ open, onOpenChange, type, onPick, budgets }: {
  open: boolean; onOpenChange: (o: boolean) => void; type: "income" | "expense"; onPick: (categoryId: Id<"categories">, subcategoryId?: Id<"categories">) => void;
  /** Each main category's budget in the entry's period, to show what it has left under its name. */
  budgets?: Map<string, { limit: number; spent: number }>;
}) {
  const { categories, settings } = useApp();
  const short = useShortMoney();
  const overText = useOverText();
  const nav = useNavigate();
  const [main, setMain] = useState<Id<"categories"> | null>(null);
  const [query, setQuery] = useState("");
  const [desc, setDesc] = useState(readSortDesc);
  const sorted = useMemo(() => {
    const dir = desc ? -1 : 1;
    // Archived categories are not offered (a main one takes its subcategories with it); entries already on them keep them.
    return categories.filter((c) => !c.deletedAt && !c.archivedAt).sort((a, b) => dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  }, [categories, desc]);
  const mains = sorted.filter((c) => c.type === type && !c.parentId);
  const subs = main ? sorted.filter((c) => c.parentId === main) : [];
  const hasSubs = (id: Id<"categories">) => settings.subcategoryEnabled && sorted.some((c) => c.parentId === id);
  const q = query.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(q);
  // While searching the top level, matching subcategories are listed too ("Food › Lunch") and pick straight away.
  const mainIds = new Set(mains.map((c) => c._id));
  const results = q && !main
    ? sorted.filter((c) => (c.parentId ? settings.subcategoryEnabled && mainIds.has(c.parentId) : mainIds.has(c._id)) && matches(c.name))
    : [];
  const close = () => { onOpenChange(false); setMain(null); setQuery(""); };
  const pickMain = (id: Id<"categories">) => {
    if (hasSubs(id)) { setMain(id); setQuery(""); }
    else { onPick(id); close(); }
  };
  const toggleSort = () => { setDesc(!desc); writeSortDesc(!desc); };
  const nameOf = (id: Id<"categories">) => categories.find((c) => c._id === id)?.name;
  const tile = "rounded-md border px-2 py-2 text-sm text-left truncate hover:bg-accent";
  const shownSubs = q ? subs.filter((s) => matches(s.name)) : subs;
  // a main category's tile: its name (with › when it opens subcategories) and, with a budget, what is left of it
  const mainTile = (c: (typeof mains)[number]) => {
    const b = budgets?.get(c._id);
    const left = b ? b.limit - b.spent : 0;
    return (
      <button key={c._id} type="button" onClick={() => pickMain(c._id)} className={tile}>
        <span className="flex gap-1"><span className="flex-1 truncate">{c.name}</span>{hasSubs(c._id) ? <span className="text-muted-foreground">›</span> : null}</span>
        {b ? <span className={cn("block truncate text-[11px] leading-tight tabular", left < 0 ? "text-expense" : "text-budget-left")}>{left < 0 ? overText(b) : `${short(left)} left`}</span> : null}
      </button>
    );
  };
  return (
    <BottomSheet open={open} onOpenChange={(o) => { if (o) onOpenChange(o); else close(); }} title={
      <span className="flex items-center justify-center gap-2">
        {main ? <button type="button" className="text-muted-foreground" onClick={() => { setMain(null); setQuery(""); }}>‹ Back</button> : null}
        {main ? nameOf(main) : "Category"}
        <Button variant="ghost" size="icon" className="size-6" aria-label="Edit categories" onClick={() => { close(); nav("/settings/categories"); }}><Pencil className="size-3" /></Button>
      </span>
    }>
      <div className="flex items-center gap-1.5 px-0.5 pb-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={main ? `Search in ${nameOf(main) ?? "category"}` : "Search categories"} aria-label="Search categories" className="pl-8 pr-8" />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          ) : null}
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={toggleSort} aria-label={desc ? "Sorted Z to A, switch to A to Z" : "Sorted A to Z, switch to Z to A"}>
          {desc ? <ArrowDownZA className="size-3.5" /> : <ArrowDownAZ className="size-3.5" />} {desc ? "Z–A" : "A–Z"}
        </Button>
      </div>
      {main ? (
        <div className="grid grid-cols-3 gap-1.5">
          {!q ? <button type="button" onClick={() => { onPick(main); close(); }} className={cn(tile, "text-muted-foreground")}>(no subcategory)</button> : null}
          {shownSubs.map((s) => (
            <button key={s._id} type="button" onClick={() => { onPick(main, s._id); close(); }} className={tile}>{s.name}</button>
          ))}
        </div>
      ) : q ? (
        <div className="grid grid-cols-3 gap-1.5">
          {results.map((c) => c.parentId ? (
            <button key={c._id} type="button" onClick={() => { onPick(c.parentId!, c._id); close(); }} className={tile} title={`${nameOf(c.parentId)} › ${c.name}`}>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">{nameOf(c.parentId)} ›</span>
              <span className="block truncate">{c.name}</span>
            </button>
          ) : mainTile(c))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {mains.map(mainTile)}
        </div>
      )}
      {!mains.length ? <div className="text-sm text-muted-foreground p-4 text-center">No {type} categories. Add some in Settings.</div> : null}
      {mains.length && q && !(main ? shownSubs.length : results.length) ? (
        <div className="text-sm text-muted-foreground p-4 text-center">No categories match “{query.trim()}”.</div>
      ) : null}
    </BottomSheet>
  );
}

const SORT_KEY = "unmoney:categorySortDesc";
function readSortDesc() {
  try { return localStorage.getItem(SORT_KEY) === "1"; } catch { return false; }
}
function writeSortDesc(desc: boolean) {
  try { localStorage.setItem(SORT_KEY, desc ? "1" : "0"); } catch { /* storage unavailable: the order still applies for this visit */ }
}
