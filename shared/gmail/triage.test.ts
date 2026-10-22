import { expect, test } from "vitest";
import { fixtures } from "./fixtures/load";
import { triage } from "./triage";

test.each(fixtures())("$name is kept or dropped as expected", ({ mail, expected }) => {
  const verdict = triage(mail);
  if (expected.triage === "keep") expect(verdict).toEqual({ keep: true });
  else expect(verdict).toEqual({ keep: false, reason: expected.triage });
});

test("an amount needs a money verb nearby, not anywhere in the mail", () => {
  const far = `Your plan costs ₹999. ${"Lorem ipsum dolor sit amet. ".repeat(12)}We debited nothing yet.`;
  expect(triage({ subject: "Hello", text: far })).toEqual({ keep: false, reason: "no-verb" });
  expect(triage({ subject: "Hello", text: "₹999 was debited from your account." })).toEqual({ keep: true });
});

test("amounts are read in every common spelling", () => {
  for (const t of ["Rs.1250.00 debited", "Rs 1,47,501.00 spent", "INR 540 paid", "₹1,849 charged", "USD 12.99 charged", "$12.99 was charged", "286.00 INR paid"]) {
    expect(triage({ subject: "", text: t }), t).toEqual({ keep: true });
  }
  expect(triage({ subject: "", text: "Order 12345 was debited" })).toEqual({ keep: false, reason: "no-amount" });
});

test("promotions and statements are judged by the subject, so a receipt's footer cannot drop it", () => {
  expect(triage({ subject: "Your Swiggy order was delivered", text: "Grand Total ₹485 paid via UPI. Offers: 50% off your next order!" })).toEqual({ keep: true });
  expect(triage({ subject: "Offers just for you", text: "Grand Total ₹485 paid via UPI." })).toEqual({ keep: false, reason: "promo" });
});

test("an OTP is dropped by its code or its subject, not by a footer that warns about OTPs", () => {
  const footer = "Amount Credited: INR 598.00 Account Number: XX4190 Transaction Info: UPI/P2A/925606398105/AMIT DESH. Please do not share your Internet Banking details, such as user ID/password or your Credit/Debit Card number/CVV/OTP with anyone, either over phone or through email.";
  expect(triage({ subject: "INR 598.00 was credited to your A/c.", text: footer })).toEqual({ keep: true });
  expect(triage({ subject: "Transaction alert", text: "482913 is the OTP for a transaction of Rs 2,499.00 at AMAZON." })).toEqual({ keep: false, reason: "otp" });
  expect(triage({ subject: "Transaction alert", text: "Your OTP for the payment of Rs 2,499.00 is 482913." })).toEqual({ keep: false, reason: "otp" });
  expect(triage({ subject: "Your OTP", text: "Use it to pay Rs 2,499.00." })).toEqual({ keep: false, reason: "otp" });
});
