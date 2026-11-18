/**
 * Reads the amount off a receipt photo, on the device. Tesseract (WebAssembly) and its English model
 * load from the jsDelivr CDN the first time a photo is attached, and the model is kept in IndexedDB
 * after that; the photo itself never leaves the device for this. Nothing here throws: when the
 * engine can't load (offline on first use) or the amount isn't clear, the answer is null.
 */
import type { Bbox, Worker, Word } from "tesseract.js";
import { MIN_WORD_CONFIDENCE, parseAmount, pickAmount, type OcrLine, type OcrWord } from "./receiptAmount";

let worker: Promise<Worker> | null = null;
/** An idle worker holds tens of MB: let it go a while after the last photo. */
const IDLE_MS = 60_000;
let idle: ReturnType<typeof setTimeout> | undefined;
/** Second reads are a fraction of a second each; a long receipt doesn't get more than this many. */
const MAX_REREADS = 8;

function getWorker(): Promise<Worker> {
  worker ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng")).catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

const width = (b: Bbox) => b.x1 - b.x0;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Where a number's digits start inside its word. The ₹ sign isn't in the English model: it comes out as
 * another sign (¥, %) or fused with the first digit into one glyph twice as wide as the rest. Either
 * way it is left out, and reported, since a sign there means the number is money.
 */
function digitsStart(w: Word): { left: number; sign: boolean } | null {
  const digits = w.symbols.filter((s) => /\d/.test(s.text));
  if (!digits.length) return null;
  const first = digits[0];
  const typical = digits.length > 1 ? median(digits.slice(1).map((s) => width(s.bbox))) : (w.bbox.y1 - w.bbox.y0) * 0.6;
  const sign = w.symbols[0] !== first;
  if (width(first.bbox) > typical * 1.6) return { left: Math.round(first.bbox.x1 - typical * 1.15), sign: true };
  return { left: first.bbox.x0, sign };
}

/**
 * A number OCR was unsure of is read a second time, digits only, from just its digits. Only when both reads
 * agree, and the second is confident, does it count as confident: two independent readings of the same pixels.
 */
async function reread(w: Worker, image: Blob, word: Word): Promise<OcrWord | null> {
  const start = digitsStart(word);
  const firstRead = parseAmount(word.text.replace(/^\D+/, ""));
  if (!start || firstRead === null) return null;
  const pad = Math.round((word.bbox.y1 - word.bbox.y0) * 0.25);
  const { PSM } = await import("tesseract.js");
  await w.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: PSM.SINGLE_LINE });
  try {
    const { data } = await w.recognize(image, {
      rectangle: { left: Math.max(0, start.left - 2), top: Math.max(0, word.bbox.y0 - pad), width: word.bbox.x1 - start.left + pad, height: word.bbox.y1 - word.bbox.y0 + 2 * pad },
    });
    const text = data.text.trim();
    if (data.confidence < MIN_WORD_CONFIDENCE || parseAmount(text) !== firstRead) return null;
    return { text, confidence: data.confidence, money: start.sign };
  } finally {
    await w.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PSM.AUTO });
  }
}

export async function readAmount(image: Blob): Promise<number | null> {
  clearTimeout(idle);
  try {
    const w = await getWorker();
    const { data } = await w.recognize(image, {}, { blocks: true, text: false });
    const read = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    // the tallest unsure numbers first: on a payment screenshot the amount is the biggest text
    const unsure = read.flatMap((l) => l.words).filter((x) => x.confidence < MIN_WORD_CONFIDENCE && /\d/.test(x.text))
      .sort((a, b) => (b.bbox.y1 - b.bbox.y0) - (a.bbox.y1 - a.bbox.y0)).slice(0, MAX_REREADS);
    const fixed = new Map<Word, OcrWord>();
    for (const x of unsure) {
      const again = await reread(w, image, x);
      if (again) fixed.set(x, again);
    }
    const lines: OcrLine[] = read.map((l) => ({
      words: l.words.map((x) => fixed.get(x) ?? { text: x.text, confidence: x.confidence }),
      height: l.bbox.y1 - l.bbox.y0,
    }));
    return pickAmount(lines);
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
