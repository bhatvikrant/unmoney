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
/**
 * A total or payment amount read with less confidence than that, though at least this, still counts when the
 * bill backs it up: it is the same as the largest price read with confidence ("SUB_TOT 500.00", "PAYTM 500-00").
 */
export const BACKED_UP_CONFIDENCE = 60;
/** Amounts above this are more likely a phone, card or order number than a price. */
const MAX_AMOUNT = 10_000_000;

/** Labels for the amount paid, strongest first: a line with an earlier one beats a line with a later one. */
const TOTAL_LABELS: RegExp[] = [
  /\b(grand\s*total|net\s*payable|total\s*payable|amount\s*payable|net\s*amount|amount\s*paid|total\s*paid|you\s*paid|paid\s*amount|bill\s*amount|total\s*amount|amount\s*due|total\s*due|balance\s*due)\b/i,
  /\btotal\b/i,
];
/**
 * Lines saying how it was paid ("PAYTM 500.00", "Card 609.00"), trusted only after the total labels and only
 * with the amount on the same line. Cash is left out: "Cash 1000, Change 391" is what was handed over.
 */
const PAID_BY = /\b(paytm|g\s*pay|google\s*pay|phone\s*pe|bhim|upi|card|credit\s*card|debit\s*card|visa|master\s*card|rupay|amex|wallet)\b/i;
/** Lines that mention a total but are not the amount paid. */
// OCR often reads GST as 6ST or G5T, so the tax words allow for that
const NOT_TOTAL = /\b(sub\s*[-_]?\s*tot(al)?|total\s*(items?|qty|quantity|savings?|discount|tax(es)?|[g6][s5]t|vat|weight)|savings?|discount|you\s*saved|change|tendered|round(ed)?\s*off|[csi][g6][s5]t)\b/i;
/** Lines whose amount can be more than the bill: what was handed over, change, a wallet or account balance. */
const NOT_COMPARED = /\b(cash|change|tendered|balance|bal|avl|available|refund)\b/i;
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
  // zero-padded: a bill or token number ("000086"), not a price
  if (/^0\d/.test(s)) return null;
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(s)!;
  const [whole, frac = ""] = [m[1], m[2]];
  // what's left must be plain digits, or digits grouped by one kind of separator in groups of 2 or 3
  const seps = new Set(whole.match(/[.,]/g) ?? []);
  if (seps.size > 1) return null;
  if (seps.size === 1 && !/^\d{1,3}([.,]\d{2,3})+$/.test(whole)) return null;
  // "5.000" is five thousand in Europe but a quantity of 5 on an Indian bill ("Q=5.000"): too ambiguous to use
  if (!frac && /^\d{1,3}\.\d{3}$/.test(whole)) return null;
  // a decimal mark that is also the grouping mark ("1,234,56") is ambiguous
  if (frac && seps.size === 1 && s[s.length - frac.length - 1] === [...seps][0]) return null;
  const n = Number(whole.replace(/[.,]/g, "") + (frac ? "." + frac : ""));
  return Number.isFinite(n) && n > 0 && n < MAX_AMOUNT ? n : null;
}

/**
 * priced: written the way prices are, with paise or cents ("450.00") or a currency sign, not a bill or table number.
 * sure: read with MIN_WORD_CONFIDENCE.
 */
type Found = { amount: number; money: boolean; priced: boolean; sure: boolean };

/** The amounts on a line read with at least `min` confidence, in reading order. */
function amountsOn(line: OcrLine, min = MIN_WORD_CONFIDENCE): Found[] {
  const out: Found[] = [];
  line.words.forEach((w, i) => {
    if (w.confidence < min) return;
    const amount = parseAmount(w.text);
    if (amount === null) return;
    // a lone integer next to an unreadable word may be a fragment of something longer
    const prev = line.words[i - 1];
    const money = !!w.money || CURRENCY.test(w.text) || (!!prev && CURRENCY.test(prev.text) && prev.text.replace(CURRENCY, "").trim() === "");
    out.push({ amount, money, priced: money || /[.,]\d{2}$/.test(w.text.replace(/\/-$|[:;)]$/, "")), sure: w.confidence >= MIN_WORD_CONFIDENCE });
  });
  return out;
}

const lineText = (l: OcrLine) => l.words.map((w) => w.text).join(" ");
const one = (xs: number[]) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);
const last = (xs: Found[]) => xs[xs.length - 1];

/**
 * The amount paid, or null when it isn't clear. First a total line ("Grand total ₹1,250.00"; the amount
 * may sit on the next line); then a line saying how it was paid ("PAYTM 500.00"); failing that, on a screenshot such as a UPI payment, the amount in the
 * largest text, as long as it is the only money in that size.
 */
export function pickAmount(lines: OcrLine[]): number | null {
  // The amount paid is never less than another price on the bill (its subtotal, an item): a "total" that is,
  // is the tax or a misread line, and that kind of line is passed over for the next.
  const prices = lines.filter((l) => !NOT_COMPARED.test(lineText(l))).flatMap((l) => amountsOn(l).filter((f) => f.priced).map((f) => f.amount));
  const largest = prices.length ? Math.max(...prices) : 0;
  /** undefined: nothing found here, try the next kind of line; null: found, but unclear, so no answer at all. */
  const settle = (hits: Found[]): number | null | undefined => {
    if (!hits.length) return undefined;
    const n = one(hits.map((h) => h.amount));
    if (n === null) return null;
    if (n < largest) return undefined;
    // read with confidence, or the same as the largest confident price on the bill
    return hits.some((h) => h.sure) || n === largest ? n : undefined;
  };

  for (const label of TOTAL_LABELS) {
    const hits: Found[] = [];
    lines.forEach((line, i) => {
      const text = lineText(line);
      if (!label.test(text) || NOT_TOTAL.test(text)) return;
      const here = amountsOn(line, BACKED_UP_CONFIDENCE);
      const next = lines[i + 1];
      const found = here.length ? here : next && !TOTAL_LABELS.some((l) => l.test(lineText(next))) ? amountsOn(next, BACKED_UP_CONFIDENCE) : [];
      // the amount is the last number on a total line: "Total 3 items 450.00"
      if (found.length) hits.push(last(found));
    });
    const n = settle(hits);
    if (n !== undefined) return n;
  }

  const paid = settle(lines.flatMap((line) => {
    const text = lineText(line);
    if (!PAID_BY.test(text) || NOT_TOTAL.test(text)) return [];
    const found = amountsOn(line, BACKED_UP_CONFIDENCE);
    return found.length ? [last(found)] : [];
  }));
  if (paid !== undefined) return paid;

  const compared = lines.filter((l) => !NOT_COMPARED.test(lineText(l)));
  const all = compared.flatMap((line) => amountsOn(line).filter((f) => f.priced || f.money).map((f) => ({ ...f, height: line.height })));
  const money = all.filter((f) => f.money);
  if (!money.length) return null;
  const tallest = Math.max(...money.map((m) => m.height));
  const top = money.filter((m) => m.height >= tallest * 0.9);
  // The big number has to stand out from every other price on the page, or it is one price of many: a
  // receipt, where something misread as money (Q=5.000 as §=5.000) is no bigger than the lines around it.
  const others = all.filter((f) => !top.includes(f));
  if (others.length && Math.max(...others.map((f) => f.height)) > tallest / 1.4) return null;
  return settle(top) ?? null;
}
