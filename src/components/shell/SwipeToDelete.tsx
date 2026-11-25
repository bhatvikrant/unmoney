import { lazy, Suspense, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SwipeProps = {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => void; disabled?: boolean; label?: string; className?: string;
};

// The gesture is framer-motion's, 140 KB that used to load with the app for this alone. It is fetched once a
// list is on screen instead; until it arrives a row is drawn as it looks at rest (same boxes, so nothing shifts).
const SwipeRow = lazy(() => import("./SwipeRow"));

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

export function SwipeToDelete(props: SwipeProps) {
  return (
    <Suspense fallback={<div className={cn("relative overflow-hidden", props.className)}><div className="relative bg-card">{props.children}</div></div>}>
      <SwipeRow {...props} />
    </Suspense>
  );
}
