/**
 * /recap/:key — a monthly (YYYY-MM) or yearly (YYYY) recap as a run of full-screen story cards,
 * outside the app shell. Tap the right of the card (or →, or swipe left) for the next card, the
 * left (←, swipe right) for the previous one; × and Esc close. On a wide screen the card sits
 * centred, 420×560, with arrow buttons either side. The card shown is in the URL (?card=n,
 * replaced rather than pushed), so Back from an entry opened off a card lands on that card.
 * Tapping part of a card (a category, a day's bar, a note) opens its entries in a drawer over the
 * card; that is in the URL too (?drill=), so Back from an entry reopens the drawer.
 *
 * Like a story, each card moves on by itself after CARD_MS, its progress segment filling as it
 * goes; the last card waits. Holding the card down (finger or mouse) pauses it, and letting go
 * carries on from where it was, without the release counting as a tap. It also waits while the
 * drawer is open, while the tab is in the background, and while paused with the button (or Space).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useStore, useView } from "@/lib/store";
import { useGoBack } from "@/lib/nav";
import { useShortcuts, useSwipe } from "@/lib/shortcuts";
import { useMediaQuery, WIDE } from "@/lib/media";
import { useToday } from "@/lib/today";
import { markRecapSeen, markRecapYearSeen } from "@/lib/recap";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shell/misc";
import { monthKey, monthRange, yearRange } from "../../../shared/period";
import { monthRecap, yearRecap, RECAP_MIN_ENTRIES, RECAP_YEAR_MIN_MONTHS, type RecapDrill } from "../../../shared/recap";
import { settingsOf, statsEntries } from "../../../shared/views";
import { RecapCardView } from "./cards";
import { RecapDrawer } from "./RecapDrawer";
import { decodeDrill, DrillContext, encodeDrill } from "./drill";

const SLIDE = 16;
/** How long each card stays before the next one comes in by itself. */
const CARD_MS = 5000;
/** A press held this long is a pause, not a tap: letting go does not step. */
const HOLD_MS = 300;
const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * SLIDE }),
  center: { opacity: 0.999, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: -dir * SLIDE }),
};

export default function RecapPage() {
  const { key = "" } = useParams();
  if (!/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(key)) return <Navigate to="/stats" replace />;
  return <Recap month={key} />;
}

