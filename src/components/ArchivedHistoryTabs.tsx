import { useId, useMemo, useState, type ReactNode } from "react";
import { Archive, History } from "lucide-react";
import type { Doc } from "../../convex/_generated/dataModel";
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

export type BottomTab = "archived" | "history";

/**
 * The foot of a list page: Archived and History side by side, each half a tab. Both start closed;
 * a tap opens one under the bar, a tap on the open one closes it. Archived shows only when there is some.
 */
export function ArchivedHistoryTabs({ scope, archivedCount, archived, open, onOpenChange, className }: {
  scope: HistoryScope;
  archivedCount: number;
  /** What the Archived tab shows when open. */
  archived: ReactNode;
  open: BottomTab | null;
  onOpenChange: (open: BottomTab | null) => void;
  className?: string;
}) {
  const { history } = useView();
  const lines = useMemo(() => history.filter((h) => h.scope === scope).sort((a, b) => b.at - a.at || b._creationTime - a._creationTime), [history, scope]);
  const tabs = [
    ...(archivedCount ? [{ id: "archived" as const, label: "Archived", icon: Archive, count: archivedCount }] : []),
    { id: "history" as const, label: "History", icon: History, count: lines.length },
  ];
  const shown = open === "archived" && !archivedCount ? null : open;
  const panelId = useId();
  return (
    <div className={cn("mt-6 border-y", className)}>
      <div className="flex divide-x">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => onOpenChange(shown === t.id ? null : t.id)} aria-expanded={shown === t.id} aria-controls={panelId}
            className={cn("flex-1 min-w-0 flex items-center gap-1.5 px-4 py-2 text-sm transition-colors", shown === t.id ? "bg-card text-foreground font-medium" : "bg-muted/60 text-muted-foreground")}>
            <t.icon className="size-3.5 shrink-0" />
            <span className="flex-1 text-left truncate">{t.label}</span>
            <span className="text-xs tabular font-normal">{t.count}</span>
          </button>
        ))}
      </div>
      {shown ? <div id={panelId} className="bg-card border-t">{shown === "archived" ? archived : <HistoryList lines={lines} />}</div> : null}
    </div>
  );
}

/** The changes made on a page, newest first, a page at a time. */
function HistoryList({ lines }: { lines: Doc<"history">[] }) {
  const [shown, setShown] = useState(PAGE);
  const [now] = useState(() => new Date());
  return (
    <>
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
    </>
  );
}
