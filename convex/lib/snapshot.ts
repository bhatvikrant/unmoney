/**
 * Server side of the op pipeline: load the tables an op needs into a Snapshot, run the shared
 * reducer, then write the difference back (inserts for temporary ids, replaces for changed
 * documents, deletes for missing ones) and report which real id each temporary id received.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  applyOp, clean, emptySnapshot, isTmpId, OP_TABLES, rewriteIds, tmpIdsIn, type Op, type OpKind, type Snapshot, type Table,
} from "../../shared/ops";

export async function loadTable<T extends Table>(ctx: QueryCtx | MutationCtx, userId: Id<"users">, table: T): Promise<Doc<T>[]> {
  const byUser = (t: "settings" | "accountGroups" | "accounts" | "repeats" | "bookmarks" | "budgets" | "currencies" | "categoryCleanups") =>
    ctx.db.query(t).withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  let docs: unknown[];
  switch (table) {
    case "categories": {
      const [e, i] = await Promise.all([
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "expense")).collect(),
        ctx.db.query("categories").withIndex("by_user_type", (q) => q.eq("userId", userId).eq("type", "income")).collect(),
      ]);
      docs = [...e, ...i];
      break;
    }
    case "transactions":
      docs = await ctx.db.query("transactions").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect();
      break;
    case "notes":
      docs = await ctx.db.query("notes").withIndex("by_user_date", (q) => q.eq("userId", userId)).collect();
      break;
    default:
      docs = await byUser(table as "settings");
  }
  return docs as Doc<T>[];
}

export async function loadSnapshot(ctx: QueryCtx | MutationCtx, userId: Id<"users">, tables: Iterable<Table>): Promise<Snapshot> {
  const snap = emptySnapshot();
  await Promise.all([...tables].map(async (t) => { (snap as Record<Table, unknown[]>)[t] = await loadTable(ctx, userId, t); }));
  return snap;
}

export type OpOutcome = { id: string; status: "applied"; idMap: Record<string, string> } | { id: string; status: "rejected"; error: string };

function stableJSON(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]])) : val));
}

/**
 * Run ops in order against the user's documents and persist the result. Each op is applied
 * atomically to an in-memory snapshot; one that throws is reported as rejected and leaves no
 * trace, the rest still go through. Returns one outcome per op, in order.
 */
export async function runOps(ctx: MutationCtx, userId: Id<"users">, ops: Op[]): Promise<OpOutcome[]> {
  const tables = new Set<Table>();
  for (const op of ops) for (const t of OP_TABLES[op.kind as OpKind] ?? []) tables.add(t);
  const before = await loadSnapshot(ctx, userId, tables);
  let snap = before;
  const outcomes: OpOutcome[] = [];
  const applied: Op[] = [];
  for (const op of ops) {
    try {
      if (!(op.kind in OP_TABLES)) throw new Error(`Unknown op ${op.kind}`);
      snap = applyOp(snap, op, { userId }).snap;
      applied.push(op);
      outcomes.push({ id: op.id, status: "applied", idMap: {} });
    } catch (e) {
      outcomes.push({ id: op.id, status: "rejected", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const idMap = await writeDiff(ctx, userId, before, snap, tables);
  for (const o of outcomes) {
    if (o.status !== "applied") continue;
    const prefix = `tmp_${o.id}_`;
    for (const [tmp, real] of Object.entries(idMap)) if (tmp.startsWith(prefix)) o.idMap[tmp] = real;
  }
  return outcomes;
}

const SYSTEM = new Set(["_id", "_creationTime"]);

function fields(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!SYSTEM.has(k) && v !== undefined) out[k] = v;
  return out;
}

async function writeDiff(ctx: MutationCtx, userId: Id<"users">, before: Snapshot, after: Snapshot, tables: Set<Table>): Promise<Record<string, string>> {
  const idMap: Record<string, string> = {};
  const inserted: { table: Table; id: string; doc: Record<string, unknown> }[] = [];
  const replaced: { table: Table; id: string; doc: Record<string, unknown> }[] = [];
  const deleted: { table: Table; id: string }[] = [];
  for (const table of tables) {
    const prev = new Map(before[table].map((d) => [d._id as string, d as Record<string, unknown>]));
    const seen = new Set<string>();
    for (const d of after[table] as Record<string, unknown>[]) {
      const id = d._id as string;
      seen.add(id);
      if (isTmpId(id)) inserted.push({ table, id, doc: d });
      else {
        const old = prev.get(id);
        if (!old) continue; // vanished from the server meanwhile; nothing to replace
        if (stableJSON(clean(old)) !== stableJSON(clean(d))) replaced.push({ table, id, doc: d });
      }
    }
    for (const id of prev.keys()) if (!seen.has(id)) deleted.push({ table, id });
  }
  // Inserts in creation order; references to not-yet-inserted temporary ids are patched afterwards.
  inserted.sort((a, b) => a.doc._creationTime as number - (b.doc._creationTime as number));
  const fixups: { table: Table; id: string; doc: Record<string, unknown> }[] = [];
  for (const { table, id, doc } of inserted) {
    const body = fields(doc);
    const refs = tmpIdsIn(body);
    const unresolved = [...refs].some((r) => !(r in idMap));
    const value = rewriteIds(body, idMap) as Record<string, unknown>;
    if (unresolved) for (const [k, v] of Object.entries(value)) if (isTmpId(v)) delete value[k];
    const real = await ctx.db.insert(table as never, { ...value, userId } as never);
    idMap[id] = real as string;
    if (unresolved) fixups.push({ table, id: real as string, doc: body });
  }
  for (const { table, id, doc } of fixups) {
    const value = rewriteIds(fields(doc), idMap) as Record<string, unknown>;
    await ctx.db.patch(id as Id<Table>, { ...value, userId } as never);
    void table;
  }
  for (const { id, doc } of replaced) {
    const value = rewriteIds(fields(doc), idMap) as Record<string, unknown>;
    await ctx.db.replace(id as Id<Table>, { ...value, userId } as never);
  }
  for (const { id } of deleted) await ctx.db.delete(id as Id<Table>);
  return idMap;
}
