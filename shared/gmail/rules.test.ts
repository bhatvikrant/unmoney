import { expect, test } from "vitest";
import { fixtures } from "./fixtures/load";
import { isoDateIn, senderDomain } from "./mail";
import { findDate, findLast4, findTime, isShopMail, parseMail, receiptTotal, sourceLabel } from "./rules";

const defined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const kept = fixtures().flatMap((f) => (f.expected.triage === "keep" ? [{ name: f.name, mail: f.mail, parsed: f.expected.parsed }] : []));

test.each(kept)("$name parses to what the fixture says", ({ mail, parsed }) => {
  const got = parseMail(mail);
  expect(got).not.toBeNull();
  expect(defined(got!)).toEqual(parsed);
});

test("mail from a sender no rule knows is left to the model", () => {
  expect(parseMail({ id: "1", threadId: "1", from: "shop@example.com", subject: "Receipt", receivedAt: 0, text: "Total ₹100 paid" })).toBeNull();
});

test("a known sender whose mail has no amount or no verb is not parsed", () => {
  const base = { id: "1", threadId: "1", from: "alerts@hdfcbank.net", subject: "Alert", receivedAt: 0 };
  expect(parseMail({ ...base, text: "Dear Customer, your request has been registered." })).toBeNull();
  expect(parseMail({ ...base, text: "Your limit is Rs 1,00,000.00." })).toBeNull();
});

test("a mail without a date is dated by when it arrived, in Indian time", () => {
  const receivedAt = Date.parse("2026-10-18T20:30:00Z"); // 02:00 on the 19th in Kolkata
  const p = parseMail({ id: "1", threadId: "1", from: "alerts@hdfcbank.net", subject: "Alert", receivedAt, text: "Rs 100.00 has been debited from account **1234 to VPA x@ybl." });
  expect([p?.date, p?.dateSource]).toEqual(["2026-10-19", "received"]);
  expect(isoDateIn(receivedAt, "UTC")).toBe("2026-10-18");
});

test("dates in every bank's format, day before month", () => {
  expect(findDate("on 18-10-26.")).toBe("2026-10-18");
  expect(findDate("on 18/10/2026")).toBe("2026-10-18");
  expect(findDate("on 05-Oct-26")).toBe("2026-10-05");
  expect(findDate("on 18 October 2026,")).toBe("2026-10-18");
  expect(findDate("Oct 18, 2026 11:02")).toBe("2026-10-18");
  expect(findDate("2026-10-18T10:00")).toBe("2026-10-18");
  expect(findDate("Ref 529412345678 and Rs 1,250.00")).toBeNull();
  expect(findDate("on 31-02-26")).toBe("2026-02-31"); // the sync's date check catches impossible days
  expect(findDate("on 18-13-26")).toBeNull();
});

test("times, with and without am/pm", () => {
  expect(findTime("at 09:15:22.")).toBe("09:15");
  expect(findTime("1:12 PM")).toBe("13:12");
  expect(findTime("12:05 AM")).toBe("00:05");
  expect(findTime("at 02:08 p.m. from")).toBe("14:08");
  expect(findTime("Ref 5294 at 25:99")).toBeNull();
});

test("the last 4 digits in every masking style", () => {
  expect(findLast4("Credit Card ending 4521 for")).toBe("4521");
  expect(findLast4("ending in 4521")).toBe("4521");
  expect(findLast4("a/c XX1234 on")).toBe("1234");
  expect(findLast4("A/C XXXXX112233 Debited")).toBe("2233");
  expect(findLast4("HDFC Bank ••1234")).toBe("1234");
  expect(findLast4("AC X7788 to")).toBe("7788");
  expect(findLast4("Visa .... 4521")).toBe("4521");
  expect(findLast4("HDFC Bank Credit Card-4521")).toBe("4521");
  expect(findLast4("Ref No 529412345682")).toBeUndefined();
});

test("senders are told apart by domain, shops from banks", () => {
  expect(senderDomain("HDFC Bank <alerts@hdfcbank.net>")).toBe("hdfcbank.net");
  expect(isShopMail({ from: "Swiggy <noreply@swiggy.in>", subject: "Your order" })).toBe(true);
  expect(isShopMail({ from: "alerts@hdfcbank.net", subject: "Alert" })).toBe(false);
  expect(isShopMail({ from: "payments-noreply@google.com", subject: "You paid ₹450.00 to Swiggy" })).toBe(false);
  expect(isShopMail({ from: "googleplay-noreply@google.com", subject: "Your Google Play Order Receipt" })).toBe(true);
});

test("a receipt's total is the best-labelled amount, and a total under ₹5 gives way to a larger one", () => {
  const labels = [/\bGrand Total:?/i, /\bOrder Total:?/i, /\bTotal:?/i];
  expect(receiptTotal("Item Total ₹350.00 Order Total ₹379.50 Grand Total ₹385.00", labels)?.amount).toBe(385);
  expect(receiptTotal("Membership Total ₹1.00 Order Total ₹379.50", labels)?.amount).toBe(379.5);
  expect(receiptTotal("Grand Total ₹1.00 (Swiggy One Lite) Order Total ₹379.50", labels)?.amount).toBe(379.5);
  expect(receiptTotal("Grand Total ₹1.00", labels)?.amount).toBe(1);
  expect(receiptTotal("Grand Total $1.99 Total $12.00", labels)?.amount).toBe(1.99);
  expect(receiptTotal("Thanks for ordering", labels)).toBeNull();
});

