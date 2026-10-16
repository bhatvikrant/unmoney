import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Small (i) icon: explains on hover (desktop) and on tap (touch). */
export function InfoHint({ text, label = "What does this do?" }: { text: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <TooltipProvider delayDuration={150}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip open={tip && !open} onOpenChange={setTip}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onClick={stop}
                onKeyDown={stop}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="size-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-72 text-left leading-snug">{text}</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="start" className="w-72 p-3 text-xs leading-snug">{text}</PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export function EmptyState({ title, hint, action, className }: { title: string; hint?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-16 px-6 text-muted-foreground", className)}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <div className="text-xs mt-1 max-w-xs">{hint}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Fab({ onClick, label = "Add", className, icon }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; label?: string; className?: string; icon?: ReactNode }) {
  return (
    <Button
      aria-label={label}
      onClick={onClick}
      className={cn("fixed bottom-[calc(var(--tabbar-h)+1.5rem)] right-4 md:bottom-8 md:right-8 z-30 size-14 rounded-full shadow-lg", className)}
      size="icon"
    >
      {icon ?? <Plus className="size-6" />}
    </Button>
  );
}

export function SegmentedTabs<T extends string>({ value, onChange, items, className }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; className?: string;
}) {
  return (
    <div className={cn("flex border-b overflow-x-auto no-scrollbar", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cn(
            "px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
            value === it.value ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, value, onClick, right, className, hint, info }: {
  label: ReactNode; value?: ReactNode; onClick?: () => void; right?: ReactNode; className?: string; hint?: ReactNode;
  /** Longer explanation shown behind an (i) icon next to the label. */
  info?: ReactNode;
}) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="min-w-0">{label}</span>
          {info ? <InfoHint text={info} /> : null}
        </div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {value !== undefined ? <div className="text-sm text-muted-foreground truncate max-w-[55%]">{value}</div> : null}
      {right}
    </>
  );
  const cls = cn("flex items-center gap-3 px-4 py-3 border-b last:border-b-0 w-full text-left", onClick && "hover:bg-accent/50 active:bg-accent", className);
  if (!onClick) return <div className={cls}>{inner}</div>;
  // A div with role=button (not <button>) so the info icon and other controls can sit inside it.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
  };
  return <div role="button" tabIndex={0} className={cn(cls, "focus-visible:outline-none focus-visible:bg-accent/50")} onClick={onClick} onKeyDown={onKey}>{inner}</div>;
}

export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-4", className)}>
      {title ? <div className="px-4 pb-1 text-xs uppercase tracking-wide text-muted-foreground">{title}</div> : null}
      <div className="bg-card border-y md:border md:rounded-lg md:mx-4">{children}</div>
    </section>
  );
}
