/**
 * The backup file. Without receipt photos it is the JSON alone, as it always was. With them it is a zip:
 * backup.json plus photos/<storage id>.<ext>. A zip, not base64 inside the JSON, because the photos are
 * the bulk of it (hundreds of MB for years of receipts): base64 adds a third and has to pass through one
 * string in memory, on a phone, both ways. Here each photo stays a Blob the browser keeps where it likes;
 * only one at a time is read (for its checksum) when writing, and only the one being re-uploaded when reading.
 */
import type { BackupData } from "../../shared/ops";

/** A backup's photos by the id its entries name them with; each is read from the file only when asked for. */
export type BackupPhotos = Map<string, () => Promise<File>>;

/**
 * The answer, or null when none has come in `ms`. A one-shot Convex query waits for the socket for as long
 * as it is down, so asking the server something in the middle of a backup or a restore would otherwise leave
 * it hanging (and its button disabled) until the connection came back.
 */
export const orGiveUp = <T>(answer: Promise<T>, ms = 10_000): Promise<T | null> =>
  Promise.race([answer, new Promise<null>((done) => setTimeout(() => done(null), ms))]);

const JSON_NAME = "backup.json";
const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * A zip of the files as they are (stored, not deflated: photos are already compressed).
 * shortcut: no zip64, so at most 65,535 files and 4 GB; it throws beyond that. Upgrade if a ledger's photos get there.
 */
export async function zip(files: { name: string; data: Blob }[]): Promise<Blob> {
  if (files.length > 0xffff) throw new Error("Too many files for one zip");
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0, centralSize = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    // what the local and the central header share: version 2.0, UTF-8 names, stored, 1 Jan 1980, checksum, sizes, name length
    const shared = new DataView(new ArrayBuffer(26));
    shared.setUint16(0, 20, true);
    shared.setUint16(2, 0x0800, true);
    shared.setUint16(8, 0x21, true);
    shared.setUint32(10, crc32(new Uint8Array(await f.data.arrayBuffer())), true);
    shared.setUint32(14, f.data.size, true);
    shared.setUint32(18, f.data.size, true);
    shared.setUint16(22, name.length, true);
    const local = new DataView(new ArrayBuffer(4));
    local.setUint32(0, SIG_LOCAL, true);
    const head = new DataView(new ArrayBuffer(6)), tail = new DataView(new ArrayBuffer(14));
    head.setUint32(0, SIG_CENTRAL, true);
    head.setUint16(4, 20, true);
    tail.setUint32(10, offset, true);
    parts.push(local, shared, name, f.data);
    central.push(head, shared, tail, name);
    offset += 30 + name.length + f.data.size;
    centralSize += 46 + name.length;
    if (offset + centralSize > 0xffffffff) throw new Error("Too large for one zip");
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_END, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/**
 * The files in a zip, by name. Each is a slice of the file, inflated first if another tool re-zipped it.
 * Throws when the file is not a zip (or is one this can't read: encrypted, zip64, split).
 */
export async function unzip(file: Blob): Promise<Map<string, () => Promise<Blob>>> {
  const view = async (from: number, to: number) => new DataView(await file.slice(from, to).arrayBuffer());
  // the end record is the last thing in the file, bar a comment of up to 65,535 bytes
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await view(tailStart, file.size);
  let at = tail.byteLength - 22;
  while (at >= 0 && tail.getUint32(at, true) !== SIG_END) at--;
  if (at < 0) throw new Error("Not a zip file");
  const count = tail.getUint16(at + 10, true), dirSize = tail.getUint32(at + 12, true), dirStart = tail.getUint32(at + 16, true);
  const dir = await view(dirStart, dirStart + dirSize);
  const out = new Map<string, () => Promise<Blob>>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > dir.byteLength || dir.getUint32(p, true) !== SIG_CENTRAL) throw new Error("Damaged zip file");
    const method = dir.getUint16(p + 10, true), size = dir.getUint32(p + 20, true), nameLen = dir.getUint16(p + 28, true), local = dir.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
    out.set(name, async () => {
      // the local header repeats the name and may carry extra fields of its own length
      const head = await view(local, local + 30);
      if (head.byteLength < 30 || head.getUint32(0, true) !== SIG_LOCAL) throw new Error("Damaged zip file");
      const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      const data = file.slice(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error("Unsupported zip compression");
      return new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
    });
  }
  return out;
}

/** The file to download for a backup: a zip when there are photos to carry, otherwise the JSON as before. */
export async function packBackup(data: BackupData, photos: Map<string, Blob>): Promise<{ blob: Blob; ext: "zip" | "json" }> {
  const json = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  if (!photos.size) return { blob: json, ext: "json" };
  const files = [...photos].map(([id, data]) => ({ name: `photos/${id}.${/^image\/(\w+)/.exec(data.type)?.[1] ?? "jpeg"}`, data }));
  return { blob: await zip([{ name: JSON_NAME, data: json }, ...files]), ext: "zip" };
}

/** A backup from the file the user chose: the zip above, or a bare JSON backup (any backup from before photos were in it). Throws if it is neither. */
export async function readBackupFile(file: Blob): Promise<{ data: BackupData; photos: BackupPhotos }> {
  const photos: BackupPhotos = new Map();
  if (new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0, true) !== SIG_LOCAL) return { data: JSON.parse(await file.text()) as BackupData, photos };
  const files = await unzip(file);
  // a folder in front of the names is fine: unzipping a backup and zipping the folder again puts one there
  const named = (re: RegExp) => [...files].flatMap(([name, get]) => { const m = re.exec(name); return m ? [{ m, get }] : []; });
  const json = named(/(^|\/)backup\.json$/)[0];
  if (!json) throw new Error("No backup.json in that zip");
  for (const { m, get } of named(/(?:^|\/)photos\/([^/]+)\.(\w+)$/)) {
    const [, id, ext] = m;
    const type = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    photos.set(id, async () => new File([await get()], `${id}.${ext}`, { type }));
  }
  return { data: JSON.parse(await (await json.get()).text()) as BackupData, photos };
}
