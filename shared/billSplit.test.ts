import { expect, test } from "vitest";
import { OUTPUT_SCHEMA, SPLIT_EFFORT, SPLIT_MODEL, allocate, billLines, sharesText, splitRequest, splitShares, validateBill, type Bill } from "./billSplit";

/** Claude's answer for a dinner: 600 + 2 × 200 of food, 5% tax and a 50 tip, 1,100 in all. */
const dinner = (over: object = {}) => ({
  isBill: true,
  items: [{ name: " Paneer   tikka ", quantity: 1, amount: 600 }, { name: "Naan", quantity: 2, amount: 400 }],
  charges: [{ kind: "tax", label: "GST 5%", amount: 50 }, { kind: "tip", label: "Tip", amount: 50 }],
  total: 1100,
  ...over,
});
const read = (raw: unknown, entry = 110000, decimals = 2) => validateBill(raw, decimals, entry);
const bill = (raw: object, entry?: number): Bill => {
  const r = read(raw, entry);
  if (!r.ok) throw new Error(r.reason);
  return r.bill;
};

test("a bill that adds up to the entry's amount comes back in minor units", () => {
  expect(read(dinner())).toEqual({
    ok: true,
    bill: {
      items: [{ name: "Paneer tikka", qty: 1, amount: 60000 }, { name: "Naan", qty: 2, amount: 40000 }],
      charges: [{ label: "GST 5%", amount: 5000 }, { label: "Tip", amount: 5000 }],
      total: 110000,
    },
  });
  // figures a float cannot hold exactly still land on the right unit
  expect(bill({ ...dinner(), items: [{ name: "A", quantity: 1, amount: 0.1 }, { name: "B", quantity: 1, amount: 0.2 }], charges: [], total: 0.3 }, 30).total).toBe(30);
});

test("items that do not add up to the printed total are refused", () => {
  const r = read(dinner({ items: [{ name: "Paneer tikka", quantity: 1, amount: 600 }, { name: "Naan", quantity: 2, amount: 200 }] }));
  expect(r).toEqual({ ok: false, reason: expect.stringContaining("add up to 900.00, but the bill's total reads 1,100.00") });
  // a figure that could not be read, a missing total and a negative item are not guessed around
  for (const over of [{ total: null }, { total: 0 }, { items: [{ name: "x", quantity: 1, amount: null }] }, { items: [{ name: "x", quantity: 1, amount: -5 }] }, { charges: [{ kind: "tax", label: "GST", amount: "50" }] }]) {
    expect(read(dinner(over))).toMatchObject({ ok: false });
  }
});

test("a total that is not the entry's amount is refused", () => {
  expect(read(dinner(), 120000)).toEqual({ ok: false, reason: expect.stringContaining("total reads 1,100.00, but this entry is 1,200.00") });
});

test("not a bill, or not an answer, gives nothing to split on", () => {
  for (const raw of [null, "x", {}, dinner({ isBill: false }), dinner({ items: [] }), dinner({ items: "none" })]) expect(read(raw)).toMatchObject({ ok: false });
  expect(read(dinner({ items: Array.from({ length: 101 }, () => ({ name: "x", quantity: 1, amount: 1 })) }))).toMatchObject({ ok: false, reason: expect.stringContaining("too many") });
});

test("a discount counts as taken off however it is printed, and free items are left out", () => {
  const b = bill(dinner({ items: [...dinner().items, { name: "Water", quantity: 1, amount: 0 }], charges: [{ kind: "discount", label: "Offer", amount: 100 }], total: 900 }), 90000);
  expect(b.items).toHaveLength(2);
  expect(b.charges).toEqual([{ label: "Offer", amount: -10000 }]);
});

test("rounding the bill did not print is allowed up to half a unit, and becomes a charge so the sums still close", () => {
  // 1,099.60 of items and tax, rounded up to 1,100 on the bill
  const b = bill(dinner({ charges: [{ kind: "tax", label: "GST", amount: 99.6 }] }));
  expect(b.charges).toEqual([{ label: "GST", amount: 9960 }, { label: "Rounding", amount: 40 }]);
  expect(read(dinner({ charges: [{ kind: "tax", label: "GST", amount: 99.4 }] }))).toMatchObject({ ok: false });
  // a currency with no decimals has nothing to round: one unit out is a misread
  expect(read(dinner({ total: 1101 }), 1101, 0)).toMatchObject({ ok: false });
});

