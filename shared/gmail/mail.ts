/**
 * What the Gmail sync hands the pure parsers: one mail, already fetched and reduced to text.
 * Bodies only ever exist inside the sync action; what the parsers return is all that is kept.
 */

export type Mail = {
  /** Gmail message id. */
  id: string;
  threadId: string;
  /** The From header as Gmail gives it: `HDFC Bank InstaAlerts <alerts@hdfcbank.net>`. */
  from: string;
  subject: string;
  /** When Gmail received it, ms since epoch. */
  receivedAt: number;
  /** The text/plain part, or the HTML part stripped to text, capped by the sync. */
  text: string;
};

export type Channel = "upi" | "card" | "netbanking" | "wallet";
/** debit: money out · credit: money in · cardPayment: a bill paid on a credit card · refund: money back from a shop. */
export type ParsedKind = "debit" | "credit" | "cardPayment" | "refund";

/** What a rule reads out of a mail. Amounts are in major units of `currency`; resolve.ts turns them into the ledger's minor units. */
export type Parsed = {
  /** Which parser matched: "hdfc", "upi-app", "amazon", ... */
  rule: string;
  type: ParsedKind;
  amount: number;
  /** ISO code: INR, USD, ... */
  currency: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Whether the date was in the mail or taken from when it arrived. */
  dateSource: "mail" | "received";
  /** HH:MM, when the mail carries a time. */
  time?: string;
  /** Last 4 digits of the card or account the mail names. */
  last4?: string;
  /** "HDFC", "ICICI", ... as printed on the user's cards. */
  bankName?: string;
  channel?: Channel;
  /** The merchant or counterparty as the mail wrote it; resolve.ts cleans it. */
  merchantRaw: string;
  /** The UPI id the money went to or came from. */
  vpa?: string;
  /** A receipt's product line ("iCloud+ 50GB", "YouTube Premium"). */
  item?: string;
};

/** The sender's domain, lower case: "alerts@hdfcbank.net" and "HDFC <alerts@hdfcbank.net>" both give "hdfcbank.net". */
export function senderDomain(from: string): string {
  const m = from.match(/@([A-Za-z0-9.-]+)/);
  return (m ? m[1] : "").toLowerCase();
}

/** The sender's address alone, lower case. */
export function senderAddress(from: string): string {
  const m = from.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
  return (m ? m[0] : from).trim().toLowerCase();
}

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. Bank mail is Indian time until the sync knows better. */
export function isoDateIn(ms: number, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Whitespace collapsed to single spaces, so patterns can span the line breaks of HTML turned into text. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A UPI id: "swiggy.upi@axisbank", "rahul.v@okicici". An email address (handle@domain.tld) is not one. */
export const VPA_RE = /\b[a-z0-9.\-_]+@[a-z]+\b(?!\.[a-z])/i;
