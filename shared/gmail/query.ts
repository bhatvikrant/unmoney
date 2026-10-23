/**
 * The Gmail search that narrows a mailbox to money mail before anything is fetched, and the
 * sender allowlist it is built from. Pure, so the sync and the settings page agree.
 */
import { senderAddress, senderDomain } from "./mail";

/** Named groups of senders the settings page adds or removes in one go. One entry is an address or a domain. */
export const SENDER_PRESETS: { id: string; name: string; senders: string[] }[] = [
  // each bank's old domain and its RBI .bank.in one (rules.ts reads mail from any .bank.in sender)
  { id: "banks", name: "Indian banks", senders: [
    "hdfcbank.net", "hdfcbank.com", "hdfc.bank.in", "icicibank.com", "icici.bank.in", "axisbank.com", "axis.bank.in",
    "sbi.co.in", "sbi.bank.in", "kotak.com", "kotakbank.com", "kotak.bank.in", "idfcfirstbank.com", "idfcfirst.bank.in", "yesbank.in", "yes.bank.in",
    "indusind.com", "indusind.bank.in", "federalbank.co.in", "federal.bank.in", "hsbc.bank.in", "hsbc.co.in",
    "pnb.co.in", "pnb.bank.in", "bankofbaroda.co.in", "bankofbaroda.bank.in", "canarabank.com", "canarabank.bank.in",
    "unionbankofindia.co.in", "unionbankofindia.bank.in", "aubank.in", "au.bank.in", "rblbank.com", "rbl.bank.in", "idbi.bank.in", "sbmbank.co.in",
  ] },
  { id: "cards", name: "Credit cards", senders: ["sbicard.com"] },
  { id: "upi", name: "UPI apps", senders: ["phonepe.com", "paytm.com", "paytmmail.com", "payments-noreply@google.com", "npci.org.in"] },
  { id: "shops", name: "Shopping and food", senders: ["amazon.in", "flipkart.com", "swiggy.in", "zomato.com"] },
  { id: "rides", name: "Rides", senders: ["uber.com", "olacabs.com"] },
  { id: "subscriptions", name: "Subscriptions", senders: ["apple.com", "netflix.com", "spotify.com", "googleplay-noreply@google.com"] },
];

/** Senders a new connection starts with: every preset. */
export const DEFAULT_SENDERS: string[] = SENDER_PRESETS.flatMap((p) => p.senders);

/**
 * A connection's stored senders with the defaults added since it was made appended at the end.
 * A default already on the list, or covered by one of its domains, is not added twice.
 */
export function withNewDefaults(senders: string[]): string[] {
  const missing = DEFAULT_SENDERS.filter((d) => !senders.includes(d) && !matchesSender(d.includes("@") ? d : `x@${d}`, senders));
  return [...senders, ...missing];
}

/** Subject words that mark money mail from a sender not on the list. */
export const MONEY_SUBJECT_WORDS = ["debited", "credited", "deposited", "received", "salary", "refund", "transaction", "payment", "receipt", "invoice", "order", "spent", "UPI", "txn"];

/**
 * How far back each check reads, in days; 0 is "from now on": only mail that arrives after the
 * user chose it, read with the usual 30-day reach.
 */
export const LOOKBACKS = [0, 7, 30, 90] as const;
export type Lookback = (typeof LOOKBACKS)[number];

const DAY = 24 * 60 * 60 * 1000;
/** How far back a check reads when the look-back is "from now on". */
export const DEFAULT_SPAN_DAYS = 30;

/**
 * How far before the last check's end the next one starts: mail that arrived late is not missed,
 * and mail no rule could read yet is read once a rule learns it. What already has a draft is skipped.
 */
export function spanMs(lookbackDays: number): number {
  return (lookbackDays || DEFAULT_SPAN_DAYS) * DAY;
}

/** Mail received before this is never read: the moment the look-back was chosen, minus the look-back. */
export function readsFromFor(lookbackDays: number, chosenAt: number): number {
  return chosenAt - lookbackDays * DAY;
}

/**
 * Where a check's search starts, in ms: the look-back before the last check's end (or before now,
 * the first time), never before `readsFrom`, so "from now on" never reads older mail.
 */
export function windowStart(c: { lookbackDays: number; syncedUpTo?: number; readsFrom?: number }, now: number): number {
  const start = (c.syncedUpTo ?? now) - spanMs(c.lookbackDays);
  return c.readsFrom === undefined ? start : Math.max(start, c.readsFrom);
}

/** A sender entry as stored: trimmed, lower case, without a display name or angle brackets. */
export function normaliseSender(entry: string): string {
  const s = entry.trim().toLowerCase().replace(/^<|>$/g, "").replace(/^@/, "");
  return s.includes("@") ? senderAddress(s) : s;
}

/** Whether a From header is covered by the allowlist: its address exactly, or its domain or a parent domain. */
export function matchesSender(from: string, senders: string[]): boolean {
  const address = senderAddress(from);
  const domain = senderDomain(from);
  return senders.some((s) => (s.includes("@") ? s === address : domain === s || domain.endsWith(`.${s}`)));
}

/**
 * The query: mail newer than `afterSeconds` (a Unix time) from an allowlisted sender, or filed
 * by Gmail under Purchases when that is on, or with a money word in the subject. Spam and trash
 * are left out by Gmail itself.
 */
export function buildQuery(opts: { senders: string[]; scanPurchases: boolean; afterSeconds: number; muted?: string[] }): string {
  const parts: string[] = [];
  const senders = opts.senders.map(normaliseSender).filter(Boolean);
  if (senders.length) parts.push(`from:(${senders.join(" OR ")})`);
  if (opts.scanPurchases) parts.push("category:purchases");
  parts.push(`subject:(${MONEY_SUBJECT_WORDS.join(" OR ")})`);
  const muted = (opts.muted ?? []).map(normaliseSender).filter(Boolean);
  // senders the user muted are never fetched, whatever else matches
  return `after:${Math.max(0, Math.floor(opts.afterSeconds))} (${parts.join(" OR ")})${muted.length ? ` -from:(${muted.join(" OR ")})` : ""}`;
}
