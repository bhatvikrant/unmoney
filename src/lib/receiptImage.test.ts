import { expect, test } from "vitest";
import { paperBox } from "./receiptImage";

/** A w×h brightness grid: grey table, then each painted rectangle. */
function grid(w: number, h: number, paint: [number, number, number, number, number][]) {
  const lum = new Uint8Array(w * h).fill(140);
  for (const [x0, y0, x1, y1, v] of paint) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * w + x] = v;
  return lum;
}
/** Receipt-like: white paper with a dark printed line every 4 rows. */
const receipt = (x0: number, y0: number, x1: number, y1: number): [number, number, number, number, number][] => [
  [x0, y0, x1, y1, 235],
  ...Array.from({ length: Math.floor((y1 - y0) / 4) }, (_, i): [number, number, number, number, number] => [x0 + 3, y0 + 2 + i * 4, x1 - 3, y0 + 3 + i * 4, 60]),
];

test("finds a receipt on a table, past its printed lines and the table's glare", () => {
  const lum = grid(150, 200, [[0, 0, 40, 30, 210], ...receipt(40, 40, 95, 195)]);
  const box = paperBox(lum, 150, 200)!;
  expect(box.x).toBeLessThanOrEqual(40);
  expect(box.y).toBeLessThanOrEqual(40);
  expect(box.x + box.w).toBeGreaterThanOrEqual(95);
  expect(box.y + box.h).toBeGreaterThanOrEqual(195);
  expect(box.w).toBeLessThan(80);
});

test("nothing to crop when the paper fills the photo", () => {
  expect(paperBox(grid(100, 100, receipt(0, 0, 100, 100)), 100, 100)).toBeNull();
});

test("nothing to crop when the bright bits are scattered, like a dark screenshot's text", () => {
  const dots = Array.from({ length: 200 }, (_, i): [number, number, number, number, number] => [(i * 37) % 98, (i * 53) % 98, ((i * 37) % 98) + 1, ((i * 53) % 98) + 1, 250]);
  expect(paperBox(grid(100, 100, dots.map(([a, b, c, d]) => [a, b, c, d, 250])).map((v) => (v === 140 ? 20 : v)), 100, 100)).toBeNull();
});
