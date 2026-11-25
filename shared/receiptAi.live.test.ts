// @vitest-environment node
/**
 * A live check of photo reading, against the real model: not part of the normal test run (it costs a
 * little and needs a key). It sends every photo in a folder with a made-up ledger, through the same
 * request and the same checks as the app, and prints what the entry form would be filled with.
 *
 *   ANTHROPIC_API_KEY=... RECEIPT_PHOTOS=~/receipts ./node_modules/.bin/vitest run shared/receiptAi.live.test.ts
 *
 * Add RECEIPT_LEDGER=file.json ({ type, today, currency, categories, notes }, the shape of ReceiptInput)
 * to try it with a ledger like your own.
 */
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { expect, test } from "vitest";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { costOf } from "./aiCost";
import { receiptRequest, validateReceipt, type ReceiptInput, type ReceiptMediaType } from "./receiptAi";

const dir = process.env.RECEIPT_PHOTOS?.replace(/^~/, process.env.HOME ?? "~");
const TYPES: Record<string, ReceiptMediaType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
/** The API takes a photo up to 5 MB; the app shrinks it first (RECEIPT_MAX_EDGE), which this does not. */
const MAX_BYTES = 5 * 1024 * 1024;

const SAMPLE: ReceiptInput = {
  type: "expense",
  today: new Date().toISOString().slice(0, 10),
  currency: "INR",
  categories: [
    { id: "c1", name: "Food" }, { id: "c2", name: "Groceries", parent: "c1" }, { id: "c3", name: "Eating out", parent: "c1" },
    { id: "c4", name: "Transport" }, { id: "c5", name: "Fuel", parent: "c4" }, { id: "c6", name: "Shopping" }, { id: "c7", name: "Health" },
    { id: "c8", name: "Bills" }, { id: "c9", name: "Entertainment" }, { id: "c10", name: "Other" },
  ],
  notes: [
    { note: "swiggy", category: "c3", description: "dinner", used: 31 }, { note: "bigbasket", category: "c2", used: 18 },
    { note: "petrol", category: "c5", description: "full tank", used: 12 }, { note: "dmart", category: "c2", description: "monthly groceries", used: 9 },
    { note: "uber", category: "c4", used: 8 }, { note: "apollo pharmacy", category: "c7", description: "medicines", used: 5 },
    { note: "amazon", category: "c6", used: 5 }, { note: "electricity", category: "c8", used: 4 }, { note: "pvr", category: "c9", description: "movie", used: 3 },
  ],
};

test.skipIf(!process.env.ANTHROPIC_API_KEY || !dir)("reads the photos in RECEIPT_PHOTOS with the real model", async () => {
  const input: ReceiptInput = process.env.RECEIPT_LEDGER ? JSON.parse(readFileSync(process.env.RECEIPT_LEDGER, "utf8")) : SAMPLE;
  // stand-ins for the person's categories: the short id is its own id here
  const ids = Object.fromEntries(input.categories.map((c) => [c.id, c.id])) as Record<string, Id<"categories">>;
  const categories = input.categories.map((c) => ({ _id: c.id, name: c.name, parentId: c.parent })) as unknown as Doc<"categories">[];
  const name = (id?: string) => input.categories.find((c) => c.id === id)?.name;
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const files = readdirSync(dir!).filter((f) => TYPES[extname(f).toLowerCase()]).sort();
  expect(files.length, `no .jpg, .png or .webp photos in ${dir}`).toBeGreaterThan(0);
  let cost = 0;
  const rows: Record<string, unknown>[] = [];
  for (const f of files) {
    const bytes = readFileSync(join(dir!, f));
    if (bytes.byteLength > MAX_BYTES) { rows.push({ photo: f, note: "(over 5 MB: skipped)" }); continue; }
    const started = Date.now();
    const res = await client.messages.create(receiptRequest(input, TYPES[extname(f).toLowerCase()], bytes.toString("base64")));
    const u = res.usage;
    cost += costOf(res.model, { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 });
    const text = res.content.find((b) => b.type === "text");
    const raw = JSON.parse(text && text.type === "text" ? text.text : "{}");
    const r = validateReceipt(raw, ids, categories, input.today);
    rows.push({
      photo: f, receipt: raw.isReceipt, note: r.note, description: r.description,
      category: [name(r.categoryId), name(r.subcategoryId)].filter(Boolean).join(" › "), date: r.date,
      reused: !!r.note && input.notes.some((x) => x.note === r.note), tokens: `${u.input_tokens}+${u.output_tokens}`, seconds: ((Date.now() - started) / 1000).toFixed(1),
    });
    expect(res.stop_reason, f).toBe("end_turn");
  }
  console.table(rows);
  console.log(`${files.length} photos · $${cost.toFixed(5)} in all · $${(cost / files.length).toFixed(5)} a photo`);
}, 600_000);
