/**
 * Actions that touch every entry (restore, delete all, change main currency), split so that no
 * single server transaction outgrows Convex's limits: one small op for everything but the
 * entries, and the entries themselves in chunks, by id. All of it is queued at once, so it
 * applies locally straight away and survives going offline or reloading; `synced` settles once
 * the server has confirmed every chunk. A large restore is the exception: see restore.
 */
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { currencyInfo } from "../../shared/currencies";
import { restoreRowsFrom, scaleAmount, type BackupData } from "../../shared/ops";
import type { Id } from "../../convex/_generated/dataModel";

const CHUNK = 500;
/**
 * Up to this many entries one op does it all on the server, at once and including entries this
 * device has not seen yet (made on another device, or by the hourly repeats job). Beyond it the
 * entries go in chunks by id; for a wipe or restore the server then sweeps away any older entries
 * the chunks did not name (sync.sweepEntries). A currency change past it can miss an entry that
 * arrives meanwhile.
 */
const ONE_OP = 8_000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export function useBulkOps() {
  const { view, dispatchTracked, whenSynced } = useStore();

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
      for (const b of view.budgets) scaleAmount(b.amount, factor);
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
    async wipeAll() {
      if (view.transactions.length <= ONE_OP) {
        const { id } = await dispatchTracked("backup.wipeAll", { confirm: "DELETE" });
        return track([id], { loading: "Deleting entries…", success: "Entries deleted" });
      }
      const ids = await removeEntries();
      ids.push((await dispatchTracked("backup.wipeAll", { confirm: "DELETE", entries: false })).id);
      return track(ids, { loading: "Deleting entries… keep UnMoney open until it is saved", success: "Entries deleted" });
    },

    async restore(data: BackupData) {
      if (view.transactions.length + (data.transactions?.length ?? 0) <= ONE_OP) {
        const { id } = await dispatchTracked("backup.restore", { data });
        return track([id], { loading: "Restoring…", success: "Restored" });
      }
      // Everything but the entries goes first, and alone: only once the server has taken it are the
      // old entries removed, so a refused restore leaves the ledger as it was. (The server also
      // sweeps the old entries itself after this op, hence ifPresent.)
      const restored = await dispatchTracked("backup.restore", { data: { ...data, transactions: [] }, entries: false });
      return track((async () => {
        const { rejected } = await whenSynced([restored.id]);
        if (rejected.length) throw new Error(`Nothing was restored: ${rejected[0].error}`);
        const ids = await removeEntries(true);
        for (const rows of chunks(restoreRowsFrom(data, restored.result))) ids.push((await dispatchTracked("transactions.restoreRows", { rows, bookmarks: restored.result.bookmarks })).id);
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
