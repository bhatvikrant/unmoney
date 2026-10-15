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
    dbPromise = openDB<Schema>("unmoney", 1, {
      upgrade(d) {
        d.createObjectStore("tables");
        d.createObjectStore("meta");
        d.createObjectStore("ops", { keyPath: "seq", autoIncrement: true });
        d.createObjectStore("blobs");
      },
    });
  }
  return dbPromise;
}

const defaultMeta = (): Meta => ({ userId: null, user: null, hasSnapshot: false, idMap: {}, photoUrls: {} });

export async function readAll(): Promise<{ snapshot: Snapshot | null; meta: Meta; ops: QueuedOp[] }> {
  const d = await db();
  const meta = { ...defaultMeta() };
  for (const k of Object.keys(meta) as (keyof Meta)[]) {
    const v = await d.get("meta", k);
    if (v !== undefined) (meta as Record<string, unknown>)[k] = v;
  }
  let snapshot: Snapshot | null = null;
  if (meta.hasSnapshot) {
    snapshot = emptySnapshot();
    for (const t of TABLES) (snapshot as Record<Table, unknown[]>)[t] = ((await d.get("tables", t)) as unknown[]) ?? [];
  }
  const ops = ((await d.getAll("ops")) as QueuedOp[]).sort((a, b) => a.seq - b.seq);
  return { snapshot, meta, ops };
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  const d = await db();
  const tx = d.transaction(["tables", "meta"], "readwrite");
  for (const t of TABLES) void tx.objectStore("tables").put(snapshot[t], t);
  void tx.objectStore("meta").put(true, "hasSnapshot");
  await tx.done;
}

export async function writeMeta<K extends keyof Meta>(key: K, value: Meta[K]): Promise<void> {
  await (await db()).put("meta", value, key);
}

export async function addOp(op: Op): Promise<number> {
  return (await (await db()).add("ops", op)) as number;
}

export async function removeOps(seqs: number[]): Promise<void> {
  const d = await db();
  const tx = d.transaction("ops", "readwrite");
  for (const s of seqs) void tx.store.delete(s);
  await tx.done;
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await (await db()).put("blobs", blob, id);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await db()).get("blobs", id);
}

export async function deleteBlob(id: string): Promise<void> {
  await (await db()).delete("blobs", id);
}

/** Forget everything: snapshot, queue, uploads and identity. */
export async function wipe(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["tables", "meta", "ops", "blobs"], "readwrite");
  for (const s of ["tables", "meta", "ops", "blobs"] as const) void tx.objectStore(s).clear();
  await tx.done;
}
