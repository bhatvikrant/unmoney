/**
 * Regex parsers for the mail formats that make up most money mail: bank and card alerts, the
 * UPI apps' "payment successful" mails, and the receipts of common shops and subscriptions.
 * Each returns what it could read or null; `parseMail` picks the parser by sender. Written
 * from the anonymised samples in fixtures/, which pin every pattern here.
 */
import { AMOUNT_RE } from "./triage";
import { isoDateIn, oneLine, senderDomain, VPA_RE, type Channel, type Mail, type Parsed, type ParsedKind } from "./mail";

// ---------- pieces ----------

const CURRENCY_CODES: [RegExp, string][] = [
  [/^(rs\.?|inr|rupees|₹)$/i, "INR"], [/^(\$|usd)$/i, "USD"], [/^(€|eur)$/i, "EUR"], [/^(£|gbp)$/i, "GBP"], [/^aed$/i, "AED"], [/^sgd$/i, "SGD"],
];

export type Amount = { amount: number; currency: string; index: number; length: number };

function amountOf(m: RegExpMatchArray): Amount {
  const sym = m[1] ?? m[4];
  const num = m[2] ?? m[3];
  const currency = CURRENCY_CODES.find(([re]) => re.test(sym))?.[1] ?? "INR";
  return { amount: Number(num.replace(/,/g, "")), currency, index: m.index ?? 0, length: m[0].length };
}

/** Every amount in the text, in order. */
export function amounts(text: string): Amount[] {
  return [...text.matchAll(AMOUNT_RE)].map(amountOf).filter((a) => a.amount > 0);
}

/** The first amount after a label such as "Order Total", or null. */
function amountAfter(text: string, label: RegExp): Amount | null {
  const m = text.match(label);
  if (m === null || m.index === undefined) return null;
  const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const a = amounts(rest)[0];
  return a ? { ...a, index: a.index + m.index + m[0].length } : null;
}

/** A rupee total below this is a ₹1 deal or membership line, not what the order cost, whenever a larger total is also labelled. */
const MIN_INR_TOTAL = 5;

/**
 * A receipt's total: the amount after the first label in `labels` (best first) that the text
 * has. A total under ₹5 gives way to the best-ranked label whose amount is larger.
 */
export function receiptTotal(text: string, labels: RegExp[]): Amount | null {
  const found = labels.map((re) => amountAfter(text, re)).filter((a): a is Amount => a !== null);
  const tooSmall = (a: Amount) => a.currency === "INR" && a.amount < MIN_INR_TOTAL;
  return found.find((a) => !tooSmall(a)) ?? found[0] ?? null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const year4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

/**
 * The first date in the text, as YYYY-MM-DD: 18-10-26, 18/10/2026, 18-Oct-26, 18 Oct 2026,
 * Oct 18, 2026 or 2026-10-18. Day before month, as every Indian bank writes it.
 */
export function findDate(text: string): string | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/, (m) => iso(Number(m[1]), Number(m[2]), Number(m[3]))],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, (m) => iso(year4(m[3]), Number(m[2]), Number(m[1]))],
    [/\b(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]{3})[a-z]*\.?[-\s,]+(\d{4}|\d{2})\b/, (m) => (MONTHS[m[2].toLowerCase()] ? iso(year4(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) : null)],
    [/\b([A-Za-z]{3})[a-z]*\.?\s(\d{1,2})(?:st|nd|rd|th)?,?\s(\d{4})\b/, (m) => (MONTHS[m[1].toLowerCase()] ? iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])) : null)],
  ];
  let best: { at: number; date: string } | null = null;
  for (const [re, read] of patterns) {
    const m = text.match(re);
    if (m === null || m.index === undefined) continue;
    const date = read(m);
    if (date && (!best || m.index < best.at)) best = { at: m.index, date };
  }
  return best?.date ?? null;
}