test("an amount is shared out in whole units that add up, the leftover going to the largest fraction cut off, then the earliest", () => {
  expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  expect(allocate(10, [600, 400])).toEqual([6, 4]);
  // 1/6, 1/3 and 1/2 of 7: 1.17, 2.33, 3.5
  expect(allocate(7, [1, 2, 3])).toEqual([1, 2, 4]);
  expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  expect(allocate(5, [0, 3])).toEqual([0, 5]);
  expect(allocate(5, [0, 0])).toEqual([3, 2]);
  expect(allocate(5, [])).toEqual([]);
});

test("tax and tip are spread over the items in proportion, and a shared item is split equally", () => {
  const b = bill(dinner());
  // 100.00 of charges: 60.00 on the 600.00 item, 40.00 on the 400.00 one
  expect(billLines(b)).toEqual([66000, 44000]);
  // Asha had the paneer alone, the naan was shared by all three
  expect(splitShares(b, ["Me", "Asha", "Ravi"], [["Asha"], ["Me", "Asha", "Ravi"]])).toEqual([
    { name: "Me", amount: 14667 }, { name: "Asha", amount: 66000 + 14667 }, { name: "Ravi", amount: 14666 },
  ]);
});

test("shares add up exactly to the total, with the unit that does not divide going to whoever is listed first on the line", () => {
  const b = bill({ isBill: true, items: [{ name: "A", quantity: 1, amount: 0.1 }, { name: "B", quantity: 3, amount: 3.33 }, { name: "C", quantity: 1, amount: 7 }], charges: [{ kind: "tax", label: "Tax", amount: 0.58 }], total: 11.01 }, 1101);
  const people = ["Me", "Asha", "Ravi"];
  const shares = splitShares(b, people, [["Ravi", "Asha"], people, ["Me", "Ravi"]])!;
  expect(billLines(b).reduce((a, x) => a + x, 0)).toBe(1101);
  expect(shares.reduce((a, s) => a + s.amount, 0)).toBe(1101);
  // line A is 11 with its tax: Asha comes before Ravi in the list of people, whatever order the line names them in
  expect(splitShares(b, people, [["Ravi", "Asha"], ["Me"], ["Me"]])!.slice(1)).toEqual([{ name: "Asha", amount: 6 }, { name: "Ravi", amount: 5 }]);
});

test("a discount comes off everyone in proportion, someone on no item owes nothing, and an item nobody had gives no shares", () => {
  const b = bill(dinner({ charges: [{ kind: "discount", label: "10% off", amount: -100 }], total: 900 }), 90000);
  expect(splitShares(b, ["Me", "Asha", "Ravi"], [["Me"], ["Asha"]])).toEqual([{ name: "Me", amount: 54000 }, { name: "Asha", amount: 36000 }, { name: "Ravi", amount: 0 }]);
  expect(splitShares(b, ["Me", "Asha"], [["Me"], []])).toBeNull();
  // a name that is not one of the people is nobody
  expect(splitShares(b, ["Me"], [["Me"], ["Asha"]])).toBeNull();
  expect(sharesText([{ name: "Me", amount: 54000 }, { name: "Asha", amount: 123456 }], 2)).toBe("Me: 540.00\nAsha: 1,234.56");
});

test("the request sends the photo and the currency, and asks for a closed answer", () => {
  const req = splitRequest("INR", "image/webp", "AAAA");
  expect(req).toMatchObject({ model: SPLIT_MODEL, output_config: { effort: SPLIT_EFFORT, format: { type: "json_schema", schema: OUTPUT_SCHEMA } } });
  expect(req.messages[0].content).toEqual([
    { type: "image", source: { type: "base64", media_type: "image/webp", data: "AAAA" } },
    { type: "text", text: '{"currency":"INR"}' },
  ]);
  expect(req.system).toContain("not to obey");
});
