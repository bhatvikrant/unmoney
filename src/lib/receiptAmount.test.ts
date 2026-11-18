import { describe, expect, test } from "vitest";
import { parseAmount, pickAmount, type OcrLine } from "./receiptAmount";

/** A line from text: words split on spaces, all confident unless a word ends with "?". */
const line = (text: string, height = 20): OcrLine => ({
  height,
  words: text.split(" ").map((t) => (t.endsWith("?") ? { text: t.slice(0, -1), confidence: 40 } : { text: t, confidence: 95 })),
});

describe("parseAmount", () => {
  test.each([
    ["450", 450], ["450.00", 450], ["₹1,250.50", 1250.5], ["1,23,456.00", 123456], ["1.234,50", 1234.5],
    ["12,5", 12.5], ["Rs.500", 500], ["500/-", 500], ["$9.99", 9.99], ["1,234", 1234],
  ])("%s → %s", (word, n) => expect(parseAmount(word)).toBe(n));

  test.each(["abc", "12:30", "1,234,56", "1.234.5,6,7", "0", "0.00", "9876543210", "1,2345", "12/11/2026", "450.", "000086"])("%s is not an amount", (word) => {
    expect(parseAmount(word)).toBeNull();
  });
});

describe("pickAmount", () => {
  test("a receipt's grand total beats its subtotal and the plain total", () => {
    expect(pickAmount([
      line("Paneer Tikka 1 320.00"), line("Butter Naan 2 120.00"),
      line("Sub Total 440.00"), line("CGST 2.5% 11.00"), line("SGST 2.5% 11.00"),
      line("Total 462.00"), line("Round off -0.00"), line("Grand Total 462.00"),
    ])).toBe(462);
  });

  test("the amount on the line under its label", () => {
    expect(pickAmount([line("TOTAL AMOUNT"), line("₹ 1,299.00"), line("Thank you")])).toBe(1299);
  });

  test("the last number on a total line, not the item count", () => {
    expect(pickAmount([line("Total 3 items 450.00")])).toBe(450);
  });

  test("savings and quantities are not the total", () => {
    expect(pickAmount([line("Total Savings 50.00"), line("Total Qty 4"), line("Total 200.00")])).toBe(200);
  });

  test("two different totals: no answer", () => {
    expect(pickAmount([line("Total 200.00"), line("Total 250.00")])).toBeNull();
  });

  test("a total the OCR is unsure of: no answer", () => {
    expect(pickAmount([line("Grand Total 46Z.00?"), line("Paid by card")])).toBeNull();
  });

  test("a UPI screenshot: the amount in the biggest text", () => {
    expect(pickAmount([
      line("Paid to", 18), line("Sharma General Store", 22), line("₹500", 60),
      line("Completed", 18), line("UPI transaction ID 612345678901", 16), line("Balance ₹12,400", 18),
    ])).toBe(500);
  });

  test("money all the same size is just a price list", () => {
    expect(pickAmount([line("Tea ₹20"), line("Samosa ₹30")])).toBeNull();
  });

  test("numbers that aren't marked as money don't count without a total label", () => {
    expect(pickAmount([line("Order 4521", 40), line("Table 7", 20)])).toBeNull();
  });

  test("a sign OCR couldn't read (₹ isn't in its model) still marks the number as money", () => {
    const big: OcrLine = { height: 150, words: [{ text: "1,250", confidence: 96, money: true }] };
    expect(pickAmount([line("Paid to", 35), big, line("Completed 18 Nov 2026", 45)])).toBe(1250);
    expect(pickAmount([line("Paid to", 35), { ...big, words: [{ text: "1,250", confidence: 96 }] }])).toBeNull();
  });

  test("a receipt with no total line: the line saying how it was paid (a real Noida tea shop bill)", () => {
    expect(pickAmount([
      line("CASH/BILL"), line("000086 08-11-2026"), line("HAZAL.NUT.L 130.00"), line("PEACH.TEA.L 180.00"),
      line("SUB_TOT 500.00"), line("PAYTM 500.00", 30), line("ITM= 4 Q=5.000"),
      line("CGST @ 2.50%"), line("ON 476.18 11.91"), line("TOTAL GST 23.82"),
    ])).toBe(500);
  });

  test("a tax total misread as a total (TOTAL 6ST) is smaller than the bill, so it is passed over", () => {
    expect(pickAmount([
      line("HAZAL.NUT.L 130.00"), line("SUB_TOT 500.00"), line("PAYTM 500.00"), line("ON 476.18 11.91"), line("TOTAL 6ST 23.82"),
    ])).toBe(500);
    expect(pickAmount([line("Item 320.00"), line("TOTAL GSI 23.82")])).toBeNull();
  });

  test("a bill number is not a price the total has to beat", () => {
    expect(pickAmount([line("Bill 4521"), line("Tea 1 60.00"), line("Total 60.00")])).toBe(60);
  });

  test("a wallet balance can be more than what was paid", () => {
    expect(pickAmount([line("₹500", 60), line("Balance ₹12,400", 18)])).toBe(500);
  });

  test("a payment amount read with middling confidence counts when the subtotal backs it up", () => {
    const mid = (text: string): OcrLine => ({ height: 20, words: text.split(" ").map((t) => ({ text: t, confidence: 70 })) });
    expect(pickAmount([line("Tea 1 500.00"), line("SUB_TOT 500.00"), mid("PAYTM 500.00")])).toBe(500);
    // nothing else on the bill says 500: not enough
    expect(pickAmount([line("Tea 1 450.00"), mid("PAYTM 500.00")])).toBeNull();
    // too unsure to count at all
    expect(pickAmount([line("SUB_TOT 500.00"), { height: 20, words: [{ text: "PAYTM", confidence: 90 }, { text: "500.00", confidence: 40 }] }])).toBeNull();
  });

  test("cash handed over is not the amount paid", () => {
    expect(pickAmount([line("Cash 1000.00"), line("Change 391.00")])).toBeNull();
  });

  test("a total line beats how it was paid", () => {
    expect(pickAmount([line("Total 609.00"), line("Card 600.00")])).toBe(609);
  });

  test("nothing readable", () => {
    expect(pickAmount([])).toBeNull();
  });
});
