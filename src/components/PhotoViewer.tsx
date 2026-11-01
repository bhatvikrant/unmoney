import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampView, doubleTapView, fitSize, IDENTITY, maxScale, panLimit, rubber, rubberClamp, rubberScale, rubberView, zoomAt, type Point, type Size, type View } from "@/lib/zoom";

/** Space between photos while swiping from one to the next, as in Photos. */
const GAP = 16;
/** How far a finger moves before a touch counts as a drag rather than a tap. */
const SLOP = 6;
/** Two taps closer together than this are a double tap. */
const DOUBLE_TAP_MS = 280;

/**
 * Everything the viewer draws, kept outside React so a gesture repaints at the screen's frame rate.
 * `s/x/y` zoom and pan the current photo, `track` slides the strip of photos, `dx/dy` drag it away to close,
 * `o` fades the whole viewer out as it closes.
 */
type Live = View & { track: number; dx: number; dy: number; o: number };
type Mode = "idle" | "pending" | "pan" | "pinch" | "swipe" | "dismiss";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Full-screen viewer for a transaction's photos: pinch or double tap to zoom, drag to pan, swipe sideways between
 * photos, swipe down (or pinch in) to close. On a computer: ctrl/⌘ + scroll or a trackpad pinch zooms, double-click
 * zooms, arrow keys move between photos, + / − / 0 zoom.
 */
