/**
 * Actions that touch every entry (restore, delete all, change main currency), split so that no
 * single server transaction outgrows Convex's limits: one small op for everything but the
 * entries, and the entries themselves in chunks, by id. All of it is queued at once, so it
 * applies locally straight away and survives going offline or reloading; `synced` settles once
 * the server has confirmed every chunk.
 */
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { currencyInfo } from "../../shared/currencies";
import { restoreRowsFrom, type BackupData } from "../../shared/ops";
import type { Id } from "../../convex/_generated/dataModel";

const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export function useBulkOps() {
  const { view, dispatchTracked, whenSynced } = useStore();

  async function removeEntries(): Promise<string[]> {
    const ids: string[] = [];
    for (const part of chunks(view.transactions.map((t) => t._id))) ids.push((await dispatchTracked("transactions.bulkRemove", { ids: part })).id);
    return ids;
  }

  /** Waits for the server, with a toast that stays up until it has confirmed (or refused) every op. */
  function track(opIds: string[], messages: { loading: string; success: string }): Promise<void> {
    const synced = whenSynced(opIds).then(({ rejected }) => {
      if (rejected.length) throw new Error(`${rejected.length} of ${opIds.length} parts could not be saved: ${rejected[0].error}`);
    });
    toast.promise(synced, { loading: messages.loading, success: messages.success, error: (e: Error) => e.message });
    return synced;
  }

  return {
    async wipeAll() {
      const ids = await removeEntries();
      ids.push((await dispatchTracked("backup.wipeAll", { confirm: "DELETE", entries: false })).id);
      return track(ids, { loading: "Deleting entries… keep UnMoney open until it is saved", success: "Entries deleted" });
    },

    async restore(data: BackupData) {
      const ids = await removeEntries();
      const restored = await dispatchTracked("backup.restore", { data: { ...data, transactions: [] }, entries: false });
      ids.push(restored.id);
      for (const rows of chunks(restoreRowsFrom(data, restored.result))) ids.push((await dispatchTracked("transactions.restoreRows", { rows })).id);
      return track(ids, { loading: "Restoring… keep UnMoney open until it is saved", success: "Restored" });
    },

    async changeDecimals(decimals: number) {
      const current = view.settings[0]?.decimals ?? 2;
      const factor = 10 ** (decimals - current);
      const ids: string[] = [];
      for (const part of chunks(view.transactions.map((t) => t._id as Id<"transactions">))) ids.push((await dispatchTracked("transactions.rescale", { ids: part, factor })).id);
      ids.push((await dispatchTracked("settings.changeDecimals", { decimals, entries: false })).id);
      return track(ids, { loading: "Updating amounts…", success: `Amounts now have ${decimals} decimal ${decimals === 1 ? "place" : "places"}` });
    },

    async changeMainCurrency(code: string, keepData: boolean) {
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
