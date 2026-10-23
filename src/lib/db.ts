/** IndexedDB persistence for the local replica, the op queue and queued photo uploads. */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { TABLES, emptySnapshot, type Op, type Snapshot, type Table } from "../../shared/ops";

export type QueuedOp = Op & { seq: number };
export type Profile = { name?: string; email?: string; image?: string };
export type Meta = {
  userId: string | null;
  user: Profile | null;
  hasSnapshot: boolean;
  idMap: Record<string, string>;
  photoUrls: Record<string, string>;
};

interface Schema extends DBSchema {
  tables: { key: Table; value: unknown[] };
  meta: { key: string; value: unknown };
  ops: { key: number; value: Op & { seq?: number } };
  blobs: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    const p = openDB<Schema>("unmoney", 1, {
      upgrade(d) {
        d.createObjectStore("tables");
        d.createObjectStore("meta");
        d.createObjectStore("ops", { keyPath: "seq", autoIncrement: true });
        d.createObjectStore("blobs");
      },
      // a newer version of the app in another tab needs this connection gone
      blocking() { void p.then((d) => d.close()); if (dbPromise === p) dbPromise = null; },
      terminated() { if (dbPromise === p) dbPromise = null; },
    });
    p.catch(() => { if (dbPromise === p) dbPromise = null; });
    dbPromise = p;
  }
  return dbPromise;
}

/** Runs f, and once more on a fresh connection if it fails (WebKit drops connections: "Connection to Indexed Database server lost"). */
async function withDb<T>(f: (d: IDBPDatabase<Schema>) => Promise<T>): Promise<T> {
  try {
    return await f(await db());
  } catch {
    dbPromise = null;
    return f(await db());
  }
}

/**
 * Set when IndexedDB can't be used at all (storage blocked, some private windows). The app then
 * keeps its queue and photos in memory and works online only; nothing survives a reload.
 */
let memory: { seq: number; blobs: Map<string, Blob> } | null = null;

export function runInMemory(): void {
  memory = { seq: 0, blobs: new Map() };
}

const defaultMeta = (): Meta => ({ userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {} });

export async function readAll(): Promise<{ snapshot: Snapshot | null; meta: Meta; ops: QueuedOp[] }> {
  return withDb(async (d) => {
    // One transaction with every read in flight at once: the app opens as soon as the slowest
    // answers, instead of waiting for twenty round trips one after another.
    const tx = d.transaction(["meta", "tables", "ops"], "readonly");
    const keys = Object.keys(defaultMeta()) as (keyof Meta)[];
    const [metaValues, tables, rawOps] = await Promise.all([
      Promise.all(keys.map((k) => tx.objectStore("meta").get(k))),
      Promise.all(TABLES.map((t) => tx.objectStore("tables").get(t))),
      tx.objectStore("ops").getAll(),
    ]);
    const meta = { ...defaultMeta() };
    keys.forEach((k, i) => { if (metaValues[i] !== undefined) (meta as Record<string, unknown>)[k] = metaValues[i]; });
    let snapshot: Snapshot | null = null;
    if (meta.hasSnapshot) {
      snapshot = emptySnapshot();
      TABLES.forEach((t, i) => { (snapshot as Record<Table, unknown[]>)[t] = (tables[i] as unknown[]) ?? []; });
    }
    const ops = (rawOps as QueuedOp[]).sort((a, b) => a.seq - b.seq);
    return { snapshot, meta, ops };
  });
}

/** Write these tables (a whole snapshot, or only the ones that changed) and note that a copy exists. */
export async function writeTables(tables: Partial<Snapshot>): Promise<void> {
  if (memory) return;
  await withDb(async (d) => {
    const tx = d.transaction(["tables", "meta"], "readwrite");
    for (const [t, docs] of Object.entries(tables)) if (docs) void tx.objectStore("tables").put(docs, t as Table);
    void tx.objectStore("meta").put(true, "hasSnapshot");
    await tx.done;
  });
}

export async function writeMeta<K extends keyof Meta>(key: K, value: Meta[K]): Promise<void> {
  if (memory) return;
  await withDb((d) => d.put("meta", value, key));
}

export async function addOp(op: Op): Promise<number> {
  if (memory) return ++memory.seq;
  return (await withDb((d) => d.add("ops", op))) as number;
}

export async function removeOps(seqs: number[]): Promise<void> {
  if (memory) return;
  await withDb(async (d) => {
    const tx = d.transaction("ops", "readwrite");
    for (const s of seqs) void tx.store.delete(s);
    await tx.done;
  });
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  if (memory) { memory.blobs.set(id, blob); return; }
  await withDb((d) => d.put("blobs", blob, id));
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  if (memory) return memory.blobs.get(id);
  return withDb((d) => d.get("blobs", id));
}

export async function deleteBlob(id: string): Promise<void> {
  if (memory) { memory.blobs.delete(id); return; }
  await withDb((d) => d.delete("blobs", id));
}

/** Forget everything: snapshot, queue, uploads and identity. */
export async function wipe(): Promise<void> {
  if (memory) { memory.blobs.clear(); return; }
  await withDb(async (d) => {
    const tx = d.transaction(["tables", "meta", "ops", "blobs"], "readwrite");
    for (const s of ["tables", "meta", "ops", "blobs"] as const) void tx.objectStore(s).clear();
    await tx.done;
  });
}
