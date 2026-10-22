/**
 * From what a rule (or the model) read to a draft's proposal: which payment method, which
 * category, a clean note, the amount in the ledger's currency. Pure, so the sync action and
 * tests share it.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { normNote } from "../categoryLint";
import { toMinor } from "../money";
import { MONTH_SHORT, diffDays, parts } from "../dates";
import type { Confidence } from "../tidyAi";
import type { TxType } from "../ops";
import { senderDomain, type Channel, type Parsed } from "./mail";
import { sourceLabel } from "./rules";

export type Proposal = Doc<"drafts">["proposal"];
export type AccountHint = NonNullable<Proposal["accountHint"]>;

/** What resolving needs from the user's data. `accountMap` is the connection's learned "domain|last4" → method. */
export type ResolveCtx = {
  accounts: Doc<"accounts">[];
  categories: Doc<"categories">[];
  transactions: Doc<"transactions">[];
  settings: Pick<Doc<"settings">, "mainCurrency" | "decimals">;
  currencies: Pick<Doc<"currencies">, "code" | "rate" | "decimals">[];
  accountMap: Record<string, Id<"accounts">>;
};

const usable = (a: Doc<"accounts">) => !a.deletedAt && !a.archivedAt;
const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && normNote(a) === normNote(b);
const nameHas = (name: string, bank: string) => normNote(name).includes(normNote(bank));

/** The key `accountMap` learns under: the sender's domain and the card or account digits. */
export function accountMapKey(from: string, last4: string | undefined): string | null {
  const domain = senderDomain(from);
  return domain && last4 ? `${domain}|${last4}` : null;
}

/**
 * The payment method a mail is about, by the first of: the learned map · a card or bank account
 * with those last 4 digits (the card first when the mail is about a card) · a bank account named like the bank (through the UPI method linked to it when the
 * payment went over UPI) · nothing, and the row asks the user to pick.
 */
export function resolveAccount(hint: AccountHint, from: string, ctx: Pick<ResolveCtx, "accounts" | "accountMap">): Id<"accounts"> | undefined {
  const live = ctx.accounts.filter(usable);
  const key = accountMapKey(from, hint.last4);
  const learned = key ? ctx.accountMap[key] : undefined;
  if (learned && live.some((a) => a._id === learned)) return learned;
  if (hint.last4) {
    const card = live.find((a) => (a.kind === "card" || a.kind === "debitCard") && a.last4 === hint.last4);
    const bank = live.find((a) => a.kind === "bank" && a.last4 === hint.last4);
    const first = hint.channel === "card" || !bank ? card ?? bank : bank;
    if (first?.kind === "bank" && hint.channel === "upi") {
      const upi = live.find((a) => a.kind === "upi" && a.linkedAccountId === first._id);
      if (upi) return upi._id;
    }
    if (first) return first._id;
  }
  if (hint.bankName) {
    const bank = live.find((a) => a.kind === "bank" && (sameName(a.bankName, hint.bankName) || nameHas(a.name, hint.bankName!)))
      ?? live.find((a) => a.kind !== "card" && a.kind !== "debitCard" && nameHas(a.name, hint.bankName!));
    if (bank) {
      if (hint.channel === "upi") {
        const upi = live.find((a) => a.kind === "upi" && a.linkedAccountId === bank._id);
        if (upi) return upi._id;
      }
      return bank._id;
    }
  }
  return undefined;
}

/** The credit card a mail names: by the learned map or the digits, else the only card of that bank. */
function resolveCard(hint: AccountHint, from: string, ctx: Pick<ResolveCtx, "accounts" | "accountMap">): Doc<"accounts"> | undefined {
  const cards = ctx.accounts.filter((a) => usable(a) && a.kind === "card");
  const byDigits = resolveAccount({ last4: hint.last4, channel: "card" }, from, ctx);
  const card = cards.find((a) => a._id === byDigits);
  if (card) return card;
  const ofBank = hint.bankName ? cards.filter((a) => sameName(a.bankName, hint.bankName) || nameHas(a.name, hint.bankName!)) : [];
  return ofBank.length === 1 ? ofBank[0] : undefined;
}

/** How far back a refund looks for the purchase it returns. */
const REFUND_WINDOW_DAYS = 60;

/**
 * The purchase a refund is most likely for: the latest expense with the same merchant, at least as
 * big as the refund, in the 60 days up to it. `amount` is the refund, in minor units, positive.
 */
export function refundOf(note: string, amount: number, date: string, ctx: Pick<ResolveCtx, "transactions">): Doc<"transactions"> | undefined {
  const key = normNote(note);
  if (!key) return undefined;
  let best: Doc<"transactions"> | undefined;
  for (const t of ctx.transactions) {
    if (t.type !== "expense" || t.amount < amount || t.date > date || diffDays(t.date, date) > REFUND_WINDOW_DAYS || normNote(t.note) !== key) continue;
    if (!best || t.date > best.date || (t.date === best.date && t._creationTime > best._creationTime)) best = t;
  }
  return best;
}

