/**
 * The Gmail search that narrows a mailbox to money mail before anything is fetched, and the
 * sender allowlist it is built from. Pure, so the sync and the settings page agree.
 */
import { senderAddress, senderDomain } from "./mail";

/** Senders a new connection starts with: Indian banks and cards, UPI apps, and the shops the rules know. One entry is an address or a domain. */
export const DEFAULT_SENDERS: string[] = [
  "hdfcbank.net", "hdfcbank.com", "icicibank.com", "axisbank.com", "sbi.co.in", "sbicard.com", "kotak.com", "kotakbank.com",
  "idfcfirstbank.com", "yesbank.in", "indusind.com", "federalbank.co.in",
  "phonepe.com", "paytm.com", "paytmmail.com", "payments-noreply@google.com", "npci.org.in",
  "amazon.in", "flipkart.com", "swiggy.in", "zomato.com", "uber.com", "olacabs.com",
  "apple.com", "netflix.com", "spotify.com", "googleplay-noreply@google.com",
];

/** Subject words that mark money mail from a sender not on the list. */
export const MONEY_SUBJECT_WORDS = ["debited", "credited", "transaction", "payment", "receipt", "invoice", "order", "spent", "UPI", "txn", "\"payment received\""];

export const LOOKBACKS = [7, 30, 90] as const;
export type Lookback = (typeof LOOKBACKS)[number];

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
export function buildQuery(opts: { senders: string[]; scanPurchases: boolean; afterSeconds: number }): string {
  const parts: string[] = [];
  const senders = opts.senders.map(normaliseSender).filter(Boolean);
  if (senders.length) parts.push(`from:(${senders.join(" OR ")})`);
  if (opts.scanPurchases) parts.push("category:purchases");
  parts.push(`subject:(${MONEY_SUBJECT_WORDS.join(" OR ")})`);
  return `after:${Math.max(0, Math.floor(opts.afterSeconds))} (${parts.join(" OR ")})`;
}
