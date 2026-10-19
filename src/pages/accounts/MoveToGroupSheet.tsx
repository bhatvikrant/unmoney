import { useState } from "react";
import { Check, FolderOpen, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NO_GROUP_NAME } from "../../../shared/views";

/**
 * Picks where payment methods go: a group, out of every group, or a group made on the spot.
 * `current` is the group they are all in now (null: all outside any group), to tick it.
 */
export function MoveToGroupSheet({ open, onOpenChange, onPick, title = "Move to", current }: {
  open: boolean; onOpenChange: (o: boolean) => void; onPick: (groupId: Id<"accountGroups"> | undefined) => void; title?: string; current?: string | null;
}) {
  const { groups } = useApp();
  const createGroup = useOp("accountGroups.create");
  const [name, setName] = useState<string | null>(null);
  const live = groups.filter((g) => !g.deletedAt).sort((a, b) => a.order - b.order);
  const close = () => { onOpenChange(false); setName(null); };
  const pick = (id: Id<"accountGroups"> | undefined) => { onPick(id); close(); };
  const row = "w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-left hover:bg-accent";
  async function create() {
    try { pick(await createGroup({ name: name ?? "" })); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the group"); }
  }
  return (
    <BottomSheet open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())} title={title}>
      {live.map((g) => (
        <button key={g._id} type="button" className={row} onClick={() => pick(g._id)}>
          <FolderOpen className="size-4 text-muted-foreground" /><span className="flex-1 truncate">{g.name}</span>{current === g._id ? <Check className="size-4" /> : null}
        </button>
      ))}
      <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => pick(undefined)}>
        <span className="size-4" /><span className="flex-1">{NO_GROUP_NAME}</span>{current === null ? <Check className="size-4" /> : null}
      </button>
      {name === null ? (
        <button type="button" className={row} onClick={() => setName("")}><FolderPlus className="size-4 text-muted-foreground" />New group…</button>
      ) : (
        <form className="flex gap-2 px-1 pt-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
          <Input autoFocus placeholder="Group name" aria-label="Group name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>Create</Button>
        </form>
      )}
    </BottomSheet>
  );
}
