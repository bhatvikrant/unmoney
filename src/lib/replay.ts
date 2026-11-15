/**
 * What every screen renders: the local copy with the queued ops replayed on top (see store.tsx).
 *
 * A sent op stays queued until what it wrote has arrived through `changes`, so nothing flickers.
 * But that arrival lands in the copy a moment before the op leaves the queue, and replaying it then
 * would apply it twice: a new entry would be there under its real id (the server's copy) and under
 * its temporary one (the replay), and every total, budget and balance would count it twice for that
 * moment. So an op the server has applied is replayed only until the copy reaches the change number
 * the server gave it; from then on it is skipped and its temporary ids read as the real ones.
 */
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, rewriteIds, type Snapshot } from "../../shared/ops";
import type { QueuedOp } from "./db";

/** Ops the server has applied, by op id: the change number that holds what each wrote, and the real ids it got. */
export type Landed = ReadonlyMap<string, { rev: number; idMap: Record<string, string> }>;

/**
 * The queued ops still to replay on a copy at change number `rev`, and the id map to replay them
 * with: the saved one plus the real ids of the ops the copy already holds (later ops may refer to
 * what those created). The saved map itself when nothing is skipped, so the replay cache holds.
 */
export function unseenOps(ops: QueuedOp[], idMap: Record<string, string>, landed: Landed, rev: number | null): { ops: QueuedOp[]; idMap: Record<string, string> } {
  if (!landed.size || rev === null) return { ops, idMap };
  const rest: QueuedOp[] = [];
  let ids = idMap;
  for (const op of ops) {
    const l = landed.get(op.id);
    if (l && l.rev <= rev) {
      if (Object.keys(l.idMap).length) ids = { ...ids, ...l.idMap };
    } else {
      rest.push(op);
    }
  }
  return rest.length === ops.length ? { ops, idMap } : { ops: rest, idMap: ids };
}

/**
 * The last replay. When the same queue has only grown since (another change made while earlier
 * ones wait to sync, an import's chunks), only the new ops are applied on top of it, instead of
 * every queued op from the base again.
 */
let lastReplay: { base: Snapshot; ops: QueuedOp[]; idMap: Record<string, string>; userId: string; snap: Snapshot } | null = null;

/** The base snapshot with every queued op replayed on top. Ops that no longer apply are skipped. */
export function replay(base: Snapshot, ops: QueuedOp[], idMap: Record<string, string>, userId: string): Snapshot {
  const prev = lastReplay;
  const grown = !!prev && prev.base === base && prev.idMap === idMap && prev.userId === userId && prev.ops.length <= ops.length && prev.ops.every((op, i) => op === ops[i]);
  let snap = grown ? prev.snap : base;
  for (const op of grown ? ops.slice(prev.ops.length) : ops) {
    if (op.kind === "files.upload") continue;
    try {
      snap = applyOp(snap, { ...op, args: rewriteIds(op.args, idMap) }, { userId: userId as Id<"users"> }).snap;
    } catch {
      // the server will reject it too; leave the view consistent
    }
  }
  lastReplay = { base, ops, idMap, userId, snap };
  return snap;
}

/** The local view: `base` (at change number `rev`) with the ops it does not hold yet replayed on top. */
export function viewOf(base: Snapshot, rev: number | null, ops: QueuedOp[], idMap: Record<string, string>, landed: Landed, userId: string): Snapshot {
  const pending = unseenOps(ops, idMap, landed, rev);
  return replay(base, pending.ops, pending.idMap, userId);
}
