/**
 * Actions that touch every entry (restore, delete all, change main currency), split so that no
 * single server transaction outgrows Convex's limits: one small op for everything but the
 * entries, and the entries themselves in chunks, by id. All of it is queued at once, so it
 * applies locally straight away and survives going offline or reloading; `synced` settles once
 * the server has confirmed every chunk. A large restore is the exception: see restore.
 */
import { useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useStore } from "@/lib/store";
import { currencyInfo } from "../../shared/currencies";
import { restoreRowsFrom, rewriteIds, scaleAmount, type BackupData } from "../../shared/ops";
import { backupExport } from "../../shared/views";
import { saveSafetyCopy, type SafetyReason } from "./safetyCopy";
import type { BackupPhotos } from "./backupFile";
import type { Id } from "../../convex/_generated/dataModel";

const CHUNK = 500;
/**
 * Up to this many entries one op does it all on the server, at once and including entries this
 * device has not seen yet (made on another device, or by the hourly repeats job). Beyond it the
 * entries go in chunks by id; for a wipe or restore the server then sweeps away any older entries
 * the chunks did not name (sync.sweepEntries). A currency change past it can miss an entry that
 * arrives meanwhile. Each delete writes the entry and a tombstone for the other devices, so this stays
 * well under half of Convex's 16,000 writes a transaction (8,000 failed, and the wipe was "undone").
 */
