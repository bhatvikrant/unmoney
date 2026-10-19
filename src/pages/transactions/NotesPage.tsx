import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useOp, useView } from "@/lib/store";
import { useUndoableDelete } from "@/lib/undo";
import { notesRange } from "../../../shared/views";
import type { Id } from "../../../convex/_generated/dataModel";
import { useMonthParam, useMonthsWithData, usePeriodNeighbours } from "@/lib/period-hooks";
import { monthLabel, dateLabel } from "@/lib/format";
import { NOTE_COLORS } from "../../../shared/defaults";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { MonthNav } from "@/components/shell/MonthNav";
import { Fab, EmptyState } from "@/components/shell/misc";
import { SwipeToDelete, useSwipedRow } from "@/components/shell/SwipeToDelete";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { todayISO } from "../../../shared/dates";

export default function NotesPage() {
  const { month, range, setMonth } = useMonthParam();
  const monthsWithData = useMonthsWithData("notes");
  const nb = usePeriodNeighbours("monthly", month, monthsWithData.dates);
  const [sp, setSp] = useSearchParams();
  const view = useView();
  const notes = useMemo(() => notesRange(view, range.from, range.to), [view, range.from, range.to]);
  const upsert = useOp("notes.upsert");
  const undoable = useUndoableDelete();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id?: Id<"notes">; date: string; text: string; color: string } | null>(null);
  const swipe = useSwipedRow();
  // From a swiped row or the editor's Delete button: asks first, then Undo in the toast.
  const remove = (id: Id<"notes">) => {
    const n = view.notes.find((x) => x._id === id);
    if (!n) return Promise.resolve(false);
    return confirm({ title: "Delete this note?", description: "You can undo this for a few seconds afterwards." })
      .then((ok) => { if (ok) void undoable.note(n); return ok; }).finally(swipe.close);
  };

  useEffect(() => {
    const d = sp.get("date");
    if (d) {
      setEditing({ date: d, text: "", color: NOTE_COLORS[5] });
      const n = new URLSearchParams(sp); n.delete("date"); setSp(n, { replace: true });
    }
  }, [sp, setSp]);

  return (
    <>
      <PageHeader back="/" title="Notes" sub={<div className="mx-auto max-w-3xl"><MonthNav label={monthLabel(month)} onPrev={nb.prev ? () => setMonth(nb.prev!) : undefined} onNext={nb.next ? () => setMonth(nb.next!) : undefined} month={month} onPick={setMonth} withData={monthsWithData.months} spent={monthsWithData.spent} /></div>} />
      <Page>
        {notes && !notes.length ? <EmptyState title="No notes this month" hint="Notes are daily memos. They show as coloured dots on the calendar." /> : null}
        <div className="bg-card border-y">
          {notes?.slice().sort((a, b) => b.date.localeCompare(a.date)).map((n) => (
            <SwipeToDelete key={n._id} className="border-b last:border-b-0" {...swipe.row(n._id)} onDelete={() => void remove(n._id)}>
              <button type="button" onClick={() => setEditing({ id: n._id, date: n.date, text: n.text, color: n.color })} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent/40">
                <span className="mt-1.5 size-2.5 rounded-full shrink-0" style={{ background: n.color }} />
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{dateLabel(n.date, { weekday: true })}</div>
                  <div className="text-sm whitespace-pre-wrap">{n.text}</div>
                </div>
              </button>
            </SwipeToDelete>
          ))}
        </div>
      </Page>
      <Fab label="Add note" onClick={() => setEditing({ date: todayISO() >= range.from && todayISO() <= range.to ? todayISO() : range.from, text: "", color: NOTE_COLORS[5] })} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit note" : "New note"}</DialogTitle></DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <Input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              <Textarea autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} placeholder="What happened today?" className="min-h-24" />
              <div className="flex gap-2">
                {NOTE_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setEditing({ ...editing, color: c })} className={cn("size-7 rounded-full border-2", editing.color === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {editing?.id ? <Button variant="destructive" onClick={async () => { if (await remove(editing.id!)) setEditing(null); }}>Delete</Button> : null}
            <Button disabled={!editing?.text.trim()} onClick={async () => { if (!editing) return; await upsert({ id: editing.id, date: editing.date, text: editing.text.trim(), color: editing.color }); setEditing(null); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
