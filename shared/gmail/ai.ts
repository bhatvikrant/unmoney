/**
 * The model half of the Gmail sync: what Claude is asked about the mail no rule could read, the
 * shape of its answer, and the checks that answer must pass before it becomes a draft. Pure, so
 * the sync action and the tests share the same rules. Ids are short ("e3", "a2", "m7") to save
 * tokens and so the model can only point at things the user actually has.
 */
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { addDays, diffDays } from "../dates";
import type { Confidence } from "../tidyAi";
import { isoDateIn, oneLine, senderAddress, type Channel, type Mail, type Parsed, type ParsedKind } from "./mail";

/** The model and effort for reading mail, set here so this feature's can change on its own (priced in shared/aiCost.ts). */
export const AI_MODEL = "claude-haiku-5-5";
export const AI_EFFORT = "low";
/** Mails per model call. */
export const AI_BATCH = 10;
/** Model calls per user per calendar month; rule-parsed mail keeps flowing past it. */
export const AI_MONTHLY_CAP = 300;
/** Characters of a mail's text the model sees. */
export const AI_MAX_TEXT = 2500;
/** The largest amount the model may report, in major units: anything above is a mis-read. */
const MAX_AMOUNT = 10_000_000;
const MAX_MERCHANT = 60;
/** Characters of the one-line summary kept on a draft; the prompt and the schema ask for the same. */
export const MAX_SUMMARY = 80;

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

/**
 * The user message, in two blocks: what stays the same from one batch to the next (the person's
 * categories and methods) first and marked for caching, then the mails. Reading back a year sends
 * many batches minutes apart, and each after the first reads the system prompt and that first
 * block from the cache at a tenth of the price. Below the model's minimum it just is not cached.
 * `reuse` is whether another batch follows within minutes: writing the cache costs a quarter more
 * than not, so a lone batch (most hourly checks) does not.
 */
export function aiContent(input: AiInput, reuse: boolean): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  return [
    { type: "text", text: JSON.stringify(input.context), ...(reuse ? { cache_control: { type: "ephemeral" as const } } : {}) },
    { type: "text", text: JSON.stringify(input.mails) },
  ];
}

export const SYSTEM_PROMPT = `You read a person's emails and pick out completed money movements so they can be added to their expense tracker. You get two JSON blocks: first their currency, categories and payment methods (with short ids), then a batch of emails (with short ids).

For every email, answer with one object. Set isTransaction to false for anything that is not a completed movement of money belonging to this person: OTPs, promotions, statements, reminders, failed or declined payments, balance alerts, newsletters, or mail about someone else's money. Never invent an amount.

Some mail names an amount and is still not a payment. When it is one of these, set isTransaction to false and clutter to its kind:
- "mandate": an autopay, mandate, standing instruction or subscription set up, changed or cancelled, with no money taken yet.
- "declined": a payment that was declined, failed, cancelled or reversed before it went through.
- "emi": a purchase converted to EMI, or an EMI plan or schedule, rather than an instalment actually charged.
- "statement": a statement, bill or invoice generated, or an amount due, with nothing paid yet.

When it is a transaction:
- kind: "debit" for money the person spent or sent, "credit" for money they received (salary, interest, a transfer in), "cardPayment" when the mail says a payment was received towards a credit card bill, "refund" for money a shop or service returned.
- amount in major units as printed, currency as a 3-letter code.
- date as YYYY-MM-DD, the date of the movement if the mail gives one, else the received date.
- merchant: the shop, service or person on the other side, written the way a person would ("Swiggy", not "SWIGGY*ORDER 8812-BLR"). For a salary, the employer. Short.
- bankName and last4 when the mail names the bank, card or account; channel if it is clear.
- methodRef: the id of the payment method the money moved on, only when the mail's bank or last 4 digits match one. Otherwise leave it out.
- categoryRef: the id of the category that fits best, only among the given ones of the right type (expense for debit and refund, income for credit). Leave it out if none fits.
- confidence: "high" when amount, date and merchant are explicit; "medium" when something was inferred; "low" when unsure.
- summary: what happened, in plain words, on one line of at most ${MAX_SUMMARY} characters ("Card ending 1234 charged for a Zomato order").
- sameAs: only when another email in this batch, from a different sender, is about the very same payment (a shop's order confirmation and the bank's alert for it): that email's id, on one of the two.`;

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
          clutter: { type: "string", enum: ["mandate", "declined", "emi", "statement"] },
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
          summary: { type: "string", description: `One line, at most ${MAX_SUMMARY} characters.` },
          sameAs: { type: "string" },
        },
      },
    },
  },
} as const;