function Recap({ month }: { month: string }) {
  const view = useView();
  const { userId } = useStore();
  const goBack = useGoBack();
  const wide = useMediaQuery(WIDE);
  const still = useReducedMotion();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const year = /^\d{4}$/.test(month) ? Number(month) : null;
  const monthStartDay = settingsOf(view)?.monthStartDay ?? 1;
  const range = year !== null ? yearRange(year, monthStartDay) : monthRange(month, monthStartDay);
  // a month (or year) still running has no recap yet: a bookmark or Back lands on the Recaps list instead, and nothing is marked seen
  const finished = range.to < today;
  const recap = useMemo(() => (!finished ? null : year !== null ? yearRecap(view, year) : monthRecap(view, month)), [view, month, year, finished]);
  const [dir, setDir] = useState(1);
  // what holds the timer: a finger or the mouse held down on the card, the button (or Space), a hidden tab
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const press = useRef({ at: 0, long: false });
  useEffect(() => {
    const h = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);
  const n = recap?.cards.length ?? 0;
  const at = Math.min(Math.max(0, Math.trunc(Number(params.get("card")) || 0)), Math.max(0, n - 1));

  // Opening a recap counts as having seen it: the ledger card for that month goes away. The year's card carried December too.
  useEffect(() => {
    if (!userId || !recap) return;
    if (year !== null) { markRecapYearSeen(userId, year); markRecapSeen(userId, monthKey(year, 12)); } else markRecapSeen(userId, month);
  }, [userId, recap, month, year]);

  const card = recap?.cards[Math.min(at, n - 1)];
  const drill = decodeDrill(params.get("drill"), card);
  const openDrill = (d: RecapDrill | null) => setParams({ ...(at ? { card: String(at) } : {}), ...(d ? { drill: encodeDrill(d) } : {}) }, { replace: true });

  const close = () => goBack(year !== null ? `/stats?period=yearly&year=${year}` : `/stats?month=${month}`);
  const go = (i: number) => { setDir(i > at ? 1 : -1); setParams(i ? { card: String(i) } : {}, { replace: true }); };
  const next = () => (at < n - 1 ? go(at + 1) : close());
  const prev = () => { if (at > 0) go(at - 1); };
  useShortcuts({ ArrowRight: next, ArrowLeft: prev, Escape: close, " ": () => setStopped((v) => !v) });
  const swipe = useSwipe(next, prev);
  const paused = held || stopped || hidden || !!drill;
  // holding pauses; a release after a long hold is not a tap on the zone beneath. A long press
  // must not select text (iOS) or open the context menu (Android) either: select-none and the
  // callout style cover most of it, and the story refuses to start a selection at all.
  const noSelect = useCallback((el: HTMLDivElement | null) => { el?.addEventListener("selectstart", (e) => e.preventDefault()); }, []);
  const holdProps = {
    ref: noSelect,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      window.getSelection()?.removeAllRanges();
      press.current = { at: Date.now(), long: false };
      setHeld(true);
    },
    onPointerUp: () => { press.current.long = Date.now() - press.current.at >= HOLD_MS; setHeld(false); },
    onPointerCancel: () => setHeld(false),
    onPointerLeave: () => setHeld(false),
  };
  const tap = (step: () => void) => () => {
    if (press.current.long) { press.current.long = false; return; }
    step();
  };

  if (!finished) return <Navigate to="/recaps" replace />;
  if (!recap || !n) {
    const entries = year === null ? statsEntries(view, range.from, range.to, "expense").length : 0;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background">
        {year !== null
          ? <EmptyState title={`${year} has fewer than ${RECAP_YEAR_MIN_MONTHS} months with a recap`} hint={`A year's recap needs ${RECAP_YEAR_MIN_MONTHS} months with at least ${RECAP_MIN_ENTRIES} expense entries each.`} action={<Button variant="outline" onClick={close}>Close</Button>} />
          : <EmptyState title={entries ? `Only ${entries} ${entries === 1 ? "entry" : "entries"} in ${monthLabel(month)}` : `Nothing recorded in ${monthLabel(month)}`} hint={`A recap needs at least ${RECAP_MIN_ENTRIES} expense entries in the month.`} action={<Button variant="outline" onClick={close}>Close</Button>} />}
      </div>
    );
  }

  const transition: Transition = still ? { duration: 0 } : { duration: 0.22, ease: "easeOut" };
  const last = at === n - 1;
  // one button per card: the done ones solid, the current one filling over CARD_MS (the last one full), with a taller hit area than its 3 px
  const segments = (
    <div className="flex flex-1 gap-[3px]" role="group" aria-label={`Card ${at + 1} of ${n}`}>
      {recap.cards.map((c, i) => (
        <button
          key={c.kind}
          type="button"
          aria-label={`Card ${i + 1} of ${n}`}
          aria-current={i === at ? "step" : undefined}
          onClick={() => go(i)}
          className={cn(
            "relative block h-[3px] flex-1 cursor-pointer rounded-[2px] after:absolute after:inset-x-0 after:-inset-y-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            i < at || (i === at && last) ? "bg-foreground" : "bg-foreground/15",
          )}
        >
          {i === at && !last ? (
            <span
              key={at}
              className="absolute inset-0 origin-left rounded-[2px] bg-foreground"
              style={{ animation: `recap-fill ${CARD_MS}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }}
              onAnimationEnd={next}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
  const closeButton = (
    <>
      {!last ? (
        <Button variant="ghost" size="icon" aria-label={stopped ? "Play" : "Pause"} aria-pressed={stopped} title={stopped ? "Play (Space)" : "Pause (Space)"} onClick={() => setStopped((v) => !v)}>
          {stopped ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={close}><X className="size-4" /></Button>
    </>
  );
  const zone = "absolute top-12 bottom-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

  const story = (
    <div {...swipe} {...holdProps} className="relative h-full w-full touch-none overflow-hidden bg-background select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]">
      {/* tap zones: right 65% next, left 35% back. They sit under the card, whose text lets taps through (pointer-events-none) while its buttons and links catch them. */}
      <button type="button" aria-label="Previous card" onClick={tap(prev)} className={cn(zone, "left-0 w-[35%]")} />
      <button type="button" aria-label={at < n - 1 ? "Next card" : "Done"} onClick={tap(next)} className={cn(zone, "right-0 w-[65%]")} />
      {/* a live region around the cards, so a screen reader reads each new card as it comes in */}
      <div aria-live="polite" className="pointer-events-none absolute inset-0">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div key={at} custom={dir} variants={variants} initial={still ? "center" : "enter"} animate="center" exit="exit" transition={transition} className="pointer-events-none absolute inset-0">
            <RecapCardView card={card!} month={month} onClose={close} />
          </motion.div>
        </AnimatePresence>
      </div>
      {!wide ? <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-3 pt-3">{segments}{closeButton}</div> : null}
    </div>
  );

  // outside the story, so a drag in the drawer is not a swipe to the next card
  const drawer = <RecapDrawer drill={drill} recapKey={month} range={recap.range} onDrill={openDrill} onClose={() => openDrill(null)} />;
  if (!wide) return <DrillContext.Provider value={openDrill}><div className="h-dvh safe-bottom bg-background">{story}</div>{drawer}</DrillContext.Provider>;
  return (
    <DrillContext.Provider value={openDrill}>
    <div className="relative flex min-h-dvh items-center justify-center gap-6 bg-background px-4">
      <div className="absolute top-3 right-3 flex items-center gap-2"><div className="w-36">{segments}</div>{closeButton}</div>
      <Button variant="outline" size="icon-lg" className="rounded-full" aria-label="Previous card" title="Previous (←)" disabled={at === 0} onClick={prev}><ChevronLeft className="size-5" /></Button>
      <div className="h-[560px] w-[420px] shrink-0 overflow-hidden rounded-[20px] border shadow-card">{story}</div>
      <Button variant="outline" size="icon-lg" className="rounded-full" aria-label={at < n - 1 ? "Next card" : "Done"} title="Next (→)" onClick={next}><ChevronRight className="size-5" /></Button>
      <div className="absolute inset-x-0 bottom-3 text-center text-[11px] text-muted-foreground"><kbd className="rounded border px-1">←</kbd> <kbd className="rounded border px-1">→</kbd> step · <kbd className="rounded border px-1">Space</kbd> pauses · <kbd className="rounded border px-1">Esc</kbd> closes</div>
    </div>
    {drawer}
    </DrillContext.Provider>
  );
}
