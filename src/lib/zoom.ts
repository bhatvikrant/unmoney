/**
 * The geometry behind the photo viewer's pinch, pan and double-tap zoom. Pure, so it is tested without a browser.
 *
 * A photo is laid out at its "fit" size, centred in the viewer. On top of that sits a transform
 * `translate(x, y) scale(s)` around the photo's centre, so a point `q` on the fitted photo (measured from its centre)
 * is drawn at `x + s·q` from the viewer's centre. `s = 1` is the photo fitted to the screen.
 */

export type Size = { w: number; h: number };
export type View = { s: number; x: number; y: number };
export type Point = { x: number; y: number };

export const IDENTITY: View = { s: 1, x: 0, y: 0 };

/** The photo shrunk (or grown) to fit inside the box without cropping. */
export function fitSize(natural: Size, box: Size): Size {
  if (!natural.w || !natural.h || !box.w || !box.h) return { w: box.w, h: box.h };
  const k = Math.min(box.w / natural.w, box.h / natural.h);
  return { w: natural.w * k, h: natural.h * k };
}

/** How far in a photo zooms: always at least 4×, and far enough to see its own pixels doubled, up to 10×. */
export function maxScale(natural: Size, fit: Size): number {
  const native = fit.w ? natural.w / fit.w : 1;
  return Math.min(10, Math.max(4, native * 2));
}

/** The furthest the photo can be dragged on each axis at scale `s` before an edge comes away from the viewer's. */
export function panLimit(s: number, fit: Size, box: Size): Point {
  return { x: Math.max(0, (fit.w * s - box.w) / 2), y: Math.max(0, (fit.h * s - box.h) / 2) };
}

/** Keeps the photo covering the viewer where it can, and centred on any axis where it is smaller than the viewer. */
export function clampView(v: View, fit: Size, box: Size): View {
  const lim = panLimit(v.s, fit, box);
  return { s: v.s, x: Math.min(lim.x, Math.max(-lim.x, v.x)), y: Math.min(lim.y, Math.max(-lim.y, v.y)) };
}

/** Rescales to `s` while keeping the photo point under `focus` (from the viewer's centre) under it. */
export function zoomAt(v: View, s: number, focus: Point): View {
  const k = s / v.s;
  return { s, x: focus.x - (focus.x - v.x) * k, y: focus.y - (focus.y - v.y) * k };
}

/** Past a limit the photo moves less and less the further it is pulled, like iOS. `over` is how far past the limit. */
export function rubber(over: number, dimension: number): number {
  if (!dimension) return 0;
  const c = 0.55;
  return (1 - 1 / ((Math.abs(over) * c) / dimension + 1)) * dimension * Math.sign(over);
}

/** `value` held within [min, max], with any overshoot softened by `rubber`. */
export function rubberClamp(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min + rubber(value - min, dimension);
  if (value > max) return max + rubber(value - max, dimension);
  return value;
}

/** Pan with the edges pulling back elastically, for while a finger is still down. */
export function rubberView(v: View, fit: Size, box: Size): View {
  const lim = panLimit(v.s, fit, box);
  return { s: v.s, x: rubberClamp(v.x, -lim.x, lim.x, box.w), y: rubberClamp(v.y, -lim.y, lim.y, box.h) };
}

/** Scale with the floor and ceiling pulling back elastically, so a pinch past either still responds a little. */
export function rubberScale(s: number, min: number, max: number): number {
  if (s < min) return min * Math.pow(s / min, 0.35);
  if (s > max) return max * Math.pow(s / max, 0.35);
  return s;
}

/** Where a double tap at `focus` lands: zoomed in on that spot, or back to fitted when already zoomed. */
export function doubleTapView(v: View, focus: Point, fit: Size, box: Size, max: number): View {
  if (v.s > 1.01) return IDENTITY;
  // a long, narrow receipt zooms until it fills the screen's width, anything else to 2.5×
  const s = Math.min(max, Math.max(2.5, box.w / fit.w));
  return clampView(zoomAt(v, s, focus), fit, box);
}
