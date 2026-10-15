import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useOp, useView } from "@/lib/store";
import { notesRange } from "../../../shared/views";
import type { Id } from "../../../convex/_generated/dataModel";
import { useMonthParam } from "@/lib/period-hooks";
import { monthLabel, dateLabel } from "@/lib/format";
import { NOTE_COLORS } from "../../../shared/defaults";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { MonthNav } from "@/components/shell/MonthNav";
import { Fab, EmptyState } from "@/components/shell/misc";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { todayISO } from "../../../shared/dates";

export default function NotesPage() {
  const { month, range, shift } = useMonthParam();
  const [sp, setSp] = useSearchParams();
  const view = useView();
  const notes = useMemo(() => notesRange(view, range.from, range.to), [view, range.from, range.to]);
  const upsert = useOp("notes.upsert");
  const remove = useOp("notes.remove");
  const [editing, setEditing] = useState<{ id?: Id<"notes">; date: string; text: string; color: string } | null>(null);

  useEffect(() => {
    const d = sp.get("date");
    if (d) {
      setEditing({ date: d, text: "", color: NOTE_COLORS[5] });
      const n = new URLSearchParams(sp); n.delete("date"); setSp(n, { replace: true });
    }
  }, [sp, setSp]);

  return (
    <>
      <PageHeader back="/" title="Notes" sub={<div className="mx-auto max-w-3xl"><MonthNav label={monthLabel(month)} onPrev={() => shift(-1)} onNext={() => shift(1)} /></div>} />
      <Page>
        {notes && !notes.length ? <EmptyState title="No notes this month" hint="Notes are daily memos. They show as coloured dots on the calendar." /> : null}
        <div className="bg-card border-y">
          {notes?.slice().sort((a, b) => b.date.localeCompare(a.date)).map((n) => (
            <button key={n._id} type="button" onClick={() => setEditing({ id: n._id, date: n.date, text: n.text, color: n.color })} className="w-full flex items-start gap-3 px-4 py-3 border-b last:border-b-0 text-left hover:bg-accent/40">
              <span className="mt-1.5 size-2.5 rounded-full shrink-0" style={{ background: n.color }} />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{dateLabel(n.date, { weekday: true })}</div>
                <div className="text-sm whitespace-pre-wrap">{n.text}</div>
              </div>
            </button>
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
            {editing?.id ? <Button variant="destructive" onClick={() => { remove({ id: editing.id! }); setEditing(null); }}>Delete</Button> : null}
            <Button disabled={!editing?.text.trim()} onClick={async () => { if (!editing) return; await upsert({ id: editing.id, date: editing.date, text: editing.text.trim(), color: editing.color }); setEditing(null); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
