/**
 * Deletes that can be taken back: each one keeps a copy of what it removes and offers Undo in its
 * toast, which puts the copy back (entries through transactions.restoreRows, so they keep their
 * account, category, schedule and installment details; they get new ids).
 */
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import type { Doc, Id } from "../../convex/_generated/dataModel";

export function useUndoableDelete() {
  const { view, dispatch } = useStore();

  function offerUndo(message: string, undo: () => Promise<unknown>) {
    toast.success(message, {
      duration: 8000,
      action: { label: "Undo", onClick: () => void undo().then(() => toast.success("Restored"), (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not restore")) },
    });
  }

  return {
    /** One entry, or with `scope` the rest of its repeat / installment series too. */
    async entry(id: string, scope: "one" | "future" | "all" = "one") {
      const tx = view.transactions.find((t) => t._id === id);
      if (!tx) return;
      const series = scope !== "one" && tx.repeatId;
      const gone = series ? view.transactions.filter((t) => t.repeatId === tx.repeatId && (scope === "all" || t.date >= tx.date)) : [tx];
      const schedule = series ? view.repeats.find((r) => r._id === tx.repeatId && r.active) : undefined;
      await dispatch("transactions.remove", { id: id as Id<"transactions">, scope });
      offerUndo(gone.length === 1 ? "Entry deleted" : `${gone.length} entries deleted`, async () => {
        await dispatch("transactions.restoreRows", { rows: gone });
        if (schedule) await dispatch("repeats.update", { id: schedule._id, active: true });
      });
    },

    async entries(ids: string[]) {
      const set = new Set(ids);
      const gone = view.transactions.filter((t) => set.has(t._id));
      await dispatch("transactions.bulkRemove", { ids: ids as Id<"transactions">[] });
      offerUndo(`Deleted ${gone.length} ${gone.length === 1 ? "entry" : "entries"}`, () => dispatch("transactions.restoreRows", { rows: gone }));
    },

    async note(note: Doc<"notes">) {
      await dispatch("notes.remove", { id: note._id });
      offerUndo("Note deleted", () => dispatch("notes.upsert", { date: note.date, text: note.text, color: note.color }));
    },

    async bookmark(b: Doc<"bookmarks">) {
      await dispatch("bookmarks.remove", { id: b._id });
      offerUndo("Bookmark deleted", () => dispatch("bookmarks.create", { template: b.template, transactionId: b.transactionId }));
    },
  };
}
