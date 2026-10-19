/**
 * /recap/:month — the monthly recap as a run of full-screen story cards, outside the app shell.
 * Tap the right of the card (or →, or swipe left) for the next card, the left (←, swipe right)
 * for the previous one; × and Esc close. On a wide screen the card sits centred, 420×560, with
 * arrow buttons either side.
 */
import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useStore, useView } from "@/lib/store";
import { useGoBack } from "@/lib/nav";
import { useShortcuts, useSwipe } from "@/lib/shortcuts";
import { useMediaQuery, WIDE } from "@/lib/media";
import { markRecapSeen } from "@/lib/recap";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shell/misc";
import { monthRecap, RECAP_MIN_ENTRIES } from "../../../shared/recap";
import { RecapCardView } from "./cards";

const SLIDE = 16;
const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * SLIDE }),
  center: { opacity: 0.999, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: -dir * SLIDE }),
};

export default function RecapPage() {
  const { month = "" } = useParams();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return <Navigate to="/stats" replace />;
  return <Recap month={month} />;
}

function Recap({ month }: { month: string }) {
  const view = useView();
  const { userId } = useStore();
  const goBack = useGoBack();
  const wide = useMediaQuery(WIDE);
  const still = useReducedMotion();
  const recap = useMemo(() => monthRecap(view, month), [view, month]);
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState(1);
  const n = recap?.cards.length ?? 0;

  // Opening a recap counts as having seen it: the ledger card for that month goes away.
  useEffect(() => { if (userId && recap) markRecapSeen(userId, month); }, [userId, recap, month]);

  const close = () => goBack(`/stats?month=${month}`);
  const go = (i: number) => { setDir(i > at ? 1 : -1); setAt(i); };
  const next = () => (at < n - 1 ? go(at + 1) : close());
  const prev = () => { if (at > 0) go(at - 1); };
  useShortcuts({ ArrowRight: next, ArrowLeft: prev, Escape: close });
  const swipe = useSwipe(next, prev);

  if (!recap) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background">
        <EmptyState title={`Nothing recorded in ${monthLabel(month)}`} hint={`A recap needs at least ${RECAP_MIN_ENTRIES} expense entries in the month.`} action={<Button variant="outline" onClick={close}>Close</Button>} />
      </div>
    );
  }

  const transition: Transition = still ? { duration: 0 } : { duration: 0.22, ease: "easeOut" };
  const card = recap.cards[at];
  const segments = (
    <div className="flex flex-1 gap-[3px]" role="progressbar" aria-valuemin={1} aria-valuemax={n} aria-valuenow={at + 1} aria-label={`Card ${at + 1} of ${n}`}>
      {recap.cards.map((c, i) => (
        <i
          key={c.kind}
          className={cn("block h-[3px] flex-1 rounded-[2px]", i < at ? "bg-foreground" : "bg-foreground/15")}
          style={i === at ? { background: "linear-gradient(to right, var(--foreground) 50%, color-mix(in srgb, var(--foreground) 15%, transparent) 50%)" } : undefined}
        />
      ))}
    </div>
  );
  const closeButton = <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={close}><X className="size-4" /></Button>;

  const story = (
    <div {...swipe} className="relative h-full w-full overflow-hidden bg-background">
      {/* tap zones: right 65% next, left 35% back. They sit under the card, whose text lets taps through (pointer-events-none) while its buttons and links catch them. */}
      <button type="button" aria-label="Previous card" onClick={prev} className="absolute top-12 bottom-0 left-0 w-[35%] cursor-pointer focus-visible:outline-none" />
      <button type="button" aria-label={at < n - 1 ? "Next card" : "Done"} onClick={next} className="absolute top-12 right-0 bottom-0 w-[65%] cursor-pointer focus-visible:outline-none" />
      <AnimatePresence initial={false} custom={dir}>
        <motion.div key={at} custom={dir} variants={variants} initial={still ? "center" : "enter"} animate="center" exit="exit" transition={transition} className="pointer-events-none absolute inset-0">
          <RecapCardView card={card} month={month} onClose={close} />
        </motion.div>
      </AnimatePresence>
      {!wide ? <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-3 pt-3">{segments}{closeButton}</div> : null}
    </div>
  );

  if (!wide) return <div className="h-dvh safe-bottom bg-background">{story}</div>;
  return (
    <div className="relative flex min-h-dvh items-center justify-center gap-6 bg-background px-4">
      <div className="absolute top-3 right-3 flex items-center gap-2"><div className="w-36">{segments}</div>{closeButton}</div>
      <Button variant="outline" size="icon-lg" className="rounded-full" aria-label="Previous card" title="Previous (←)" disabled={at === 0} onClick={prev}><ChevronLeft className="size-5" /></Button>
      <div className="h-[560px] w-[420px] shrink-0 overflow-hidden rounded-[20px] border shadow-card">{story}</div>
      <Button variant="outline" size="icon-lg" className="rounded-full" aria-label={at < n - 1 ? "Next card" : "Done"} title="Next (→)" onClick={next}><ChevronRight className="size-5" /></Button>
      <div className="absolute inset-x-0 bottom-3 text-center text-[11px] text-muted-foreground"><kbd className="rounded border px-1">←</kbd> <kbd className="rounded border px-1">→</kbd> step · <kbd className="rounded border px-1">Esc</kbd> closes</div>
    </div>
  );
}
