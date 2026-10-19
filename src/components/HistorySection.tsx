import { useMemo, useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { useView } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { HistoryScope } from "../../shared/history";

const PAGE = 20;

function when(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }) + `, ${time}`;
}

/** The changes made on a page, newest first, in a section that starts collapsed. */
export function HistorySection({ scope, className }: { scope: HistoryScope; className?: string }) {
  const { history } = useView();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const lines = useMemo(() => history.filter((h) => h.scope === scope).sort((a, b) => b.at - a.at || b._creationTime - a._creationTime), [history, scope]);
  const [now] = useState(() => new Date());
  return (
    <div className={cn("mt-6 border-y", className)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center px-4 py-2 text-sm text-muted-foreground bg-muted/60">
        <ChevronDown className={cn("size-4 mr-1 transition-transform", !open && "-rotate-90")} />
        <History className="size-3.5 mr-1.5" />
        <span className="flex-1 text-left">History</span>
        <span className="text-xs tabular">{lines.length}</span>
      </button>
      {open ? (
        <div className="bg-card border-t">
          {lines.length ? (
            <ol className="divide-y">
              {lines.slice(0, shown).map((h) => (
                <li key={h._id} className="px-4 py-2.5 text-sm">
                  <div>{h.text}</div>
                  <div className="text-xs text-muted-foreground"><time dateTime={new Date(h.at).toISOString()}>{when(h.at, now)}</time></div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">No changes yet. Adding, editing, archiving, merging or moving shows up here.</p>
          )}
          {lines.length > shown ? (
            <button type="button" onClick={() => setShown(shown + PAGE)} className="w-full border-t px-4 py-2.5 text-sm text-primary hover:bg-accent/40">Show {Math.min(PAGE, lines.length - shown)} more</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