/** Mail that names an amount and is not a payment, as the model sorts it: the check's log counts them. */
export type Clutter = "mandate" | "declined" | "emi" | "statement";
export const CLUTTER_LABEL: Record<Clutter, string> = { mandate: "autopay set-up", declined: "declined or reversed", emi: "EMI notice", statement: "bill or statement" };

/**
 * One mail the model read as a transaction, checked and with real ids where it pointed at any.
 * `summary` is its one line for the draft's row; `sameAs` the Gmail id of another mail in the
 * batch it is the same payment as, kept only when the two read alike (see validateAiResults).
 */
export type AiRead = { mailId: string; parsed: Parsed; categoryId?: Id<"categories">; accountId?: Id<"accounts">; confidence: Confidence; summary?: string; sameAs?: string };

const CLUTTERS = new Set<Clutter>(["mandate", "declined", "emi", "statement"]);
const KINDS = new Set<ParsedKind>(["debit", "credit", "cardPayment", "refund"]);
const CHANNELS = new Set<Channel>(["upi", "card", "netbanking", "wallet"]);
const CONFIDENCES = new Set<Confidence>(["high", "medium", "low"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The model's answer, kept only where it checks out: a known mail, a positive sane amount, a
 * date within three days of when the mail arrived, refs that exist, a category of the right type.
 * Anything else is dropped (and counted, so the log can say so), as is an answer that calls a mail
 * both a transaction and clutter. Mail set aside as clutter is counted by kind. Two mails are the
 * same payment only when the model says so and they come from different senders with the same
 * kind, amount and currency, dated within a day: otherwise each stays a draft of its own, so a
 * wrong "same" never loses a payment.
 */
export function validateAiResults(raw: unknown, mails: Mail[], ids: AiIds, categories: Doc<"categories">[], timeZone = "Asia/Kolkata"): { reads: AiRead[]; dropped: number; clutter: Partial<Record<Clutter, number>> } {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map(mails.map((m) => [m.id, m]));
  const catType = new Map(categories.map((c) => [c._id as string, c.type]));
  const reads: AiRead[] = [];
  const seen = new Set<string>();
  const clutter: Partial<Record<Clutter, number>> = {};
  const sameRefs = new Map<AiRead, string>();
  let dropped = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const mailId = typeof r.id === "string" ? ids.mails[r.id] : undefined;
    const mail = mailId ? byId.get(mailId) : undefined;
    if (!mail || seen.has(mail.id)) continue;
    seen.add(mail.id);
    const junk = CLUTTERS.has(r.clutter as Clutter) ? (r.clutter as Clutter) : undefined;
    if (r.isTransaction !== true) {
      if (junk) clutter[junk] = (clutter[junk] ?? 0) + 1;
      continue;
    }
    if (junk) { dropped++; continue; }
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
    const summary = typeof r.summary === "string" ? oneLine(r.summary).slice(0, MAX_SUMMARY) : "";
    const read: AiRead = {
      mailId: mail.id,
      parsed,
      categoryId: categoryId && type && catType.get(categoryId) === type ? categoryId : undefined,
      accountId,
      confidence: CONFIDENCES.has(r.confidence as Confidence) ? (r.confidence as Confidence) : "low",
      ...(summary ? { summary } : {}),
    };
    reads.push(read);
    if (typeof r.sameAs === "string") sameRefs.set(read, r.sameAs);
  }
  const byMail = new Map(reads.map((r) => [r.mailId, r]));
  for (const [read, ref] of sameRefs) {
    const other = byMail.get(ids.mails[ref]);
    if (!other || other === read) continue;
    const a = read.parsed, b = other.parsed;
    if (a.type !== b.type || a.amount !== b.amount || a.currency !== b.currency || Math.abs(diffDays(a.date, b.date)) > 1) continue;
    // one sender tells of a payment once: two alike from it are two payments (shared/gmail/dedup.ts samePayment)
    if (senderAddress(byId.get(read.mailId)!.from) === senderAddress(byId.get(other.mailId)!.from)) continue;
    read.sameAs = other.mailId;
  }
  return { reads, dropped, clutter };
}

export const lowerConfidence = (a: Confidence, b: Confidence): Confidence => {
  const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
  return rank[a] <= rank[b] ? a : b;
};