/** The category of the user's most recent entry with the same note, as the entry form's autocomplete would fill in. */
export function resolveCategory(note: string, type: "income" | "expense", ctx: Pick<ResolveCtx, "transactions" | "categories">): Pick<Proposal, "categoryId" | "subcategoryId"> {
  const key = normNote(note);
  if (!key) return {};
  const live = new Set(ctx.categories.filter((c) => !c.deletedAt).map((c) => c._id));
  let best: Doc<"transactions"> | undefined;
  for (const t of ctx.transactions) {
    if (t.type !== type || !t.categoryId || !live.has(t.categoryId) || normNote(t.note) !== key) continue;
    if (!best || t.date > best.date || (t.date === best.date && t._creationTime > best._creationTime)) best = t;
  }
  if (!best) return {};
  return { categoryId: best.categoryId, subcategoryId: best.subcategoryId && live.has(best.subcategoryId) ? best.subcategoryId : undefined };
}

/** Merchant strings as the user would write them, keyed by what a bank or VPA calls them. */
const KNOWN: [RegExp, string][] = [
  [/\bswiggy\b/i, "Swiggy"], [/\bzomato\b/i, "Zomato"], [/\b(amazon|amzn)\b/i, "Amazon"], [/\bflipkart\b/i, "Flipkart"], [/\buber\b/i, "Uber"], [/\bola\b|\bolacabs\b/i, "Ola"],
  [/\bnetflix\b/i, "Netflix"], [/\bspotify\b/i, "Spotify"], [/\bapple\b|\bitunes\b/i, "Apple"], [/\bgoogle ?play\b/i, "Google Play"], [/\byoutube\b/i, "YouTube"],
  [/\bblinkit\b|\bgrofers\b/i, "Blinkit"], [/\bzepto\b/i, "Zepto"], [/\bbigbasket\b/i, "BigBasket"], [/\bmyntra\b/i, "Myntra"], [/\birctc\b/i, "IRCTC"], [/\bjio\b/i, "Jio"], [/\bairtel\b/i, "Airtel"],
  [/\bdmart\b/i, "DMart"], [/\bstarbucks\b/i, "Starbucks"], [/\bmcdonald/i, "McDonald's"], [/\bdominos\b|\bdomino's\b/i, "Domino's"], [/\bphonepe\b/i, "PhonePe"], [/\bpaytm\b/i, "Paytm"],
  [/\bbescom\b/i, "BESCOM"], [/\bdunzo\b/i, "Dunzo"], [/\brapido\b/i, "Rapido"], [/\bbookmyshow\b/i, "BookMyShow"], [/\bmakemytrip\b/i, "MakeMyTrip"],
];
/** Gateway and aggregator prefixes a card statement puts in front of the shop. */
const PREFIXES = /^(?:(?:payu|razorpay|raz|razor|paytm|phonepe|gpay|billdesk|cca|ccavenue|eazypay|instamojo|cashfree|amazon pay|amzn pay|pos|ecom|www)\s?[*\-_:/]\s*)+/i;
/** City codes, country tags and company suffixes at the end. */
const SUFFIXES = /(?:\s*[*\-_/]\s*|\s+)(?:blr|bangalore|bengaluru|mum|mumbai|del|delhi|new delhi|hyd|hyderabad|che|chennai|pun|pune|kol|kolkata|gur|gurgaon|gurugram|noi|noida|in|ind|india|pvt\.?\s*ltd\.?|private limited|ltd\.?|limited|llp|inc\.?)\s*$/i;
/** Trailing order ids: "ORDER 8812", "#198812345678", "OD3312..." */
const ORDER_ID = /\s*(?:[#*\-_/]\s*)?(?:order|ord|od|txn|ref|inv|invoice)?\s*[#:]?\s*[A-Za-z]{0,3}\d[\dA-Za-z-]{3,}\s*$/i;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'(-])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());

/** "SWIGGY*ORDER 8812-BLR" → "Swiggy", "AMAZON PAY INDIA" → "Amazon", "petrol.pump@okaxis" → "Petrol Pump", "VIKRAM ENTERPRISES PVT LTD" → "Vikram Enterprises". */
export function cleanMerchant(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  let handle = false;
  if (/^[a-z0-9.\-_]+@[a-z]+$/i.test(s)) {
    s = s.split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, " ");
    handle = true;
  }
  s = s.replace(PREFIXES, "");
  const known = KNOWN.find(([re]) => re.test(s));
  if (known) return known[1];
  for (let i = 0; i < 3; i++) s = s.replace(ORDER_ID, "").replace(SUFFIXES, "");
  s = s.replace(/[*_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return raw.trim();
  // bank alerts shout; a name that is mostly capitals is written as the user would write it
  const letters = s.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return handle || (letters.length > 0 && upper / letters.length >= 0.7) ? titleCase(s) : s;
}

/** The provenance line under the amount: "HDFC alert · card ending 4521", "Swiggy receipt · UPI". */
function describe(parsed: Parsed): string {
  const what = sourceLabel(parsed);
  const via = parsed.last4 ? `${parsed.channel === "card" || !parsed.channel ? "card" : "a/c"} ending ${parsed.last4}` : parsed.channel === "upi" ? "UPI" : parsed.channel === "netbanking" ? "bank transfer" : parsed.channel === "wallet" ? "wallet" : "";
  const bits = [what, via, parsed.item].filter(Boolean);
  return bits.join(" · ");
}

export type Resolved = { proposal: Proposal; confidence: Confidence };

/**
 * A draft's proposal from a parsed mail. Debits are expenses, credits income, refunds money back
 * on an expense (a negative expense in the purchase's category, see refundOf), and a
 * credit card payment a transfer when both the card and the bank it was paid from resolve
 * (otherwise an expense that says what it looks like). Mail in another currency keeps its
 * amount as the sub-amount and converts with the user's saved rate, at medium confidence.
 */
export function resolveParsed(parsed: Parsed, mail: { from: string }, ctx: ResolveCtx): Resolved {
  const hint: AccountHint = { bankName: parsed.bankName, last4: parsed.last4, channel: parsed.channel as Channel | undefined };
  const hintClean = Object.fromEntries(Object.entries(hint).filter(([, v]) => v !== undefined)) as AccountHint;
  let confidence: Confidence = parsed.dateSource === "mail" ? "high" : "medium";
  const note = cleanMerchant(parsed.merchantRaw) || parsed.merchantRaw.trim();
  const descriptionBits = [describe(parsed)];

  // amount in the main currency
  const main = ctx.settings.mainCurrency.toUpperCase();
  let amount = toMinor(parsed.amount, ctx.settings.decimals);
  let sub: Pick<Proposal, "subAmount" | "subCurrency"> = {};
  if (parsed.currency.toUpperCase() !== main) {
    const cur = ctx.currencies.find((c) => c.code.toUpperCase() === parsed.currency.toUpperCase());
    if (cur && cur.rate > 0) {
      amount = toMinor(parsed.amount / cur.rate, ctx.settings.decimals);
      sub = { subAmount: toMinor(parsed.amount, cur.decimals), subCurrency: cur.code };
      descriptionBits.push(`converted at the saved ${cur.code} rate`);
      confidence = "medium";
    } else {
      amount = 0;
      sub = { subAmount: toMinor(parsed.amount, 2), subCurrency: parsed.currency.toUpperCase() };
      descriptionBits.push(`no ${parsed.currency.toUpperCase()} rate saved`);
      confidence = "low";
    }
  }

  const accountId = resolveAccount(hintClean, mail.from, ctx);
  const base = { date: parsed.date, time: parsed.time, amount, ...sub, note, accountHint: Object.keys(hintClean).length ? hintClean : undefined };

  if (parsed.type === "cardPayment") {
    // the mail names the card, not the account it was paid from: only a card is a match, and its billing account is the source
    const card = resolveCard(hintClean, mail.from, ctx);
    const bank = card?.billingAccountId ? ctx.accounts.find((a) => a._id === card.billingAccountId && usable(a)) : undefined;
    if (card && bank) {
      return { confidence, proposal: { ...base, type: "transfer", accountId: bank._id, toAccountId: card._id, note: note || "Card payment", description: descriptionBits.join(" · ") } };
    }
    descriptionBits.push("looks like a credit card payment");
    return {
      confidence: confidence === "high" ? "medium" : confidence,
      proposal: { ...base, type: "expense", accountId: card?._id, note: note || "Card payment", description: descriptionBits.join(" · "), ...resolveCategory(note, "expense", ctx) },
    };
  }

  if (parsed.type === "refund") {
    // money back nets against what it was spent on, instead of counting as income
    const orig = amount > 0 ? refundOf(note, amount, parsed.date, ctx) : undefined;
    descriptionBits.push(orig ? `refund of ${parts(orig.date).d} ${MONTH_SHORT[parts(orig.date).m - 1]} ${orig.note}` : "refund");
    const live = (id?: Id<"categories">) => !!id && ctx.categories.some((c) => c._id === id && !c.deletedAt);
    const cat = orig && live(orig.categoryId) ? { categoryId: orig.categoryId, subcategoryId: live(orig.subcategoryId) ? orig.subcategoryId : undefined } : resolveCategory(note, "expense", ctx);
    return {
      confidence,
      proposal: { ...base, amount: -amount, subAmount: sub.subAmount !== undefined ? -sub.subAmount : undefined, type: "expense", accountId, description: descriptionBits.join(" · "), ...cat },
    };
  }
  const type: TxType = parsed.type === "debit" ? "expense" : "income";
  return { confidence, proposal: { ...base, type, accountId, description: descriptionBits.join(" · "), ...resolveCategory(note, type, ctx) } };
}
