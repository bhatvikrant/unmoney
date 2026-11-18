/**
 * Picks the amount paid out of the text OCR read from a receipt or a payment screenshot, or nothing
 * when it can't be sure. A wrong amount filled in silently is worse than none, so every rule here
 * errs towards giving up: only words the OCR is confident about count, and two different answers
 * that are equally likely cancel out.
 */

/** money: a sign was seen before the number that OCR couldn't read as one (its English model has no ₹). */
export type OcrWord = { text: string; confidence: number; money?: boolean };
/** One line of text as OCR read it, and how tall it is on the image (bigger text is more prominent). */
export type OcrLine = { words: OcrWord[]; height: number };

/** Tesseract's word confidence (0–100) a number has to reach before it is trusted. */
export const MIN_WORD_CONFIDENCE = 85;
/** Amounts above this are more likely a phone, card or order number than a price. */
const MAX_AMOUNT = 10_000_000;

/** Labels for the amount paid, strongest first: a line with an earlier one beats a line with a later one. */
const TOTAL_LABELS: RegExp[] = [
  /\b(grand\s*total|net\s*payable|total\s*payable|amount\s*payable|net\s*amount|amount\s*paid|total\s*paid|you\s*paid|paid\s*amount|bill\s*amount|total\s*amount|amount\s*due|total\s*due|balance\s*due)\b/i,
  /\btotal\b/i,
];
/** Lines that mention a total but are not the amount paid. */
const NOT_TOTAL = /\b(sub\s*-?\s*total|total\s*(items?|qty|quantity|savings?|discount|tax|gst|vat|weight)|savings?|discount|you\s*saved|change|tendered|round(ed)?\s*off|cgst|sgst|igst)\b/i;
/** Symbols and codes that mark a number as money. */
const CURRENCY = /(₹|rs\.?|inr|\$|usd|€|eur|£|gbp|¥|aed|sgd)/i;

/**
 * Reads one word as an amount, whichever way it groups thousands: "1,23,456.50", "1.234,50", "₹500", "500/-".
 * A separator followed by exactly one or two digits at the end is the decimal point; any other is grouping.
 */
export function parseAmount(word: string): number | null {
  if (!word) return null;
  const s = word.replace(CURRENCY, "").replace(/\/-$|[:;)]$/g, "").replace(/^[:(]/, "").trim();
  if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}/.test(s) || /[.,]$/.test(s)) return null;
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s)!;
  const [whole, frac = ""] = [m[1], m[2]];
  // what's left must be plain digits, or digits grouped by one kind of separator in groups of 2 or 3
  const seps = new Set(whole.match(/[.,]/g) ?? []);
  if (seps.size > 1) return null;
  if (seps.size === 1 && !/^\d{1,3}([.,]\d{2,3})+$/.test(whole)) return null;
  // a decimal mark that is also the grouping mark ("1,234,56") is ambiguous
  if (frac && seps.size === 1 && s[s.length - frac.length - 1] === [...seps][0]) return null;
  const n = Number(whole.replace(/[.,]/g, "") + (frac ? "." + frac : ""));
  return Number.isFinite(n) && n > 0 && n < MAX_AMOUNT ? n : null;
}

type Found = { amount: number; money: boolean };

/** The confident amounts on a line, in reading order, and whether each was marked as money. */
function amountsOn(line: OcrLine): Found[] {
  const out: Found[] = [];
  line.words.forEach((w, i) => {
    if (w.confidence < MIN_WORD_CONFIDENCE) return;
    const amount = parseAmount(w.text);
    if (amount === null) return;
    // a lone integer next to an unreadable word may be a fragment of something longer
    const prev = line.words[i - 1];
    out.push({ amount, money: !!w.money || CURRENCY.test(w.text) || (!!prev && CURRENCY.test(prev.text) && prev.text.replace(CURRENCY, "").trim() === "") });
  });
  return out;
}

const lineText = (l: OcrLine) => l.words.map((w) => w.text).join(" ");
const one = (xs: number[]) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);

/**
 * The amount paid, or null when it isn't clear. First a total line ("Grand total ₹1,250.00"; the amount
 * may sit on the next line); failing that, on a screenshot such as a UPI payment, the amount in the
 * largest text, as long as it is the only money in that size.
 */
export function pickAmount(lines: OcrLine[]): number | null {
  for (const label of TOTAL_LABELS) {
    const hits: number[] = [];
    lines.forEach((line, i) => {
      const text = lineText(line);
      if (!label.test(text) || NOT_TOTAL.test(text)) return;
      const here = amountsOn(line);
      const next = lines[i + 1];
      const found = here.length ? here : next && !TOTAL_LABELS.some((l) => l.test(lineText(next))) ? amountsOn(next) : [];
      // the amount is the last number on a total line: "Total 3 items 450.00"
      if (found.length) hits.push(found[found.length - 1].amount);
    });
    if (hits.length) return one(hits);
  }

  const money = lines.flatMap((line) => amountsOn(line).filter((f) => f.money).map((f) => ({ amount: f.amount, height: line.height })));
  if (!money.length) return null;
  const tallest = Math.max(...money.map((m) => m.height));
  const top = money.filter((m) => m.height >= tallest * 0.9);
  const rest = money.filter((m) => m.height < tallest * 0.9);
  // the big number has to stand out from the other money on the page, or it is just one price of many
  if (rest.length && Math.max(...rest.map((m) => m.height)) > tallest / 1.4) return null;
  return one(top.map((m) => m.amount));
}
