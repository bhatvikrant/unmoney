/**
 * The model half of the Gmail sync: what Claude is asked about the mail no rule could read, the
 * shape of its answer, and the checks that answer must pass before it becomes a draft. Pure, so
 * the sync action and the tests share the same rules. Ids are short ("e3", "a2", "m7") to save
 * tokens and so the model can only point at things the user actually has.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { addDays } from "../dates";
import type { Confidence } from "../tidyAi";
import { isoDateIn, type Channel, type Mail, type Parsed, type ParsedKind } from "./mail";

export { AI_MODEL } from "../tidyAi";
/** Mails per model call. */
export const AI_BATCH = 10;
/** Model calls per user per calendar month; rule-parsed mail keeps flowing past it. */
export const AI_MONTHLY_CAP = 300;
/** Characters of a mail's text the model sees. */
export const AI_MAX_TEXT = 2500;
/** The largest amount the model may report, in major units: anything above is a mis-read. */
const MAX_AMOUNT = 10_000_000;
const MAX_MERCHANT = 60;

export type AiContext = {
  currency: string;
  categories: { id: string; name: string; type: "income" | "expense"; parent?: string }[];
  methods: { id: string; name: string; kind: string; bank?: string; last4?: string }[];
};
export type AiMail = { id: string; from: string; subject: string; received: string; text: string };
export type AiInput = { context: AiContext; mails: AiMail[] };
export type AiIds = { categories: Record<string, Id<"categories">>; methods: Record<string, Id<"accounts">>; mails: Record<string, string> };

type Snap = { categories: Doc<"categories">[]; accounts: Doc<"accounts">[]; mainCurrency: string };

/** What the model sees: the user's vocabulary (categories, payment methods) and the mails, all with short ids. */
export function buildAiInput(mails: Mail[], snap: Snap, timeZone = "Asia/Kolkata"): { input: AiInput; ids: AiIds } {
  const ids: AiIds = { categories: {}, methods: {}, mails: {} };
  const shortCat = new Map<string, string>();
  const counters = { expense: 0, income: 0 };
  const cats = snap.categories.filter((c) => !c.deletedAt && !c.archivedAt).sort((a, b) => a.order - b.order);
  for (const c of cats) {
    const short = `${c.type === "expense" ? "e" : "i"}${++counters[c.type]}`;
    ids.categories[short] = c._id;
    shortCat.set(c._id, short);
  }
  const categories = cats.map((c) => ({ id: shortCat.get(c._id)!, name: c.name, type: c.type, parent: c.parentId ? shortCat.get(c.parentId) : undefined }));
  const methods = snap.accounts.filter((a) => !a.deletedAt && !a.archivedAt && !a.hidden).sort((a, b) => a.order - b.order).map((a, i) => {
    const short = `a${i + 1}`;
    ids.methods[short] = a._id;
    return { id: short, name: a.name, kind: a.kind ?? "other", bank: a.bankName, last4: a.last4 };
  });
  const aiMails = mails.map((m, i) => {
    const short = `m${i + 1}`;
    ids.mails[short] = m.id;
    return { id: short, from: m.from, subject: m.subject, received: `${isoDateIn(m.receivedAt, timeZone)} (${timeZone})`, text: m.text.slice(0, AI_MAX_TEXT) };
  });
  return { input: { context: { currency: snap.mainCurrency, categories, methods }, mails: aiMails }, ids };
}

