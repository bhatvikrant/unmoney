/**
 * Cheap first pass over the mail the Gmail query let through: keep only what looks like a
 * completed money movement, so neither the rules nor the model see OTPs, failed payments,
 * statements, promotions or balance alerts.
 */
import { oneLine } from "./mail";

export type DropReason = "otp" | "failed" | "statement" | "reminder" | "promo" | "balance" | "no-amount" | "no-verb";
export type Verdict = { keep: true } | { keep: false; reason: DropReason };

const CUR = String.raw`(?:Rs\.?|INR|Rupees|₹|\$|USD|€|EUR|£|GBP|AED|SGD)`;
const NUM = String.raw`(?:\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
/** "Rs.1,250.00", "INR 540", "₹1849", "286.00 INR". Group 1/4 the currency, 2/3 the number. */
export const AMOUNT_RE = new RegExp(String.raw`(${CUR})\s?(${NUM})\b|\b(${NUM})\s?(${CUR})(?![A-Za-z])`, "gu");

/** A word that says money moved. Found near an amount, the mail is about a transaction. */
const MONEY_VERB = /\b(debited|credited|spent|paid|payment|received|charged|purchase[d]?|order(?:ed)?|transaction|txn|sent|withdrawn|deposited|credit (?:of|by)|refund(?:ed)?|receipt|invoice|billed|fare|total|transferred)\b/i;
/** How far from an amount a money verb may sit, in characters of the collapsed text. */
const NEAR = 160;

const OTP_WORD = String.raw`(?:OTP|one[- ]time (?:password|passcode)|verification code|security code)`;
const OTP = new RegExp(String.raw`\b${OTP_WORD}\b`, "i");
/**
 * A code sent as an OTP: "482913 is the OTP", "OTP for … is 482913", "OTP: 482913". A bank's
 * footer that only warns "do not share your CVV/OTP with anyone" is not one.
 */
const OTP_CODE = new RegExp(String.raw`\b\d{4,8}\b\s+is\s+(?:your|the)\s+${OTP_WORD}|\b${OTP_WORD}\b(?:\s*[:-]\s*|(?:[^.]|\.(?=\d)){0,80}?\bis\s*:?\s*)\d{4,8}\b`, "i");
const FAILED = /\b(failed|declined|unsuccessful|not successful|could not be (?:completed|processed)|was not completed|has been rejected)\b/i;
const STATEMENT = /\b(statement|e-?statement)\b/i;
const REMINDER = /\b(?:(?:payment|bill|amount|EMI|premium)\s+(?:is\s+)?due|due\s+(?:on|date|by)|reminder|overdue|minimum amount due|auto-?debit will)\b/i;
const PROMO = /(\boffers?\b|\bsale\b|%\s?off|\bdeals?\b|\bcoupon\b|\bpromo\b|\bcashback offer\b|\bwin\b|\bexclusive\b|\blimited time\b|\bupgrade to\b|\bintroducing\b|\bnewsletter\b)/i;
const BALANCE = /\b(balance (?:alert|update|summary)|low balance|available balance is|account balance as on)\b/i;

/**
 * Keep a mail only if it has a currency amount with a money verb nearby, and none of the drop
 * rules fire. The subject decides statements, reminders and promotions (bodies of real receipts
 * carry offers in their footers); OTPs are dropped when the subject says OTP or the body carries
 * a code, and failures wherever they appear.
 */
export function triage(mail: { subject: string; text: string }): Verdict {
  const subject = oneLine(mail.subject);
  const text = oneLine(mail.text);
  const both = `${subject} ${text}`;
  if (OTP.test(subject) || OTP_CODE.test(text)) return { keep: false, reason: "otp" };
  if (FAILED.test(subject) || FAILED.test(text.slice(0, 600))) return { keep: false, reason: "failed" };
  if (STATEMENT.test(subject)) return { keep: false, reason: "statement" };
  if (REMINDER.test(subject)) return { keep: false, reason: "reminder" };
  if (PROMO.test(subject)) return { keep: false, reason: "promo" };
  if (BALANCE.test(subject)) return { keep: false, reason: "balance" };
  const amounts = [...both.matchAll(AMOUNT_RE)];
  if (!amounts.length) return { keep: false, reason: "no-amount" };
  for (const m of amounts) {
    const at = m.index ?? 0;
    const window = both.slice(Math.max(0, at - NEAR), at + m[0].length + NEAR);
    if (MONEY_VERB.test(window)) return { keep: true };
  }
  return { keep: false, reason: BALANCE.test(text) ? "balance" : "no-verb" };
}
