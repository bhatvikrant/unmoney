#!/usr/bin/env node
/**
 * One-off: shrinks the photos already attached to entries the way the app now does before an upload
 * (orientation fixed, longest side at most 2560px, WebP at quality 85), and swaps them in place.
 *
 * Each photo is backed up, re-encoded, uploaded and claimed as its owner, then every entry that names
 * it is switched over through the app's own `transactions.update` op, and only then is the original
 * deleted. A photo that would not come out smaller is left alone. Nothing is written without --apply.
 *
 *   npm install --no-save sharp
 *   node scripts/shrink-photos.mjs [--prod] [--apply] [--backup <dir>]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_EDGE = 2560;
const QUALITY = 85;
/** The most rows `npx convex data` hands back in one go. */
const LIMIT = 16000;
const TX_FIELDS = ["type", "date", "time", "accountId", "toAccountId", "categoryId", "subcategoryId", "amount", "subAmount",
  "subCurrency", "exchangeRate", "note", "description", "tags", "feeAmount", "photoIds"];

const argv = process.argv.slice(2);
const prod = argv.includes("--prod");
const apply = argv.includes("--apply");
const backupDir = argv.includes("--backup") ? argv[argv.indexOf("--backup") + 1] : `photo-backup-${new Date().toISOString().slice(0, 10)}`;
const where = prod ? ["--prod"] : [];

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  fail("sharp is not installed: run `npm install --no-save sharp` first.");
}

function convex(args) {
  const r = spawnSync("npx", ["convex", ...args, ...where], { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`npx convex ${args[0]} ${args.at(-2) ?? ""} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function rows(table) {
  const out = convex(["data", table, "--limit", String(LIMIT), "--format", "jsonLines"]);
  const list = out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  if (list.length >= LIMIT) fail(`${table} has ${LIMIT}+ rows; page through it before running this.`);
  return list;
}

/** Calls a deployed function as `userId`, exactly as that user's app would. */
function call(userId, name, args) {
  const identity = JSON.stringify({ subject: `${userId}|shrink-photos`, issuer: "shrink-photos" });
  const out = convex(["run", "--identity", identity, name, JSON.stringify(args)]).trim();
  return out ? JSON.parse(out) : null;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

console.log(`${apply ? "Shrinking" : "Dry run on"} ${prod ? "PRODUCTION" : "dev"} photos\n`);
const owners = new Map(rows("fileOwners").map((o) => [o.storageId, o.userId]));
const entries = rows("transactions").filter((t) => t.photoIds?.length);
const files = new Map(rows("_storage").map((f) => [f._id, f]));

// photo id -> the entries that name it (an entry copy can share a photo)
const users = new Map();
for (const t of entries) for (const id of t.photoIds) {
  if (!users.has(id)) users.set(id, []);
  users.get(id).push(t);
}

const replaced = new Map(); // old photo id -> new photo id
let before = 0, after = 0, count = 0;
if (apply) mkdirSync(backupDir, { recursive: true });

for (const [id, txs] of users) {
  const file = files.get(id);
  if (!file) { console.log(`${id}: missing from storage, skipped`); continue; }
  const userId = owners.get(id) ?? txs[0].userId;
  if (txs.some((t) => t.userId !== userId)) { console.log(`${id}: named by more than one user's entries, skipped`); continue; }
  if (!/^image\/(jpeg|png|webp|avif|heic|heif|tiff)$/.test(file.contentType ?? "")) { console.log(`${id}: ${file.contentType}, left as is`); continue; }

  const url = call(userId, "files:urls", { ids: [id] })[id];
  if (!url) { console.log(`${id}: no URL for its owner, skipped`); continue; }
  const original = Buffer.from(await (await fetch(url)).arrayBuffer());
  const small = await sharp(original).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY }).toBuffer();
  const meta = await sharp(small).metadata();
  if (small.length >= original.length) { console.log(`${id}: ${kb(original.length)}, already small, left as is`); continue; }
  console.log(`${id}: ${kb(original.length)} -> ${kb(small.length)} (${meta.width}x${meta.height} webp), on ${txs.length} entr${txs.length === 1 ? "y" : "ies"}`);
  before += original.length;
  after += small.length;
  count++;
  if (!apply) continue;

  writeFileSync(join(backupDir, `${id}.${(file.contentType ?? "image/jpeg").split("/")[1]}`), original);
  const uploadUrl = call(userId, "files:generateUploadUrl", {});
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/webp" }, body: small });
  if (!res.ok) fail(`Upload failed (${res.status}) for ${id}`);
  const { storageId } = await res.json();
  call(userId, "files:claim", { storageId });
  replaced.set(id, storageId);
}

if (apply) {
  // switch each entry over in one op, then drop the originals nothing names any more
  for (const t of entries) {
    if (!t.photoIds.some((p) => replaced.has(p))) continue;
    const args = Object.fromEntries(TX_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
    args.photoIds = t.photoIds.map((p) => replaced.get(p) ?? p);
    const [outcome] = call(t.userId, "sync:apply", { ops: [{ id: randomUUID(), kind: "transactions.update", args: { ...args, id: t._id }, at: Date.now() }] });
    if (outcome.status !== "applied") fail(`Entry ${t._id} was not updated (${outcome.error}); originals kept, new copies left in storage.`);
    console.log(`entry ${t._id}: photos switched`);
  }
  const fresh = new Map(rows("transactions").map((t) => [t._id, t]));
  for (const [oldId] of replaced) {
    if ([...fresh.values()].some((t) => t.photoIds?.includes(oldId))) { console.log(`${oldId}: still named by an entry, kept`); continue; }
    call(owners.get(oldId) ?? users.get(oldId)[0].userId, "files:remove", { id: oldId });
    console.log(`${oldId}: original removed`);
  }
  console.log(`\nOriginals backed up in ${backupDir}/`);
}
console.log(`\n${apply ? "Shrank" : "Would shrink"} ${count} photo(s): ${kb(before)} -> ${kb(after)}`);