export const SYSTEM_PROMPT = `You read a person's emails and pick out completed money movements so they can be added to their expense tracker. You get their categories and payment methods (with short ids) and a batch of emails (with short ids).

For every email, answer with one object. Set isTransaction to false for anything that is not a completed movement of money belonging to this person: OTPs, promotions, statements, reminders, failed or declined payments, balance alerts, newsletters, or mail about someone else's money. Never invent an amount.

When it is a transaction:
- kind: "debit" for money the person spent or sent, "credit" for money they received (salary, interest, a transfer in), "cardPayment" when the mail says a payment was received towards a credit card bill, "refund" for money a shop or service returned.
- amount in major units as printed, currency as a 3-letter code.
- date as YYYY-MM-DD, the date of the movement if the mail gives one, else the received date.
- merchant: the shop, service or person on the other side, written the way a person would ("Swiggy", not "SWIGGY*ORDER 8812-BLR"). For a salary, the employer. Short.
- bankName and last4 when the mail names the bank, card or account; channel if it is clear.
- methodRef: the id of the payment method the money moved on, only when the mail's bank or last 4 digits match one. Otherwise leave it out.
- categoryRef: the id of the category that fits best, only among the given ones of the right type (expense for debit and refund, income for credit). Leave it out if none fits.
- confidence: "high" when amount, date and merchant are explicit; "medium" when something was inferred; "low" when unsure.
- reason: one short phrase.`;

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "isTransaction"],
        properties: {
          id: { type: "string" },
          isTransaction: { type: "boolean" },
          kind: { type: "string", enum: ["debit", "credit", "cardPayment", "refund"] },
          amount: { type: "number" },
          currency: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          merchant: { type: "string" },
          bankName: { type: "string" },
          last4: { type: "string" },
          channel: { type: "string", enum: ["upi", "card", "netbanking", "wallet"] },
          methodRef: { type: "string" },
          categoryRef: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

/** One mail the model read as a transaction, checked and with real ids where it pointed at any. */
export type AiRead = { mailId: string; parsed: Parsed; categoryId?: Id<"categories">; accountId?: Id<"accounts">; confidence: Confidence; reason: string };

const KINDS = new Set<ParsedKind>(["debit", "credit", "cardPayment", "refund"]);
const CHANNELS = new Set<Channel>(["upi", "card", "netbanking", "wallet"]);
const CONFIDENCES = new Set<Confidence>(["high", "medium", "low"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The model's answer, kept only where it checks out: a known mail, a positive sane amount, a
 * date within three days of when the mail arrived, refs that exist, a category of the right type.
 * Anything else is dropped (and counted, so the log can say so).
 */
export function validateAiResults(raw: unknown, mails: Mail[], ids: AiIds, categories: Doc<"categories">[], timeZone = "Asia/Kolkata"): { reads: AiRead[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map(mails.map((m) => [m.id, m]));
  const catType = new Map(categories.map((c) => [c._id as string, c.type]));
  const reads: AiRead[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const mailId = typeof r.id === "string" ? ids.mails[r.id] : undefined;
    const mail = mailId ? byId.get(mailId) : undefined;
    if (!mail || seen.has(mail.id)) continue;
    seen.add(mail.id);
    if (r.isTransaction !== true) continue;
    const kind = r.kind as ParsedKind;
    const amount = typeof r.amount === "number" ? r.amount : NaN;
    const currency = typeof r.currency === "string" ? r.currency.trim().toUpperCase() : "";
    const date = typeof r.date === "string" ? r.date.trim() : "";
    const received = isoDateIn(mail.receivedAt, timeZone);
    const merchant = typeof r.merchant === "string" ? r.merchant.trim().slice(0, MAX_MERCHANT) : "";
    if (!KINDS.has(kind) || !(amount > 0) || amount > MAX_AMOUNT || !/^[A-Z]{3}$/.test(currency) || !ISO.test(date) || !merchant) { dropped++; continue; }
    if (date < addDays(received, -3) || date > addDays(received, 3)) { dropped++; continue; }
    const type = kind === "debit" || kind === "refund" ? "expense" : kind === "cardPayment" ? undefined : "income";
    const categoryId = typeof r.categoryRef === "string" ? ids.categories[r.categoryRef] : undefined;
    const accountId = typeof r.methodRef === "string" ? ids.methods[r.methodRef] : undefined;
    const last4 = typeof r.last4 === "string" && /^\d{4}$/.test(r.last4.trim()) ? r.last4.trim() : undefined;
    const channel = CHANNELS.has(r.channel as Channel) ? (r.channel as Channel) : undefined;
    const time = typeof r.time === "string" && HHMM.test(r.time.trim()) ? r.time.trim() : undefined;
    const parsed: Parsed = {
      rule: "ai", type: kind, amount: Math.round(amount * 100) / 100, currency, date, dateSource: "mail", time,
      last4, bankName: typeof r.bankName === "string" && r.bankName.trim() ? r.bankName.trim().slice(0, 30) : undefined, channel, merchantRaw: merchant,
    };
    reads.push({
      mailId: mail.id,
      parsed,
      categoryId: categoryId && type && catType.get(categoryId) === type ? categoryId : undefined,
      accountId,
      confidence: CONFIDENCES.has(r.confidence as Confidence) ? (r.confidence as Confidence) : "low",
      reason: typeof r.reason === "string" ? r.reason.slice(0, 120) : "",
    });
  }
  return { reads, dropped };
}

export const lowerConfidence = (a: Confidence, b: Confidence): Confidence => {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] <= rank[b] ? a : b;
};
