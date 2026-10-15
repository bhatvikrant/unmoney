import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Pencil, Eye, EyeOff } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { useApp } from "@/lib/app";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AccountPicker({ open, onOpenChange, onPick, title = "Account", exclude }: {
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
          <div key={g.group._id} className="mb-2">
            <div className="px-2 text-xs text-muted-foreground py-1">{g.group.name}</div>
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
      {!flat.length ? <div className="text-sm text-muted-foreground p-4 text-center">No accounts yet. Add one from the Accounts tab.</div> : null}
    </BottomSheet>
  );
}

export function CategoryPicker({ open, onOpenChange, type, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; type: "income" | "expense"; onPick: (categoryId: Id<"categories">, subcategoryId?: Id<"categories">) => void;
}) {
  const { categories, settings } = useApp();
  const nav = useNavigate();
  const [main, setMain] = useState<Id<"categories"> | null>(null);
  const mains = useMemo(() => categories.filter((c) => c.type === type && !c.parentId && !c.deletedAt), [categories, type]);
  const subs = useMemo(() => (main ? categories.filter((c) => c.parentId === main && !c.deletedAt) : []), [categories, main]);
  const pickMain = (id: Id<"categories">) => {
    const hasSubs = settings.subcategoryEnabled && categories.some((c) => c.parentId === id && !c.deletedAt);
    if (hasSubs) setMain(id);
    else { onPick(id); onOpenChange(false); setMain(null); }
  };
  return (
    <BottomSheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setMain(null); }} title={
      <span className="flex items-center justify-center gap-2">
        {main ? <button type="button" className="text-muted-foreground" onClick={() => setMain(null)}>‹ Back</button> : null}
        {main ? categories.find((c) => c._id === main)?.name : "Category"}
        <Button variant="ghost" size="icon" className="size-6" aria-label="Edit categories" onClick={() => { onOpenChange(false); nav("/settings/categories"); }}><Pencil className="size-3" /></Button>
      </span>
    }>
      {main ? (
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => { onPick(main); onOpenChange(false); setMain(null); }} className="rounded-md border px-2 py-2 text-sm text-left hover:bg-accent text-muted-foreground">(no subcategory)</button>
          {subs.map((s) => (
            <button key={s._id} type="button" onClick={() => { onPick(main, s._id); onOpenChange(false); setMain(null); }} className="rounded-md border px-2 py-2 text-sm text-left truncate hover:bg-accent">{s.name}</button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {mains.map((c) => {
            const hasSubs = settings.subcategoryEnabled && categories.some((x) => x.parentId === c._id && !x.deletedAt);
            return (
              <button key={c._id} type="button" onClick={() => pickMain(c._id)} className={cn("rounded-md border px-2 py-2 text-sm text-left truncate hover:bg-accent", hasSubs && "after:content-['›'] after:float-right after:text-muted-foreground")}>{c.name}</button>
            );
          })}
        </div>
      )}
      {!mains.length ? <div className="text-sm text-muted-foreground p-4 text-center">No {type} categories. Add some in Settings.</div> : null}
    </BottomSheet>
  );
}
