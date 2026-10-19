import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "framer-motion";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Width of the Delete button a short swipe uncovers. */
const REVEAL = 88;
/** Swiping this far asks to delete straight away. A fast flick only opens the row: deleting should take a deliberate swipe. */
const FULL = 160;

/**
 * Which row of a list is swiped open, so only one is at a time. `row(id)` gives a row's `open` and
 * `onOpenChange`; `close()` shuts whichever is open (after a confirmation, whether it was taken or not).
 */
export function useSwipedRow() {
  const [swiped, setSwiped] = useState<string | null>(null);
  return {
    row: (id: string) => ({ open: swiped === id, onOpenChange: (o: boolean) => setSwiped(o ? id : null) }),
    close: () => setSwiped(null),
  };
}

/**
 * A list row that slides left to uncover a Delete button, like iOS mail. A short swipe or a flick
 * leaves it open; a long swipe calls onDelete directly. While open, tapping the row closes
 * it instead of opening it. The parent keeps which row is open, so only one is at a time.
 */
export function SwipeToDelete({ children, open, onOpenChange, onDelete, disabled, label = "Delete", className }: {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void; disabled?: boolean; label?: string; className?: string;
}) {
  const x = useMotionValue(0);
  const reduce = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  const settle = (to: number) => animate(x, to, reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 });

  useEffect(() => {
    const c = settle(open && !disabled ? -REVEAL : 0);
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, disabled]);

  function end(_: unknown, info: PanInfo) {
    setDragging(false);
    const at = x.get();
    const full = at < -FULL;
    const next = full || at < -REVEAL / 2 || info.velocity.x < -300;
    onOpenChange(next);
    // `open` may not change (still open, still shut), so settle here too
    settle(next ? -REVEAL : 0);
    if (full) onDelete();
  }

  // A drag ends with a click on whatever is under the pointer: swallow it. A tap on an open row closes it.
  function onClickCapture(e: MouseEvent) {
    if (!moved.current && !open) return;
    e.preventDefault();
    e.stopPropagation();
    if (!moved.current) onOpenChange(false);
  }

  return (
    // data-swipe-row lets a page-level swipe (the month swipe on Transactions) leave this row's gesture alone
    <div data-swipe-row={disabled ? undefined : open ? "open" : "closed"} className={cn("relative overflow-hidden", className)}>
      <button type="button" tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={onDelete}
        className={cn("absolute inset-y-0 right-0 flex w-[88px] flex-col items-center justify-center gap-0.5 bg-destructive text-xs font-medium text-white", !open && !dragging && "invisible")}>
        <Trash2 className="size-4" />{label}
      </button>
      <motion.div
        style={{ x, touchAction: "pan-y" }}
        drag={disabled ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.6, right: 0 }}
        dragMomentum={false}
        onPointerDownCapture={() => { moved.current = false; }}
        onDragStart={() => { moved.current = true; setDragging(true); }}
        onDragEnd={end}
        onClickCapture={onClickCapture}
        className="relative bg-card"
      >
        {children}
      </motion.div>
    </div>
  );
}