test("provenance labels", () => {
  expect(sourceLabel({ rule: "hdfc", bankName: "HDFC", merchantRaw: "SWIGGY" })).toBe("HDFC alert");
  expect(sourceLabel({ rule: "hsbc", bankName: "HSBC", merchantRaw: "ZEPTO MARKETPLACE" })).toBe("HSBC alert");
  expect(sourceLabel({ rule: "google-pay", merchantRaw: "Swiggy" })).toBe("Google Pay");
  expect(sourceLabel({ rule: "swiggy", merchantRaw: "Swiggy" })).toBe("Swiggy receipt");
});

test("with both a debit and a credit verb, the first one says which way the money went", () => {
  const base = { id: "1", threadId: "1", from: "alerts@icicibank.com", subject: "Transaction alert", receivedAt: 0 };
  expect(parseMail({ ...base, text: "ICICI Bank Acct XX778 debited for Rs 100.00 on 20-Oct-26; PRIYA MENON credited. UPI:529312345693." })?.type).toBe("debit");
  expect(parseMail({ ...base, text: "Your ICICI Bank Account XX778 has been credited with Rs 100.00 on 20-Oct-26, paid by PRIYA MENON." })?.type).toBe("credit");
});

test("an ACH mandate's payee is read without the rail, the collector and the reference codes", () => {
  const base = { id: "1", threadId: "1", from: "alerts@axis.bank.in", subject: "Debit transaction alert for Axis Bank A/c", receivedAt: 0 };
  const payee = (by: string) => parseMail({ ...base, text: `Your A/c no. XX4190 has been debited with INR 5000.00 on 15-10-2026 07:02:13 IST by ${by}. To check your available balance, please click here.` })?.merchantRaw;
  expect(payee("ACH-DR-BD_HDFCMF-TJOK12832")).toBe("HDFCMF");
  expect(payee("ACH-DR-PPFAS 22102026 CAM")).toBe("PPFAS CAM");
  expect(payee("AUTOBPay/MiraeAsset/629410")).toBe("MiraeAsset");
});

test("an IMPS credit names the sender from its reference, not the time or the helpline", () => {
  const p = parseMail({ id: "1", threadId: "1", from: "alerts@axis.bank.in", subject: "Credit notification from Axis Bank", receivedAt: 0,
    text: "Dear Customer, Thank you for banking with us. INR 100000.00 has been credited to A/c no. XX4190 on 13-10-26 at 12:21:38 IST. Reference no. - IMPS/P2A/628606858621/VIKRANTB For any concerns regarding this transaction, please contact us on 18001035577 / 18604195555." });
  expect([p?.type, p?.amount, p?.merchantRaw, p?.time]).toEqual(["credit", 100000, "VIKRANTB", "12:21"]);
});

test("any .bank.in sender is read as a bank alert, named from its sender or its domain", () => {
  const base = { id: "1", threadId: "1", subject: "Transaction Alert", receivedAt: 0 };
  const named = parseMail({ ...base, from: "South Indian Bank <alerts@southindianbank.bank.in>", text: "Your South Indian Bank A/c XX9012 is debited for Rs.75.00 on 21-10-26 to VPA tea.stall@oksbi." });
  expect([named?.rule, named?.bankName, named?.amount, named?.vpa, named?.last4]).toEqual(["bank", "South Indian Bank", 75, "tea.stall@oksbi", "9012"]);
  expect(sourceLabel(named!)).toBe("South Indian Bank alert");
  const unnamed = parseMail({ ...base, from: "alerts@kvb.bank.in", text: "INR 120.00 debited from A/c XX3344 on 21-10-2026. Info: UPI/P2M/529712345602/BOOK HOUSE." });
  expect([unnamed?.bankName, unnamed?.merchantRaw]).toEqual(["KVB", "BOOK HOUSE"]);
  expect(parseMail({ ...base, from: "x@notbank.in", text: "INR 120.00 debited" })).toBeNull();
});

test("an Amazon mail for several orders is no one payment; a float slip is read to the paisa", () => {
  const base = { id: "1", threadId: "1", from: "auto-confirm@amazon.in", subject: "Ordered: \"Pillow Cover...\" and 2 more items", receivedAt: 0 };
  expect(parseMail({ ...base, text: "Thanks for your order! Order # 407-1 Pillow Cover 238 INR Total 238.35 INR Order # 407-2 Tripod 1804 INR Total 2313.59 INR" })).toBeNull();
  expect(parseMail({ ...base, text: "Thanks for your order! Order # 407-1 Plant Cutter 219 INR Total 208.35000000000002 INR" })?.amount).toBe(208.35);
});
