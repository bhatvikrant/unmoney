/**
 * What sync.changes sends a device, and how the device folds it into its copy. See
 * convex/lib/changes.ts for how the change numbers are handed out.
 */
import type { Doc } from "../convex/_generated/dataModel";
import type { Snapshot, Table } from "./ops";

export type ChangedDocs = { [T in Table]?: Doc<T>[] };
export type Changes =
  | { rev: number; reset: true }
  | { rev: number; reset?: undefined; docs: ChangedDocs; deleted: { table: Table; id: string }[] };

/**
 * The snapshot with these changes in: changed documents replace their old version where it was,
 * new ones go at the end, deleted ones go. Tables nothing touched keep their identity, so what is
 * cached per table (draftMatches, the replay) stays valid.
 */
export function applyChanges(snap: Snapshot, changes: Changes | null | undefined): Snapshot {
  if (!changes || changes.reset) return snap;
  const gone = new Map<Table, Set<string>>();
  for (const { table, id } of changes.deleted) {
    if (!(table in snap)) continue;
    if (!gone.has(table)) gone.set(table, new Set());
    gone.get(table)!.add(id);
  }
  const touched = new Set<Table>([...(Object.keys(changes.docs) as Table[]), ...gone.keys()]);
  if (!touched.size) return snap;
  const out = { ...snap };
  for (const table of touched) {
    const fresh = new Map<string, Doc<Table>>((changes.docs[table] ?? []).map((d) => [d._id as string, d as Doc<Table>]));
    const drop = gone.get(table);
    const next: Doc<Table>[] = [];
    const kept = new Set<string>();
    for (const d of snap[table] as Doc<Table>[]) {
      // a copy holds each document once, whatever got in before
      if (drop?.has(d._id) || kept.has(d._id)) continue;
      kept.add(d._id);
      const updated = fresh.get(d._id);
      next.push(updated ?? d);
      fresh.delete(d._id);
    }
    for (const d of fresh.values()) if (!drop?.has(d._id)) next.push(d);
    (out as Record<Table, unknown[]>)[table] = next;
  }
  return out;
}

/** Whether these changes bring anything. */
export function hasChanges(changes: Changes): boolean {
  return !changes.reset && (changes.deleted.length > 0 || Object.values(changes.docs).some((docs) => docs && docs.length > 0));
}
