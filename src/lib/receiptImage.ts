/**
 * Gets a photo ready for OCR. A receipt photographed on a table is a strip of paper in a busy frame: the
 * table's grain, scratches and glare come out as dozens of junk "words", and the amounts get read badly or
 * not at all. So the paper is found and cropped to, and the colour dropped, before Tesseract sees it.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Otsu's threshold: the brightness that best splits the pixels into a dark and a light group. */
function otsu(lum: ArrayLike<number>, from = 0): number {
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  for (let i = 0; i < lum.length; i++) if (lum[i] > from) { hist[lum[i] | 0]++; n++; }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, at = from;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; at = t; }
  }
  return at;
}

/**
 * Where the paper is, on a small greyscale copy of the photo (one brightness value per cell), or null
 * when there is nothing to crop: the paper fills the frame (a screenshot, a close-up), or the bright area
 * isn't solid like paper (a dark-mode screenshot's text).
 */
export function paperBox(lum: ArrayLike<number>, w: number, h: number): Box | null {
  // Paper is the brightest thing in the frame, but a shiny table has bright patches of its own, and where
  // its glare touches the paper the two make one blob that isn't solid like a sheet. So the cut-off starts
  // where the bright half splits again and is raised step by step: the glare drops out before the paper does.
  const t1 = otsu(lum);
  const t2 = otsu(lum, t1);
  for (let t = t2; t < 250; t += 6) {
    let above = 0;
    for (let i = 0; i < lum.length; i++) if (lum[i] > t) above++;
    if (above < w * h * 0.03) break; // too little left to be a receipt
    const box = findPaper(lum, w, h, t);
    if (box) return box;
  }
  return findPaper(lum, w, h, t1);
}

function findPaper(lum: ArrayLike<number>, w: number, h: number, t: number): Box | null {
  let mask = Uint8Array.from({ length: w * h }, (_, i) => (lum[i] > t ? 1 : 0));
  // printed lines split the paper into bands at this size: close the gaps between them
  for (let k = 0; k < 2; k++) {
    const grown = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) grown[yy * w + xx] = 1;
      }
    }
    mask = grown;
  }
  // the largest bright patch
  const seen = new Uint8Array(w * h);
  let biggest = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    const c = { area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i - x) / w;
      c.area++;
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (c.area > biggest.area) biggest = c;
  }
  const bw = biggest.x1 - biggest.x0 + 1, bh = biggest.y1 - biggest.y0 + 1;
  const frame = w * h;
  if (biggest.area < frame * 0.03) return null; // no paper to speak of
  if (bw * bh > frame * 0.85) return null; // the paper is the whole picture
  if (biggest.area < bw * bh * 0.6) return null; // scattered bright bits, not a sheet
  const mx = Math.ceil(w * 0.04), my = Math.ceil(h * 0.04);
  const x = Math.max(0, biggest.x0 - mx), y = Math.max(0, biggest.y0 - my);
  return { x, y, w: Math.min(w, biggest.x1 + 1 + mx) - x, h: Math.min(h, biggest.y1 + 1 + my) - y };
}

/** A crop whose longer side is shorter than this is enlarged, up to MAX_UPSCALE times. */
const MIN_LONG_SIDE = 1500;
const MAX_UPSCALE = 2.5;
/** Longest side of the copy the paper is looked for on: plenty to find a receipt, and quick to scan. */
const GRID = 200;

/** The photo cropped to its paper (when it has any) and in greyscale, as a PNG for Tesseract. */
export async function prepareForOcr(image: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, GRID / Math.max(bitmap.width, bitmap.height));
    const gw = Math.max(1, Math.round(bitmap.width * scale)), gh = Math.max(1, Math.round(bitmap.height * scale));
    const small = new OffscreenCanvas(gw, gh).getContext("2d", { willReadFrequently: true })!;
    small.imageSmoothingQuality = "high";
    small.drawImage(bitmap, 0, 0, gw, gh);
    const px = small.getImageData(0, 0, gw, gh).data;
    const lum = new Uint8Array(gw * gh);
    for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const box = paperBox(lum, gw, gh);
    const sx = bitmap.width / gw, sy = bitmap.height / gh;
    const crop = box
      ? { x: Math.round(box.x * sx), y: Math.round(box.y * sy), w: Math.round(box.w * sx), h: Math.round(box.h * sy) }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
    // Tesseract reads text best at about 30 px or more: a receipt that's small in a small photo is enlarged
    // (a few percent only blurs it, so that's left alone)
    const need = MIN_LONG_SIDE / Math.max(crop.w, crop.h);
    const up = need >= 1.25 ? Math.min(MAX_UPSCALE, need) : 1;
    const canvas = new OffscreenCanvas(Math.round(crop.w * up), Math.round(crop.h * up));
    const ctx = canvas.getContext("2d")!;
    ctx.filter = "grayscale(1)";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