export function PhotoViewer({ urls, index, onIndexChange, onClose }: {
  urls: (string | undefined)[];
  /** The photo shown, or null when the viewer is closed. */
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  // kept while the close animation plays, after the parent has already cleared `index`
  const [shown, setShown] = useState(index ?? 0);
  if (index !== null && index !== shown) setShown(index);
  return (
    <DialogPrimitive.Root open={index !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // the viewer focuses itself, so the arrow keys work without first landing on a button
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-0 z-50 outline-none select-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <Stage urls={urls} index={index ?? shown} onIndexChange={onIndexChange} onClose={onClose} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Stage({ urls, index, onIndexChange, onClose }: { urls: (string | undefined)[]; index: number; onIndexChange: (i: number) => void; onClose: () => void }) {
  const n = urls.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [box, setBox] = useState<Size>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [natural, setNatural] = useState<Record<number, Size>>({});
  const [chrome, setChrome] = useState(true);
  const [zoomed, setZoomed] = useState(false);

  // the latest of everything, for handlers that outlive a render (animation frames, timers, the wheel listener)
  const idx = useRef(index);
  const geo = useRef({ box, natural });
  useLayoutEffect(() => { geo.current = { box, natural }; });
  const live = useRef<Live>({ ...IDENTITY, track: 0, dx: 0, dy: 0, o: 1 });
  const anim = useRef(0);
  const closing = useRef(false);
  const reduced = useRef(typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  const g = useRef({
    pts: new Map<number, Point>(),
    mode: "idle" as Mode,
    pointerType: "touch",
    start: { x: 0, y: 0 } as Point,
    base: IDENTITY as View,
    baseTrack: 0,
    dist0: 1,
    mid0: { x: 0, y: 0 } as Point,
    lastMid: { x: 0, y: 0 } as Point,
    /** Whether this gesture began with the photo fitted, so pinching it smaller means "close". */
    pinchFromFit: false,
    /** A pan that follows a pinch never spills over into the next photo. */
    fromPinch: false,
    samples: [] as { t: number; x: number; y: number }[],
    lastTap: null as { t: number; x: number; y: number } | null,
    tapTimer: 0,
    lastWheelNav: 0,
  });

  const step = () => geo.current.box.w + GAP;
  const home = () => -idx.current * step();
  const fitOf = (i: number) => { const { box, natural } = geo.current; return fitSize(natural[i] ?? box, box); };
  const maxOf = (i: number) => { const { box, natural } = geo.current; return maxScale(natural[i] ?? box, fitOf(i)); };

  function paint() {
    const l = live.current;
    const { box } = geo.current;
    if (trackRef.current) trackRef.current.style.transform = `translate3d(${l.track}px,0,0)`;
    // dragged away: the photo shrinks a little and the black behind it gives way to the screen underneath
    const away = Math.min(1, Math.hypot(l.dx * 0.5, l.dy) / (box.h * 0.45));
    const shrink = 1 - away * 0.3;
    const el = slideRefs.current[idx.current];
    if (el) el.style.transform = `translate3d(${l.x + l.dx}px,${l.y + l.dy}px,0) scale(${l.s * shrink})`;
    const pinchedIn = l.s < 1 ? Math.max(0, (l.s - 0.6) / 0.4) : 1;
    if (backdropRef.current) backdropRef.current.style.opacity = String(Math.max(0, (1 - away) * pinchedIn));
    if (chromeRef.current) chromeRef.current.style.opacity = away > 0.01 || l.s < 0.99 ? String(Math.max(0, 1 - away * 4) * pinchedIn) : "";
    if (rootRef.current) rootRef.current.style.opacity = l.o < 1 ? String(l.o) : "";
  }

  function stop() { cancelAnimationFrame(anim.current); }

  /** Photos other than the current one go back to fitted, out of sight. */
  function resetOthers() {
    slideRefs.current.forEach((el, j) => { if (el && j !== idx.current) el.style.transform = ""; });
  }

  function animate(to: Partial<Live>, ms = 300, done?: () => void) {
    stop();
    const from = { ...live.current };
    const target = { ...from, ...to };
    const keys = Object.keys(target) as (keyof Live)[];
    const dur = reduced.current ? 0 : ms;
    const t0 = performance.now();
    const frame = (now: number) => {
      const p = dur > 0 ? Math.min(1, (now - t0) / dur) : 1;
      const e = easeOut(p);
      for (const k of keys) live.current[k] = from[k] + (target[k] - from[k]) * e;
      paint();
      if (p < 1) anim.current = requestAnimationFrame(frame);
      else { resetOthers(); setZoomed(live.current.s > 1.01); done?.(); }
    };
    anim.current = requestAnimationFrame(frame);
  }

  function settle(view: View = live.current, ms = 300) {
    animate({ s: view.s, x: view.x, y: view.y, track: home(), dx: 0, dy: 0 }, ms);
  }

  function go(to: number, ms = 320) {
    if (to < 0 || to >= n || closing.current) return settle();
    if (to === idx.current) return settle();
    const from = idx.current;
    // the photo being left keeps its zoom while it slides out of view, and only then resets
    slideRefs.current.forEach((el, j) => { if (el && j !== from && j !== to) el.style.transform = ""; });
    idx.current = to;
    Object.assign(live.current, IDENTITY, { dx: 0, dy: 0 });
    setZoomed(false);
    onIndexChange(to);
    animate({ track: home() }, ms);
  }

  function close(kind: "fling" | "fade", dir = 1) {
    if (closing.current) return;
    closing.current = true;
    clearTimeout(g.current.tapTimer);
    if (kind === "fling") animate({ dy: dir * geo.current.box.h, o: 0.6 }, 220, onClose);
    else animate({ s: Math.min(live.current.s, 0.6), x: 0, y: 0, o: 0 }, 200, onClose);
  }

  function zoomBy(k: number, focus: Point = { x: 0, y: 0 }) {
    const i = idx.current;
    const l = live.current;
    const s = Math.min(maxOf(i), Math.max(1, l.s * k));
    settle(clampView(zoomAt(l, s, focus), fitOf(i), geo.current.box), 220);
  }

  // follow the viewer's size: a rotated phone or resized window starts the photo fitted again
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
      setZoomed(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    stop();
    Object.assign(live.current, IDENTITY, { track: home(), dx: 0, dy: 0 });
    resetOthers();
    paint();
  }, [box.w, box.h]);
  useEffect(() => {
    rootRef.current?.focus();
    const gs = g.current;
    return () => { cancelAnimationFrame(anim.current); clearTimeout(gs.tapTimer); };
  }, []);

  const toLocal = (p: Point): Point => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: p.x - r.left - r.width / 2, y: p.y - r.top - r.height / 2 };
  };

  function beginPinch() {
    const s = g.current;
    const [a, b] = [...s.pts.values()];
    const l = live.current;
    s.mode = "pinch";
    s.base = { s: l.s, x: l.x, y: l.y };
    s.pinchFromFit = l.s <= 1.01;
    s.dist0 = dist(a, b) || 1;
    s.mid0 = toLocal(mid(a, b));
    s.lastMid = s.mid0;
  }

  function beginPan(p: Point, fromPinch: boolean) {
    const s = g.current;
    const l = live.current;
    s.mode = "pan";
    s.fromPinch = fromPinch;
    s.start = p;
    s.base = { s: l.s, x: l.x, y: l.y };
    s.baseTrack = l.track;
    s.samples = [];
  }

  function velocity(at: number): Point {
    const smp = g.current.samples;
    if (smp.length < 2) return { x: 0, y: 0 };
    const lastS = smp[smp.length - 1];
    // a finger that stopped before lifting carries no momentum
    if (at - lastS.t > 80) return { x: 0, y: 0 };
    const first = smp.find((p) => lastS.t - p.t <= 100) ?? smp[0];
    const dt = lastS.t - first.t;
    return dt > 0 ? { x: (lastS.x - first.x) / dt, y: (lastS.y - first.y) / dt } : { x: 0, y: 0 };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (closing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = g.current;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.pointerType = e.pointerType;
    stop(); // catch the photo wherever an animation had got to
    const l = live.current;
    if (s.pts.size === 1) {
      s.mode = "pending";
      s.start = { x: e.clientX, y: e.clientY };
      s.base = { s: l.s, x: l.x, y: l.y };
      s.baseTrack = l.track;
      s.fromPinch = false;
      s.pinchFromFit = false;
      s.samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    } else if (s.pts.size === 2) {
      clearTimeout(s.tapTimer);
      s.lastTap = null;
      beginPinch();
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    if (!s.pts.has(e.pointerId) || closing.current) return;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const i = idx.current;
    const { box } = geo.current;
    const fit = fitOf(i);
    const l = live.current;

    if (s.mode === "pinch") {
      const [a, b] = [...s.pts.values()];
      const m = toLocal(mid(a, b));
      s.lastMid = m;
      const sc = rubberScale((s.base.s * dist(a, b)) / s.dist0, 1, maxOf(i));
      let v = zoomAt(s.base, sc, s.mid0);
      v = { s: sc, x: v.x + m.x - s.mid0.x, y: v.y + m.y - s.mid0.y };
      // pinched smaller than fitted, the photo just follows the fingers on its way to closing
      Object.assign(l, sc >= 1 ? rubberView(v, fit, box) : v);
      paint();
      return;
    }
    if (s.pts.size !== 1) return;

    const dx = e.clientX - s.start.x;
    const dy = e.clientY - s.start.y;
    s.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > 150) s.samples.shift();

    if (s.mode === "pending") {
      if (Math.hypot(dx, dy) < SLOP) return;
      clearTimeout(s.tapTimer);
      s.lastTap = null;
      if (l.s > 1.01) s.mode = "pan";
      else if (Math.abs(dx) > Math.abs(dy)) s.mode = "swipe";
      else s.mode = "dismiss";
    }

    if (s.mode === "pan") {
      const lim = panLimit(l.s, fit, box);
      let x = s.base.x + dx;
      let track = s.baseTrack;
      // dragging a zoomed photo past its edge pulls the next one in, as in Photos
      if (!s.fromPinch && x > lim.x && i > 0) { track = s.baseTrack + (x - lim.x); x = lim.x; }
      else if (!s.fromPinch && x < -lim.x && i < n - 1) { track = s.baseTrack + (x + lim.x); x = -lim.x; }
      l.x = rubberClamp(x, -lim.x, lim.x, box.w);
      l.y = rubberClamp(s.base.y + dy, -lim.y, lim.y, box.h);
      l.track = track;
    } else if (s.mode === "swipe") {
      let off = s.baseTrack + dx - home();
      // nothing further that way: the strip gives a little and springs back
      if ((i === 0 && off > 0) || (i === n - 1 && off < 0)) off = rubber(off, box.w);
      l.track = home() + off;
    } else if (s.mode === "dismiss") {
      l.dx = dx;
      l.dy = dy;
    }
    paint();
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const s = g.current;
    if (!s.pts.delete(e.pointerId)) return;
    if (closing.current) return;
    if (s.pts.size >= 2) return beginPinch();
    if (s.pts.size === 1) {
      // one finger lifted from a pinch: carry on panning with the other, no jump
      if (s.mode === "pinch") beginPan([...s.pts.values()][0], true);
      return;
    }
    release(e, cancelled);
    s.mode = "idle";
  }

  function release(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const s = g.current;
    const i = idx.current;
    const { box } = geo.current;
    const fit = fitOf(i);
    const max = maxOf(i);
    const l = live.current;
    const v = velocity(e.timeStamp);
    const off = l.track - home();
    const W = step();
    /** Whether a sideways drag went far or fast enough to land on the neighbouring photo, and which way. */
    const flip = () => (off < -W * 0.2 || (v.x < -0.35 && off < -10) ? 1 : off > W * 0.2 || (v.x > 0.35 && off > 10) ? -1 : 0);

    switch (s.mode) {
      case "pending":
        if (cancelled) return settle();
        return tap(e);
      case "swipe": {
        const d = flip();
        // a quick flick lands sooner than a slow drag
        return d ? go(i + d, Math.abs(v.x) > 0.8 ? 220 : 320) : settle();
      }
      case "dismiss":
        if (Math.abs(l.dy) > box.h * 0.12 || (Math.abs(v.y) > 0.5 && Math.sign(v.y) === Math.sign(l.dy))) return close("fling", Math.sign(l.dy || v.y) || 1);
        return settle(live.current, 260);
      case "pinch":
      case "pan": {
        if (s.pinchFromFit && l.s < 0.85) return close("fade");
        if (Math.abs(off) > 1) {
          const d = flip();
          if (d) return go(i + d);
        }
        let target: View = { s: l.s, x: l.x, y: l.y };
        let ms = 300;
        if (target.s < 1) target = IDENTITY;
        else if (target.s > max) target = zoomAt(target, max, s.lastMid);
        else if (s.mode === "pan") {
          // momentum: the eased glide covers a third of what the release speed would over its duration
          ms = 500;
          target = { ...target, x: target.x + (v.x * ms) / 3, y: target.y + (v.y * ms) / 3 };
        }
        return settle(clampView(target, fit, box), ms);
      }
    }
  }

  function tap(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    const p = toLocal({ x: e.clientX, y: e.clientY });
    const i = idx.current;
    const { box } = geo.current;
    if (s.lastTap && e.timeStamp - s.lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - s.lastTap.x, p.y - s.lastTap.y) < 40) {
      clearTimeout(s.tapTimer);
      s.lastTap = null;
      return settle(doubleTapView(live.current, p, fitOf(i), box, maxOf(i)), 300);
    }
    const l = live.current;
    const fit = fitOf(i);
    const onPhoto = Math.abs(p.x - l.x) <= (fit.w * l.s) / 2 && Math.abs(p.y - l.y) <= (fit.h * l.s) / 2;
    // a click beside the photo closes it, as on the web, straight away: there is nothing there to double-click
    if (s.pointerType === "mouse" && !onPhoto) return close("fade");
    s.lastTap = { t: e.timeStamp, x: p.x, y: p.y };
    clearTimeout(s.tapTimer);
    settle(live.current, 200); // tidy up anything a touch interrupted mid-animation
    // a tap shows or hides the controls, as on a phone, once it is clear it wasn't the first of a double tap
    s.tapTimer = window.setTimeout(() => { s.lastTap = null; setChrome((c) => !c); }, DOUBLE_TAP_MS);
  }

  // React's wheel listener is passive and can't stop the page zooming, so this one is added by hand
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (closing.current || g.current.pts.size) return;
    const i = idx.current;
    const { box } = geo.current;
    const l = live.current;
    const p = toLocal({ x: e.clientX, y: e.clientY });
    const scale = e.deltaMode === 1 ? 16 : 1;
    if (e.ctrlKey || e.metaKey) {
      // a trackpad pinch arrives as ctrl + scroll
      stop();
      const s = Math.min(maxOf(i), Math.max(1, l.s * Math.exp(-e.deltaY * scale * 0.01)));
      Object.assign(l, clampView(zoomAt(l, s, p), fitOf(i), box));
      paint();
      setZoomed(s > 1.01);
    } else if (l.s > 1.01) {
      stop();
      Object.assign(l, clampView({ s: l.s, x: l.x - e.deltaX * scale, y: l.y - e.deltaY * scale }, fitOf(i), box));
      paint();
    } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 15 && e.timeStamp - g.current.lastWheelNav > 450) {
      // a two-finger sideways swipe on a trackpad moves between photos
      g.current.lastWheelNav = e.timeStamp;
      go(i + Math.sign(e.deltaX));
    }
  };
  const wheelRef = useRef(onWheel);
  useLayoutEffect(() => { wheelRef.current = onWheel; });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => wheelRef.current(e);
    // Safari's own pinch zoom would scale the whole page instead of the photo
    const gesture = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", gesture);
    el.addEventListener("gesturechange", gesture);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", gesture);
      el.removeEventListener("gesturechange", gesture);
    };
  }, []);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowRight") go(idx.current + 1);
    else if (e.key === "ArrowLeft") go(idx.current - 1);
    else if (e.key === "+" || e.key === "=") zoomBy(1.6);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.6);
    else if (e.key === "0") settle(IDENTITY, 220);
    else return;
    e.preventDefault();
  }

  const url = urls[index];
  const barClass = cn("absolute inset-x-0 flex items-center text-white transition-opacity duration-200", chrome ? "pointer-events-auto" : "pointer-events-none opacity-0");
  const iconBtn = "rounded-full p-2.5 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white";

  return (
    <div ref={rootRef} tabIndex={-1} className="absolute inset-0 overflow-hidden outline-none" onKeyDown={onKeyDown}>
      <DialogPrimitive.Title className="sr-only">{n > 1 ? `Photo ${index + 1} of ${n}` : "Photo"}</DialogPrimitive.Title>
      <div ref={backdropRef} className="absolute inset-0 bg-black" />
      <div
        ref={stageRef}
        className={cn("absolute inset-0 touch-none [-webkit-touch-callout:none]", zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div ref={trackRef} className="absolute inset-0 will-change-transform">
          {urls.map((u, j) => {
            const fit = fitSize(natural[j] ?? box, box);
            return (
              <div key={j} className="absolute inset-y-0 flex items-center justify-center" style={{ left: j * (box.w + GAP), width: box.w }}>
                <div ref={(el) => { slideRefs.current[j] = el; }} className="relative shrink-0 will-change-transform" style={{ width: fit.w, height: fit.h }}>
                  {u ? (
                    <img
                      src={u}
                      alt={`Attached photo ${j + 1}`}
                      draggable={false}
                      decoding="async"
                      onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; setNatural((m) => (m[j]?.w === w && m[j]?.h === h ? m : { ...m, [j]: { w, h } })); }}
                      className={cn("size-full object-contain transition-opacity duration-200", natural[j] ? "opacity-100" : "opacity-0")}
                    />
                  ) : null}
                  {!u || !natural[j] ? (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
                      {u ? <Loader2 className="size-6 animate-spin" aria-label="Loading" /> : "Not available offline"}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={chromeRef} className="pointer-events-none absolute inset-0">
        <div className={cn(barClass, "top-0 gap-1 bg-linear-to-b from-black/60 to-transparent px-2 pb-8 pt-[max(0.5rem,env(safe-area-inset-top))]")}>
          <span className="flex-1 pl-3 text-sm font-medium tabular">{n > 1 ? `${index + 1} of ${n}` : ""}</span>
          {url ? (
            <a href={url} target="_blank" rel="noopener" aria-label="Open original" title="Open original" className={iconBtn}><ExternalLink className="size-5" /></a>
          ) : null}
          <DialogPrimitive.Close aria-label="Close" title="Close" className={iconBtn}><X className="size-5" /></DialogPrimitive.Close>
        </div>
        {n > 1 ? (
          <>
            {/* arrows for a mouse; on a phone the photos swipe */}
            <div className={cn(barClass, "inset-x-auto left-2 top-1/2 -translate-y-1/2 pointer-coarse:hidden")}>
              <button type="button" aria-label="Previous photo" disabled={index === 0} onClick={() => go(index - 1)} className={cn(iconBtn, "bg-black/40 disabled:opacity-0")}><ChevronLeft className="size-6" /></button>
            </div>
            <div className={cn(barClass, "inset-x-auto right-2 top-1/2 -translate-y-1/2 pointer-coarse:hidden")}>
              <button type="button" aria-label="Next photo" disabled={index === n - 1} onClick={() => go(index + 1)} className={cn(iconBtn, "bg-black/40 disabled:opacity-0")}><ChevronRight className="size-6" /></button>
            </div>
            <div className={cn(barClass, "bottom-0 justify-center bg-linear-to-t from-black/50 to-transparent pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
              {urls.map((_, j) => (
                <button key={j} type="button" aria-label={`Photo ${j + 1}`} aria-current={j === index} onClick={() => go(j)} className="p-1.5">
                  <span className={cn("block size-2 rounded-full transition-colors", j === index ? "bg-white" : "bg-white/40")} />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