/** The first clock time, as HH:MM (24h). */
export function findTime(text: string): string | null {
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s?(AM|PM|am|pm)?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** The last 4 digits of a masked card or account: "ending 4521", "XX1234", "••1234", "XXXXX112233", "Credit Card-4521", "AC X7788". */
export function findLast4(text: string): string | undefined {
  const m = text.match(/\bending(?: in| with)?\s?(\d{4})\b/i)
    ?? text.match(/(?<![A-Za-z0-9])(?:[Xx*•·]+|\.{2,})\s?(\d{4,8})\b/)
    ?? text.match(/\b(?:Card|Account|A\/c)(?:\s[A-Za-z ]{0,20})?-(\d{4})\b/i);
  return m ? m[1].slice(-4) : undefined;
}

const BANK_NAMES: [RegExp, string][] = [
  [/\bHDFC\b/i, "HDFC"], [/\bICICI\b/i, "ICICI"], [/\bAxis\b/i, "Axis"], [/\b(SBI|State Bank)\b/i, "SBI"], [/\bKotak\b/i, "Kotak"], [/\bHSBC\b/i, "HSBC"],
  [/\bYes Bank\b/i, "Yes Bank"], [/\bIDFC\b/i, "IDFC First"], [/\bIndusInd\b/i, "IndusInd"], [/\bFederal\b/i, "Federal"], [/\bPNB\b/i, "PNB"], [/\bCanara\b/i, "Canara"], [/\bBank of Baroda\b/i, "Bank of Baroda"],
];

/** A bank named in the text, as the user would print it on a card. */
export function findBankName(text: string): string | undefined {
  return BANK_NAMES.find(([re]) => re.test(text))?.[1];
}

function channelOf(text: string): Channel | undefined {
  if (/\b(UPI|VPA)\b/i.test(text) || VPA_RE.test(text)) return "upi";
  if (/\b(credit card|debit card|card ending|card no|card xx|card \*|visa|mastercard|rupay|amex)\b/i.test(text)) return "card";
  if (/\b(wallet|Ola Money|Amazon Pay balance|Paytm balance|Zomato Money)\b/i.test(text)) return "wallet";
  if (/\b(NEFT|IMPS|RTGS|net ?banking|transfer)\b/i.test(text)) return "netbanking";
  return undefined;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/[\s.,:;-]+$/, "").trim();
const OWN_ACCOUNT = /^(?:your\b|(?:savings |current )?(?:account|a\/c)\b)/i;
const isVpa = (s: string) => /^[a-z0-9.\-_]+@[a-z]+$/i.test(s);
const vpaIn = (text: string) => text.match(VPA_RE)?.[0];

type Base = Pick<Parsed, "date" | "dateSource" | "time">;
function dated(text: string, mail: Mail, timeZone?: string): Base {
  const date = findDate(text);
  const time = findTime(text) ?? undefined;
  return date ? { date, dateSource: "mail", time } : { date: isoDateIn(mail.receivedAt, timeZone), dateSource: "received", time };
}

// ---------- bank alerts ----------

type Bank = { name: string; rule: string; domains: string[]; merchant: RegExp[] };

/** The sentences every bank shares: a refund's shop, a card purchase's shop. */
const ANY_BANK: RegExp[] = [/\brefund (?:from|for|by)\s+(?<m>.+?)(?:\s+on\b|\.|$)/i, /\bat\s+(?<m>.+?)\s+on\s+\d/i];
/**
 * Where the counterparty sits in each bank's sentences, tried in order after ANY_BANK. The `m`
 * group is the merchant, `vpa` the UPI id; a match may carry either or both. Banks are moving
 * their mail to RBI's .bank.in domains, so each lists the old and the new.
 */
const BANKS: Bank[] = [
  { name: "HDFC", rule: "hdfc", domains: ["hdfcbank.net", "hdfcbank.com", "hdfc.bank.in"], merchant: [
    /\b(?:to|by) VPA\s+(?<vpa>\S+@\S+)\s+(?<m>.+?)\s+on\b/i, /\b(?:to|by) VPA\s+(?<vpa>\S+@\S+)/i, /\bby\s+(?<m>[^()]{1,60}?)\s*\((?:NEFT|IMPS|RTGS)/i, /\bto\s+(?<m>[^()]{1,60}?)\s*\((?:NEFT|IMPS|RTGS)/i,
    /\bby\s+(?<m>.+?)\s+on\b/i, /\bto\s+(?<m>.+?)\s+on\b/i, /\bfrom\s+(?<m>.+?)\s+on\b/i,
  ] },
  { name: "ICICI", rule: "icici", domains: ["icicibank.com", "icicibank.net", "icici.bank.in"], merchant: [
    /\bInfo:\s*(?:IMPS|NEFT|UPI|RTGS)\/[A-Z0-9]+\/\d+\/(?<m>.+?)\.(?:\s|$)/i, /\bInfo:\s*(?<m>.+?)\.(?:\s|$)/i, /\bcredited to\s+(?<vpa>\S+@\S+)/i, /\bdebited from\s+(?<vpa>\S+@\S+)/i,
    /\bby\s+(?<m>.+?)(?:\s+on\b|\.|$)/i, /\btowards\s+(?<m>.+?)(?:\s+on\b|\.|$)/i,
  ] },
  { name: "Axis", rule: "axis", domains: ["axisbank.com", "axisbank.co.in", "axis.bank.in"], merchant: [
    // the axis.bank.in layout: "Transaction Info: UPI/P2A/529312345690/PRIYA MENON/…"
    /\bTransaction Info(?:rmation)?\s*[:-]?\s*(?<m>[^\s].*?)(?=\s+(?:If|Please|Not you|Call|Available|Avl|Regards|Thank|Always|Never|Warm|Disclaimer|This is|Do not|Reach)\b|\s{2,}|$)/i,
    /\bUPI\/P2[MA]\/\d+\/(?<m>[^/.]+?)(?:\.\s|\/|$)/i, /\b(?:NEFT|IMPS|RTGS)\/[A-Z0-9]+\/(?<m>[^/.]+?)(?:\.\s|\/|\s+If\b|$)/i, /\bInfo-\s*(?<m>.+?)(?:\.\s|$)/i, /\bby\s+(?<m>.+?)\s+on\b/i, /\bto\s+(?<m>.+?)\s+on\b/i, /\bfrom\s+(?<m>.+?)\s+on\b/i,
  ] },
  { name: "SBI", rule: "sbi", domains: ["sbi.co.in", "sbi.bank.in", "sbicard.com", "onlinesbi.sbi", "onlinesbi.com"], merchant: [
    /-\s*(?:transfer|trf)\s+(?:to|from)\s+(?<m>.+?)\s+Ref\b/i, /\bby\s+(?:transfer\s+)?from\s+(?<m>.+?)\s+Ref\b/i, /\bto\s+(?<vpa>\S+@\S+)/i, /\bto\s+(?<m>.+?)\s+on\b/i, /\bfrom\s+(?<m>.+?)\s+on\b/i,
  ] },
  { name: "Kotak", rule: "kotak", domains: ["kotak.com", "kotakbank.com", "kotak.bank.in"], merchant: [
    /\bto\s+(?<vpa>\S+@\S+)\s+on\b/i, /\bfrom\s+(?<vpa>\S+@\S+)\s+on\b/i, /\bto\s+(?<m>.+?)\s+on\b/i, /\bfrom\s+(?<m>.+?)\s+on\b/i,
  ] },
  // HSBC India writes from hsbc@hsbc.bank.in (older mail from hsbc.co.in);
  // card spends go through ANY_BANK's "at MERCHANT on 17-10-26"; "from your HSBC account" is the user's own side, never the counterparty
  { name: "HSBC", rule: "hsbc", domains: ["hsbc.bank.in", "hsbc.co.in", "mail.hsbc.co.in", "hsbc.com"], merchant: [
    /\bto\s+(?<vpa>[a-z0-9.\-_]+@[a-z]+)\b/i, /\b(?:to|from)\s+(?!your\b)(?<m>[^()]{1,60}?)\s*\((?:Ref|UPI|NEFT|IMPS|RTGS)\b/i,
    /\bto\s+(?!your\b)(?<m>.+?)\s+on\b/i, /\bfrom\s+(?!your\b)(?<m>.+?)\s+on\b/i, /\bby\s+(?!your\b)(?<m>.+?)\s+on\b/i,
  ] },
];

const CARD_PAYMENT = /\bpayment\b.{0,60}?\breceived\b.{0,60}?\bcard\b|\breceived\b.{0,40}?\btowards\b.{0,40}?\bcard\b/i;
const REFUND = /\b(refund|refunded|reversal|reversed|credited back)\b/i;
const CREDIT = /\b(credited|received|deposited|credit (?:of|by))\b/i;
/** Words that say money left the account. */
const DEBIT = /\b(debited|spent|sent|paid|withdrawn|charged)\b/i;
/** Words a debit alert uses without saying which way money went; a credit verb anywhere outranks them. */
const DEBIT_HINT = /\b(used for|using|transaction of|purchase of)\b/i;

/**
 * Which way the money went. When the mail has both a credit and a debit verb, the first one
 * says it: "credited to your A/c … paid via app" is money in, "A/c debited for Rs 100; PRIYA
 * credited" is money out.
 */
function kindOf(text: string): ParsedKind | null {
  if (CARD_PAYMENT.test(text)) return "cardPayment";
  if (REFUND.test(text)) return "refund";
  const credit = text.search(CREDIT);
  const debit = text.search(DEBIT);
  if (credit >= 0 && (debit < 0 || credit < debit)) return "credit";
  if (debit >= 0 || DEBIT_HINT.test(text)) return "debit";
  return null;
}

/** Rails and their codes in a "UPI/P2A/529312345690/PRIYA MENON/paid via app" line: never the name. */
const RAIL = /^(?:UPI|P2[AM]|NEFT|IMPS|RTGS|MB|BIL|INB|ACH|NACH|ECS|INF|TRF|CMS|POS|ATM|NA)$/i;
/** The counterparty's name in a slash-separated transaction line: the first part that is words, not a rail or a reference. */
function nameInInfo(info: string): string {
  if (!info.includes("/")) return info;
  const part = info.split("/").map((x) => x.trim()).find((x) => /[a-z]{2}/i.test(x) && !RAIL.test(x) && !/\d{4,}/.test(x));
  return part ?? info;
}

function merchantIn(text: string, patterns: RegExp[]): { merchantRaw: string; vpa?: string } {
  let vpa: string | undefined;
  let merchant: string | undefined;
  for (const re of [...ANY_BANK, ...patterns]) {
    const m = text.match(re);
    if (!m?.groups) continue;
    const gotVpa = tidy(m.groups.vpa ?? "");
    const got = tidy(nameInInfo(m.groups.m ?? ""));
    // "credited to your account **1234": the user's own side, not who paid
    if (!gotVpa && OWN_ACCOUNT.test(got)) continue;
    if (gotVpa && isVpa(gotVpa)) vpa ??= gotVpa;
    if (got && isVpa(got)) vpa ??= got;
    else if (got) merchant ??= got;
    // a UPI id is the counterparty; a later, looser pattern must not override it with a stray phrase
    if (merchant || vpa) break;
  }
  if (!merchant && vpa) merchant = vpa.split("@")[0];
  return { merchantRaw: merchant ?? "", vpa };
}

function bankAlert(mail: Mail, text: string, bank: Bank, timeZone?: string): Parsed | null {
  const amt = amounts(text)[0];
  const type = kindOf(text);
  if (!amt || !type) return null;
  const { merchantRaw, vpa } = merchantIn(text, bank.merchant);
  return {
    rule: bank.rule, type, amount: amt.amount, currency: amt.currency, ...dated(text, mail, timeZone),
    last4: findLast4(text), bankName: bank.name, channel: channelOf(text), merchantRaw: merchantRaw || (type === "cardPayment" ? `${bank.name} card payment` : bank.name), vpa,
  };
}

// ---------- UPI apps ----------

type UpiApp = { name: string; rule: string; domains: string[] };
const UPI_APPS: UpiApp[] = [
  { name: "Google Pay", rule: "google-pay", domains: ["google.com", "googlepay.com"] },
  { name: "PhonePe", rule: "phonepe", domains: ["phonepe.com"] },
  { name: "Paytm", rule: "paytm", domains: ["paytm.com", "paytmmail.com", "paytmbank.com"] },
  { name: "BHIM", rule: "bhim", domains: ["npci.org.in"] },
];

const AMT = String.raw`(?:(?:Rs\.?|INR|₹)\s?[\d,]+(?:\.\d{1,2})?)`;
/** Where a counterparty's name ends: a keyword, a UPI id, a number, punctuation or the end. */
const STOP = String.raw`(?=\s+(?:on|using|from|via|with|UPI|for|at|to|linked|Transaction|Txn|Order|Ref|Paid|Debited|Credited)\b|\s+[A-Za-z0-9.\-_]+@[A-Za-z]+\b|\s+\d|[.!,]|$)`;
/** "You paid ₹450 to Swiggy", "Paid to Zomato", "Sent ₹800 to Ravi", "You received ₹500 from Rahul", "Received from Rahul". */
const UPI_LINES: [RegExp, ParsedKind][] = [
  [new RegExp(String.raw`\b(?:you )?(?:paid|sent)\s+${AMT}\s+to\s+(.+?)${STOP}`, "i"), "debit"],
  [new RegExp(String.raw`\b(?:paid|sent)\s+to\s+(.+?)${STOP}`, "i"), "debit"],
  [new RegExp(String.raw`\b(?:you )?received\s+${AMT}\s+from\s+(.+?)${STOP}`, "i"), "credit"],
  [new RegExp(String.raw`\breceived\s+from\s+(.+?)${STOP}`, "i"), "credit"],
];
/** "Paid from HDFC Bank ••1234", "Debited from SBI ****2233", "linked to SBI ••2233", "HDFC Bank - 1234". */
const UPI_BANK = /\b(?:from|using|via|debited from|paid from|credited to|linked to)\s+([A-Za-z ]+?)\s*(?:Bank)?\s*(?:[•*Xx]{2,}\s?|-\s?|ending\s)(\d{4})\b/i;

/** The subject usually says it shortest ("You paid ₹450.00 to Swiggy"); the body is the fallback. */
function upiApp(mail: Mail, text: string, app: UpiApp, timeZone?: string): Parsed | null {
  const amt = amounts(text)[0] ?? amounts(oneLine(mail.subject))[0];
  if (!amt) return null;
  let type: ParsedKind | null = null;
  let merchantRaw = "";
  for (const source of [oneLine(mail.subject), text]) {
    for (const [re, kind] of UPI_LINES) {
      const m = source.match(re);
      if (!m) continue;
      type = kind;
      merchantRaw = tidy(m[1]);
      break;
    }
    if (type) break;
  }
  if (!type) return null;
  if (/\brefund\b/i.test(text)) type = "refund";
  const vpa = vpaIn(text);
  const bank = text.match(UPI_BANK);
  return {
    rule: app.rule, type, amount: amt.amount, currency: amt.currency, ...dated(text, mail, timeZone),
    last4: bank ? bank[2] : findLast4(text), bankName: findBankName(bank ? bank[1] : text), channel: "upi", merchantRaw, vpa,
  };
}

// ---------- receipts ----------

type Shop = { name: string; rule: string; domains: string[]; subject?: RegExp; total: RegExp[]; item?: RegExp };
const SHOPS: Shop[] = [
  { name: "Amazon", rule: "amazon", domains: ["amazon.in", "amazon.com"], total: [/\b(?:Order|Grand) Total:?/i, /\bTotal:?/i] },
  { name: "Flipkart", rule: "flipkart", domains: ["flipkart.com"], total: [/\bAmount Paid:?/i, /\bTotal(?: Amount)?:?/i] },
  { name: "Swiggy", rule: "swiggy", domains: ["swiggy.in", "swiggy.com"], total: [
    /\bGrand Total:?/i, /\b(?:Total|Amount) Paid:?/i, /\bOrder Total:?/i, /\bBill Total:?/i, /\bTo Pay:?/i, /\bTotal:?/i,
  ] },
  { name: "Zomato", rule: "zomato", domains: ["zomato.com"], total: [/\b(?:Total|Amount) Paid:?/i, /\bGrand Total:?/i, /\bTotal:?/i] },
  { name: "Uber", rule: "uber", domains: ["uber.com"], total: [/\bTotal:?/i] },
  { name: "Ola", rule: "ola", domains: ["olacabs.com", "olamoney.com"], total: [/\bTotal Fare:?/i, /\bTotal:?/i] },
  { name: "Apple", rule: "apple", domains: ["apple.com", "itunes.com"], total: [/\bTOTAL:?/, /\bTotal:?/i], item: /\bDATE:?\s+\d{1,2} [A-Za-z]{3} \d{4}\s+(.+?)\s+(?:Renews|Monthly|Yearly|Annual|₹|Rs|INR)/i },
  { name: "Google Play", rule: "google-play", domains: ["google.com"], subject: /Google Play/i, total: [/\bTotal:?/i], item: /\bItem\s+Price\s+(.+?)\s+(?:₹|Rs|INR)/i },
  { name: "Netflix", rule: "netflix", domains: ["netflix.com"], total: [/\bAmount:?/i, /\bTotal:?/i], item: /\bPlan:?\s+(.+?)(?:\s+(?:Amount|Total|₹|Rs|INR)|\.)/i },
  { name: "Spotify", rule: "spotify", domains: ["spotify.com"], total: [/\bTotal:?/i, /\bAmount:?/i], item: /\b(Spotify Premium(?: [A-Za-z]+)?)\b/ },
];

/** What a draft's provenance line calls the mail: "HDFC alert", "Google Pay", "Swiggy receipt". */
export function sourceLabel(parsed: Pick<Parsed, "rule" | "bankName" | "merchantRaw">): string {
  const bank = BANKS.find((b) => b.rule === parsed.rule);
  if (bank) return `${bank.name} alert`;
  const app = UPI_APPS.find((a) => a.rule === parsed.rule);
  if (app) return app.name;
  return `${parsed.merchantRaw} receipt`;
}

/** Whether a mail is a shop's receipt rather than a bank's or UPI app's alert (dedup folds the two together). */
export function isShopMail(mail: { from: string; subject: string }): boolean {
  const domain = senderDomain(mail.from);
  return SHOPS.some((s) => s.domains.some((d) => domain === d || domain.endsWith(`.${d}`)) && (!s.subject || s.subject.test(mail.subject)));
}

/** "ending in 4521", "Visa •••• 4521", "HDFC Bank Credit Card-4521", "Paid via UPI". */
function receipt(mail: Mail, text: string, shop: Shop, timeZone?: string): Parsed | null {
  const amt = receiptTotal(text, shop.total) ?? amounts(text)[0] ?? null;
  if (!amt) return null;
  const type: ParsedKind = /\brefund/i.test(mail.subject) || /\brefund (?:of|has been|is being|initiated|processed)\b/i.test(text) ? "refund" : "debit";
  const item = shop.item ? tidy(text.match(shop.item)?.[1] ?? "") || undefined : undefined;
  return {
    rule: shop.rule, type, amount: amt.amount, currency: amt.currency, ...dated(text, mail, timeZone),
    last4: findLast4(text), bankName: findBankName(text), channel: channelOf(text), merchantRaw: shop.name, item,
  };
}

// ---------- entry point ----------

const inDomains = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

/** The parser for this sender, applied. Null when no rule knows the sender or the mail did not read. A valid amount and type are required; the date falls back to when the mail arrived. */
export function parseMail(mail: Mail, opts: { timeZone?: string } = {}): Parsed | null {
  const domain = senderDomain(mail.from);
  const text = oneLine(mail.text);
  const shop = SHOPS.find((s) => inDomains(domain, s.domains) && (!s.subject || s.subject.test(mail.subject)));
  if (shop) return receipt(mail, text, shop, opts.timeZone);
  const app = UPI_APPS.find((a) => inDomains(domain, a.domains));
  if (app) return upiApp(mail, text, app, opts.timeZone);
  const bank = BANKS.find((b) => inDomains(domain, b.domains));
  if (bank) return bankAlert(mail, text, bank, opts.timeZone);
  return null;
}
