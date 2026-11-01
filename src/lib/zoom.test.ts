import { describe, expect, it } from "vitest";
import { clampView, doubleTapView, fitSize, IDENTITY, maxScale, rubber, rubberScale, zoomAt } from "./zoom";

const box = { w: 400, h: 800 };

describe("fitSize", () => {
  it("fits a landscape photo to the width", () => expect(fitSize({ w: 2000, h: 1000 }, box)).toEqual({ w: 400, h: 200 }));
  it("fits a tall receipt to the height", () => expect(fitSize({ w: 500, h: 2000 }, box)).toEqual({ w: 200, h: 800 }));
  it("falls back to the box before the photo has loaded", () => expect(fitSize({ w: 0, h: 0 }, box)).toEqual(box));
});

describe("maxScale", () => {
  it("is at least 4×", () => expect(maxScale({ w: 400, h: 200 }, { w: 400, h: 200 })).toBe(4));
  it("reaches double the photo's own pixels", () => expect(maxScale({ w: 1200, h: 600 }, { w: 400, h: 200 })).toBe(6));
  it("stops at 10×", () => expect(maxScale({ w: 4000, h: 2000 }, { w: 400, h: 200 })).toBe(10));
});

describe("zoomAt", () => {
  it("keeps the point under the fingers still", () => {
    const focus = { x: 100, y: -50 };
    const v = zoomAt(IDENTITY, 3, focus);
    // at s=1 the photo point q = focus sat under the fingers; after zooming it is drawn at x + s·q
    expect(v.x + 3 * focus.x).toBeCloseTo(focus.x);
    expect(v.y + 3 * focus.y).toBeCloseTo(focus.y);
  });
  it("round-trips", () => {
    const f = { x: 30, y: 70 };
    const back = zoomAt(zoomAt({ s: 1.5, x: 10, y: -20 }, 4, f), 1.5, f);
    expect(back.x).toBeCloseTo(10);
    expect(back.y).toBeCloseTo(-20);
  });
});

describe("clampView", () => {
  const fit = { w: 400, h: 200 };
  it("centres an axis that is smaller than the viewer", () => expect(clampView({ s: 2, x: 0, y: 300 }, fit, box)).toEqual({ s: 2, x: 0, y: 0 }));
  it("stops the photo's edge at the viewer's edge", () => expect(clampView({ s: 2, x: 999, y: 0 }, fit, box)).toEqual({ s: 2, x: 200, y: 0 }));
  it("allows vertical pan once the photo is taller than the viewer", () => expect(clampView({ s: 6, x: 0, y: -999 }, fit, box).y).toBe(-200));
});

describe("rubber", () => {
  it("gives less than it is pulled", () => {
    expect(rubber(100, 400)).toBeGreaterThan(0);
    expect(rubber(100, 400)).toBeLessThan(100);
    expect(rubber(-100, 400)).toBeCloseTo(-rubber(100, 400));
  });
  it("leaves a scale within limits alone and softens one beyond them", () => {
    expect(rubberScale(2, 1, 4)).toBe(2);
    expect(rubberScale(0.5, 1, 4)).toBeGreaterThan(0.5);
    expect(rubberScale(8, 1, 4)).toBeLessThan(8);
  });
});

describe("doubleTapView", () => {
  it("zooms a fitted photo in on the tapped spot", () => {
    const v = doubleTapView(IDENTITY, { x: 100, y: 0 }, { w: 400, h: 200 }, box, 6);
    expect(v.s).toBe(2.5);
    expect(v.x).toBe(-150);
  });
  it("fills the width with a narrow receipt", () => expect(doubleTapView(IDENTITY, { x: 0, y: 0 }, { w: 100, h: 800 }, box, 10).s).toBe(4));
  it("goes back to fitted when zoomed", () => expect(doubleTapView({ s: 3, x: 50, y: 0 }, { x: 0, y: 0 }, { w: 400, h: 200 }, box, 6)).toEqual(IDENTITY));
});
