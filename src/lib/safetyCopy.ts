/**
 * Safety copies (docs/specs/undo-import.md): a full backup kept on this device just before an
 * action that replaces or removes data in bulk (restoring a backup, deleting all entries, changing
 * the main currency), so it can be put back for a week. Its own small IndexedDB database, so the
 * local replica's schema is untouched; cleared on sign-out with everything else.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { BackupData } from "../../shared/ops";

export type SafetyReason = "restore" | "wipe" | "currency" | "undoImport";
export type SafetyCopy = {
  id: string;
  userId: string;
  at: number;
  reason: SafetyReason;
  /** What it holds, for the list without reading the whole copy back. */
  entries: number;
  data: BackupData;
};
export type SafetyCopyInfo = Omit<SafetyCopy, "data">;

/** How many copies a user keeps, and for how long. */
export const SAFETY_KEEP = 3;
export const SAFETY_DAYS = 7;

export const SAFETY_REASON: Record<SafetyReason, string> = {
  restore: "before restoring a backup",
  wipe: "before deleting all entries",
  currency: "before changing the main currency",
  undoImport: "before undoing an import",
};

interface Schema extends DBSchema {
  copies: { key: string; value: SafetyCopy; indexes: { by_user: string } };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbPromise) {
    const p = openDB<Schema>("unmoney-safety", 1, {
      upgrade(d) { d.createObjectStore("copies", { keyPath: "id" }).createIndex("by_user", "userId"); },
      blocking() { void p.then((d) => d.close()); if (dbPromise === p) dbPromise = null; },
      terminated() { if (dbPromise === p) dbPromise = null; },
    });
    p.catch(() => { if (dbPromise === p) dbPromise = null; });
    dbPromise = p;
  }
  return dbPromise;
}

/** Which copies to drop: past their week, and beyond the newest few. */
export function expiredCopies<T extends { id: string; at: number }>(copies: T[], now: number, keep = SAFETY_KEEP, days = SAFETY_DAYS): string[] {
  const sorted = [...copies].sort((a, b) => b.at - a.at);
  return sorted.filter((c, i) => i >= keep || now - c.at > days * 86_400_000).map((c) => c.id);
}

export async function saveSafetyCopy(userId: string, reason: SafetyReason, data: BackupData): Promise<void> {
  const d = await db();
  const at = Date.now();
  await d.put("copies", { id: `${userId}:${at}`, userId, at, reason, entries: data.transactions?.length ?? 0, data });
  await pruneSafetyCopies(userId);
}

async function pruneSafetyCopies(userId: string) {
  const d = await db();
  const all = await d.getAllFromIndex("copies", "by_user", userId);
  for (const id of expiredCopies(all, Date.now())) await d.delete("copies", id);
}

/** This user's copies, newest first, without their data. */
export async function listSafetyCopies(userId: string): Promise<SafetyCopyInfo[]> {
  await pruneSafetyCopies(userId);
  const all = await (await db()).getAllFromIndex("copies", "by_user", userId);
  return all.sort((a, b) => b.at - a.at).map(({ data, ...info }) => { void data; return info; });
}

export async function readSafetyCopy(id: string): Promise<SafetyCopy | undefined> {
  return (await db()).get("copies", id);
}

export async function clearSafetyCopies(): Promise<void> {
  await (await db()).clear("copies");
}
