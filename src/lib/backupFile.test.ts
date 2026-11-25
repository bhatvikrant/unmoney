import { expect, test } from "vitest";
import { packBackup, readBackupFile, unzip, zip } from "./backupFile";
import type { BackupData } from "../../shared/ops";

const data: BackupData = { version: 1, settings: {}, accounts: [{ _id: "a" }], transactions: [{ _id: "t", photoIds: ["p1", "p2"], note: "₹ café" }] };
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const read = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

test("a backup with photos is a zip that reads back to the same data and the same photos", async () => {
  const photos = new Map([["p1", new Blob([bytes(5000, 1)], { type: "image/webp" })], ["p2", new Blob([bytes(70_000, 2)], { type: "image/jpeg" })]]);
  const file = await packBackup(data, photos);
  expect(file.ext).toBe("zip");
  expect([...(await unzip(file.blob)).keys()]).toEqual(["backup.json", "photos/p1.webp", "photos/p2.jpeg"]);

  const back = await readBackupFile(file.blob);
  expect(back.data).toEqual(data);
  expect([...back.photos.keys()]).toEqual(["p1", "p2"]);
  const p2 = await back.photos.get("p2")!();
  expect([p2.name, p2.type, p2.size]).toEqual(["p2.jpeg", "image/jpeg", 70_000]);
  expect(await read(p2)).toEqual([...bytes(70_000, 2)]);
  expect((await back.photos.get("p1")!()).type).toBe("image/webp");
});

test("without photos the backup is the plain JSON, and a plain JSON backup still reads", async () => {
  const file = await packBackup(data, new Map());
  expect(file.ext).toBe("json");
  expect(JSON.parse(await file.blob.text())).toEqual(data);
  const back = await readBackupFile(file.blob);
  expect(back.data).toEqual(data);
  expect(back.photos.size).toBe(0);
});

test("a file that is neither is refused", async () => {
  await expect(readBackupFile(new Blob(["not a backup"]))).rejects.toThrow();
  await expect(readBackupFile(await zip([{ name: "other.txt", data: new Blob(["x"]) }]))).rejects.toThrow("No backup.json");
});

test("a backup unzipped and zipped again by another tool (deflated, inside a folder) still reads", async () => {
  // made with: zip -X -r fx.zip UnMoney-backup/backup.json UnMoney-backup/photos/p1.jpg (the photo is 80 "a"s)
  const fixture = "UEsDBBQAAAAIAPlteV0sSWVYUAAAAFkAAAAaAAAAVW5Nb25leS1iYWNrdXAvYmFja3VwLmpzb24lyzEOgCAMRuG7/DMLKzfwDIaYBoiyUEKrC+ndxTh+eXkTTxlSuSF4BymqtZ2CMM2BUuK76dI+cdSMAIJFBx3UhJKu7Y/9YuUtf0D3iBbtBVBLAwQUAAAACAD5bXldfY2ZGgYAAABQAAAAHAAAAFVuTW9uZXktYmFja3VwL3Bob3Rvcy9wMS5qcGdLTKQuAABQSwECHgMUAAAACAD5bXldLEllWFAAAABZAAAAGgAAAAAAAAABAAAApIEAAAAAVW5Nb25leS1iYWNrdXAvYmFja3VwLmpzb25QSwECHgMUAAAACAD5bXldfY2ZGgYAAABQAAAAHAAAAAAAAAABAAAApIGIAAAAVW5Nb25leS1iYWNrdXAvcGhvdG9zL3AxLmpwZ1BLBQYAAAAAAgACAJIAAADIAAAAAAA=";
  const back = await readBackupFile(new Blob([Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0))]));
  expect(back.data.transactions).toEqual([{ photoIds: ["p1"] }]);
  const photo = await back.photos.get("p1")!();
  expect([photo.type, await photo.text()]).toEqual(["image/jpeg", "a".repeat(80)]);
});