const ONE_OP = 5_000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export function useBulkOps() {
  const { view, userId, status, dispatchTracked, whenSynced, enqueueUpload } = useStore();
  const convex = useConvex();
  // the data as of the last render, for an action started later from a toast (Undo after an import)
  const latest = useRef(view);
  useLayoutEffect(() => { latest.current = view; });

  /**
   * Keep everything as it is now on this device before replacing or removing it in bulk, so Backup ›
   * Safety copies can put it back. A device that can't store it (private mode, storage full) says so and goes on.
   */
  async function safetyCopy(reason: SafetyReason) {
    const now = latest.current;
    if (!userId || !now.transactions.length) return;
    try {
      await saveSafetyCopy(userId, reason, backupExport(now));
    } catch {
      toast.warning("Couldn't keep a safety copy on this device. Download a backup first if you may want this data back.");
    }
  }

  /**
   * The photos of a backup that this account already has, as the server tells it: the backup was made here,
   * so they keep their ids. Uploading them again doubled the account's storage on every restore and left
   * the first copies with nothing pointing at them. Offline (or with no answer in ten seconds) nothing is
   * known, so every photo is uploaded: wasteful, but no photo is left out on a guess.
   */
  async function alreadyHere(ids: string[]): Promise<Set<string>> {
    const here = new Set<string>();
    for (let i = 0; status.connected && i < ids.length; i += 200) {
      const got = await Promise.race([
        convex.query(api.files.owned, { ids: ids.slice(i, i + 200) as Id<"_storage">[] }).catch(() => [] as string[]),
        new Promise<string[]>((done) => setTimeout(() => done([]), 10_000)),
      ]);
      for (const id of got) here.add(id);
    }
    return here;
  }

  /**
   * Queue the photos a backup file carries for upload, and point its entries at the new copies. The uploads
   * sit in the queue ahead of the restore, so this works offline too. A photo this account already has, one
   * the file does not carry, or one this device can't queue (storage full) keeps its old id.
   */
  async function withPhotos(data: BackupData, photos?: BackupPhotos): Promise<BackupData> {
    if (!photos?.size) return data;
    const named = (data.transactions ?? []).flatMap((t) => (Array.isArray(t.photoIds) ? (t.photoIds as string[]) : []));
    const here = await alreadyHere([...new Set(named.filter((id) => photos.has(id)))]);
    const ids: Record<string, string> = {};
    let failed = 0;
    for (const t of data.transactions ?? []) {
      for (const id of Array.isArray(t.photoIds) ? (t.photoIds as string[]) : []) {
        const read = photos.get(id);
        if (!read || ids[id] || here.has(id)) continue;
        try { ids[id] = await enqueueUpload(await read()); } catch { failed++; }
      }
    }
    if (failed) toast.warning(`${failed.toLocaleString()} ${failed === 1 ? "photo" : "photos"} in the backup could not be read or kept on this device, so ${failed === 1 ? "it was" : "they were"} not restored.`);
    return { ...data, transactions: rewriteIds(data.transactions, ids) };
  }

  async function removeEntries(ifPresent?: boolean): Promise<string[]> {
    const ids: string[] = [];
    for (const part of chunks(view.transactions.map((t) => t._id))) ids.push((await dispatchTracked("transactions.bulkRemove", { ids: part, ifPresent })).id);
    return ids;
  }

  /** Refuses up front (with a message) a change of scale that would push an amount past the limit. */
  function assertFits(factor: number) {
    try {
      for (const t of view.transactions) for (const n of [t.amount, t.feeAmount, t.installmentTotal]) if (n !== undefined) scaleAmount(n, factor);
      for (const a of view.accounts) scaleAmount(a.initialBalance, factor);
      for (const b of view.budgets) for (const n of [b.amount, ...(b.earlier ?? []).map((e) => e.amount)]) scaleAmount(n, factor);
    } catch (e) {
      toast.error("Some amounts would be too large with that many decimal places.");
      throw e;
    }
  }

  /** Resolves once the server has confirmed every op; throws if it refused any. */
  async function confirmed(opIds: string[]): Promise<void> {
    const { rejected } = await whenSynced(opIds);
    if (rejected.length) throw new Error(`${rejected.length} of ${opIds.length} parts could not be saved: ${rejected[0].error}`);
  }

  /**
   * Waits for the server, with a toast that stays up until it has confirmed (or refused) every op.
   * Its error is marked `reported`: the toast has already shown it.
   */
  function track(work: string[] | Promise<void>, messages: { loading: string; success: string }): Promise<void> {
    const synced = (Array.isArray(work) ? confirmed(work) : work).catch((e: unknown) => {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { reported: true });
    });
    toast.promise(synced, { loading: messages.loading, success: messages.success, error: (e: Error) => e.message });
    return synced;
  }

  return {
    /** Remove every entry an import added (by its importId) and mark it undone in the list. Payment methods and categories it made stay. */
    async undoImport(importId: string) {
      await safetyCopy("undoImport");
      const now = latest.current;
      const gone = now.transactions.filter((t) => t.importId === importId).map((t) => t._id);
      const ids: string[] = [];
      for (const part of chunks(gone)) ids.push((await dispatchTracked("transactions.bulkRemove", { ids: part, ifPresent: true })).id);
      const recentImports = (now.settings[0]?.recentImports ?? []).map((x) => (x.id === importId ? { ...x, undoneAt: Date.now() } : x));
      ids.push((await dispatchTracked("settings.update", { patch: { recentImports } })).id);
      return track(ids, { loading: "Undoing the import…", success: `Removed ${gone.length.toLocaleString()} imported ${gone.length === 1 ? "entry" : "entries"}` });
    },

    async wipeAll() {
      await safetyCopy("wipe");
      if (view.transactions.length <= ONE_OP) {
        const { id } = await dispatchTracked("backup.wipeAll", { confirm: "DELETE" });
        return track([id], { loading: "Deleting entries…", success: "Entries deleted" });
      }
      const ids = await removeEntries();
      ids.push((await dispatchTracked("backup.wipeAll", { confirm: "DELETE", entries: false })).id);
      return track(ids, { loading: "Deleting entries… keep UnMoney open until it is saved", success: "Entries deleted" });
    },

    /** `photos`: the receipt photos the backup file carries, re-uploaded for this account. */
    async restore(backup: BackupData, photos?: BackupPhotos) {
      await safetyCopy("restore");
      const data = await withPhotos(backup, photos);
      if (view.transactions.length + (data.transactions?.length ?? 0) <= ONE_OP) {
        const { id } = await dispatchTracked("backup.restore", { data });
        return track([id], { loading: "Restoring…", success: "Restored" });
      }
      // Everything but the entries goes first, and alone. The backup's entries are queued right behind it,
      // not once the server has answered: a reload or a closed tab in between (easy when offline) left the
      // restore applied, the old entries swept by the server and the new ones never sent, i.e. an empty
      // ledger. They name the payment methods the restore made, so the queue drops them if it is refused.
      const restored = await dispatchTracked("backup.restore", { data: { ...data, transactions: [] }, entries: false });
      const ids: string[] = [];
      for (const rows of chunks(restoreRowsFrom(data, restored.result))) ids.push((await dispatchTracked("transactions.restoreRows", { rows, bookmarks: restored.result.bookmarks })).id);
      return track((async () => {
        const { rejected } = await whenSynced([restored.id]);
        if (rejected.length) throw new Error(`Nothing was restored: ${rejected[0].error}`);
        // Only now do the old entries go from this device, so a refused restore leaves the ledger as it
        // was. The server sweeps them itself after the restore (hence ifPresent); if the app is closed
        // before this runs, that sweep reaches this device as ordinary changes.
        ids.push(...await removeEntries(true));
        await confirmed(ids);
      })(), { loading: "Restoring… keep UnMoney open until it is saved", success: "Restored" });
    },

    async changeDecimals(decimals: number) {
      const current = view.settings[0]?.decimals ?? 2;
      const factor = 10 ** (decimals - current);
      assertFits(factor);
      const success = `Amounts now have ${decimals} decimal ${decimals === 1 ? "place" : "places"}`;
      if (view.transactions.length <= ONE_OP) {
        const { id } = await dispatchTracked("settings.changeDecimals", { decimals });
        return track([id], { loading: "Updating amounts…", success });
      }
      const ids: string[] = [];
      for (const part of chunks(view.transactions.map((t) => t._id as Id<"transactions">))) ids.push((await dispatchTracked("transactions.rescale", { ids: part, factor })).id);
      ids.push((await dispatchTracked("settings.changeDecimals", { decimals, entries: false })).id);
      return track(ids, { loading: "Updating amounts…", success });
    },

    async changeMainCurrency(code: string, keepData: boolean) {
      await safetyCopy("currency");
      if (keepData) assertFits(10 ** ((currencyInfo(code)?.decimals ?? 2) - (view.settings[0]?.decimals ?? 2)));
      if (view.transactions.length <= ONE_OP) {
        const { id } = await dispatchTracked("settings.changeMainCurrency", { code, keepData });
        return track([id], { loading: `Switching to ${code}…`, success: `Main currency is now ${code}` });
      }
      const current = view.settings[0];
      const factor = 10 ** ((currencyInfo(code)?.decimals ?? 2) - (current?.decimals ?? 2));
      const ids = !keepData ? await removeEntries() : [];
      if (keepData && factor !== 1) {
        for (const part of chunks(view.transactions.map((t) => t._id as Id<"transactions">))) ids.push((await dispatchTracked("transactions.rescale", { ids: part, factor })).id);
      }
      ids.push((await dispatchTracked("settings.changeMainCurrency", { code, keepData, entries: false })).id);
      return track(ids, { loading: `Switching to ${code}…`, success: `Main currency is now ${code}` });
    },
  };
}
