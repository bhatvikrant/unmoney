/**
 * Reads the amount off a receipt photo, on the device. Tesseract (WebAssembly) and its English model
 * load from the jsDelivr CDN the first time a photo is attached, and the model is kept in IndexedDB
 * after that; the photo itself never leaves the device for this. Nothing here throws: when the
 * engine can't load (offline on first use) or the amount isn't clear, the answer is null.
 */
// The whole module is loaded only once a photo is attached (src/components/tx/fields.tsx imports it lazily),
// so Tesseract is imported here directly. Importing it lazily from here as well put Vite's preload helper,
// which the whole app uses, in this chunk, and every page load then fetched it.
import { createWorker, PSM, type Bbox, type RecognizeOptions, type Worker, type Word } from "tesseract.js";
import { prepareForOcr } from "./receiptImage";
import { MIN_WORD_CONFIDENCE, parseAmount, pickAmount, type OcrLine, type OcrWord } from "./receiptAmount";

let worker: Promise<Worker> | null = null;
/** An idle worker holds tens of MB: let it go a while after the last photo. */
const IDLE_MS = 60_000;
let idle: ReturnType<typeof setTimeout> | undefined;
/** Second reads are a fraction of a second each; a long receipt doesn't get more than this many. */
const MAX_REREADS = 10;

function getWorker(): Promise<Worker> {
  worker ??= createWorker("eng").catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

const width = (b: Bbox) => b.x1 - b.x0;
/**
 * A number as it may have been meant: without the sign in front that OCR made something else of, and with a
 * decimal point that thermal print turned into a dash ("500-00"). Only good for picking what to read again:
 * the second read, digits only, has to come out the same.
 */
const loosely = (text: string) => text.replace(/^\D+/, "").replace(/(\d)[-~](\d{2})$/, "$1.$2");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Where a number's digits start inside its word. The ₹ sign isn't in the English model: it comes out as
 * another sign (¥, %) or fused with the first digit into one glyph twice as wide as the rest. Either
 * way it is left out, and reported as a sign of money when it is one of those.
 */
function digitsStart(w: Word): { left: number; sign: boolean } | null {
  const digits = w.symbols.filter((s) => /\d/.test(s.text));
  if (!digits.length) return null;
  const first = digits[0];
  const typical = digits.length > 1 ? median(digits.slice(1).map((s) => width(s.bbox))) : (w.bbox.y1 - w.bbox.y0) * 0.6;
  // Only a single sign the ₹ is known to come out as, or a real currency sign, means money: "§=5.000" was "Q=5.000"
  const before = w.symbols.slice(0, w.symbols.indexOf(first)).map((s) => s.text).join("");
  const sign = /^[¥%₹$€£]$/.test(before);
  if (width(first.bbox) > typical * 1.6) return { left: Math.round(first.bbox.x1 - typical * 1.15), sign: true };
  return { left: first.bbox.x0, sign };
}

/**
 * A number OCR was unsure of is read a second time, digits only, from just its digits. Only when both reads
 * agree does the number count, at the better of the two confidences; pickAmount decides whether that's enough.
 */
async function reread(w: Worker, image: Blob, word: Word, rotateRadians: number): Promise<OcrWord | null> {
  const start = digitsStart(word);
  const firstRead = parseAmount(loosely(word.text));
  if (!start || firstRead === null) return null;
  const pad = Math.round((word.bbox.y1 - word.bbox.y0) * 0.25);
  // Settings given with the call apply to this read only: Tesseract.js puts the worker's own back after it.
  // The photo is turned by the same angle as the first read, so the word's box lands on the word.
  const { data } = await w.recognize(image, {
    rectangle: { left: Math.max(0, start.left - 2), top: Math.max(0, word.bbox.y0 - pad), width: word.bbox.x1 - start.left + pad, height: word.bbox.y1 - word.bbox.y0 + 2 * pad },
    rotateRadians,
    ...tess({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: PSM.SINGLE_LINE }),
  });
  const text = data.text.trim();
  if (parseAmount(text) !== firstRead) return null;
  // two reads that agree are worth the better of the two
  return { text, confidence: Math.max(word.confidence, data.confidence), money: start.sign };
}

/** Tesseract parameters given with a single call (Tesseract.js's types only list its own options there). */
const tess = (params: Record<string, string>) => params as unknown as Partial<RecognizeOptions>;

/** One photo at a time: Tesseract has one worker and would queue them anyway, and a photo's reads stay together. */
let queue: Promise<unknown> = Promise.resolve();
export function readAmount(image: Blob): Promise<number | null> {
  const run = queue.then(() => readOne(image));
  queue = run;
  return run;
}

/**
 * The page layouts a photo is read with, in turn, until one gives an amount. A receipt reads best as one block
 * of text; a payment screenshot, with its amount set apart in big type, reads best with the layout found
 * automatically. Set on every read, so the first photo after the app opens is read the same way as the tenth.
 */
const LAYOUTS = [PSM.SINGLE_BLOCK, PSM.AUTO];

async function readOne(photo: Blob): Promise<number | null> {
  clearTimeout(idle);
  try {
    const [w, image] = await Promise.all([getWorker(), prepareForOcr(photo).catch(() => photo)]);
    for (const layout of LAYOUTS) {
      const amount = await readWith(w, image, layout);
      if (amount !== null) return amount;
    }
    return null;
  } catch {
    return null;
  } finally {
    idle = setTimeout(() => {
      const w = worker;
      worker = null;
      void w?.then((x) => x.terminate()).catch(() => {});
    }, IDLE_MS);
  }
}

async function readWith(w: Worker, image: Blob, layout: PSM): Promise<number | null> {
  // a photo taken a little tilted is turned straight first
  const { data } = await w.recognize(image, { rotateAuto: true, ...tess({ tessedit_pageseg_mode: layout }) }, { blocks: true, text: false });
  const rotateRadians = data.rotateRadians ?? 0;
  const read = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  // the tallest unsure numbers first: on a payment screenshot the amount is the biggest text
  const unsure = read.flatMap((l) => l.words).filter((x) => x.confidence < MIN_WORD_CONFIDENCE && parseAmount(loosely(x.text)) !== null)
    .sort((a, b) => (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0)).slice(0, MAX_REREADS);
  const fixed = new Map<Word, OcrWord>();
  for (const x of unsure) {
    const again = await reread(w, image, x, rotateRadians);
    if (again) fixed.set(x, again);
  }
  const lines: OcrLine[] = read.map((l) => ({
    words: l.words.map((x) => fixed.get(x) ?? { text: x.text, confidence: x.confidence }),
    height: l.bbox.y1 - l.bbox.y0,
  }));
  return pickAmount(lines);
}
