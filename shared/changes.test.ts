import { describe, expect, test } from "vitest";
import { applyChanges } from "./changes";
import { emptySnapshot, type Snapshot } from "./ops";

const note = (id: string, text: string) => ({ _id: id, _creationTime: 1, userId: "u", date: "2026-10-18", text, color: "#000" });

function snap(): Snapshot {
  return { ...emptySnapshot(), notes: [note("a", "one"), note("b", "two"), note("c", "three")] as unknown as Snapshot["notes"] };
}

describe("folding changes into a device's copy", () => {
  test("changed documents stay where they were, new ones go last, deleted ones go", () => {
    const before = snap();
    const after = applyChanges(before, { rev: 2, docs: { notes: [note("b", "TWO"), note("d", "four")] as unknown as Snapshot["notes"] }, deleted: [{ table: "notes", id: "a" }] });
    expect(after.notes.map((n) => [n._id, n.text])).toEqual([["b", "TWO"], ["c", "three"], ["d", "four"]]);
  });

  test("tables nothing touched keep their identity, and no changes keep the snapshot", () => {
    const before = snap();
    const after = applyChanges(before, { rev: 2, docs: { notes: [note("a", "ONE")] as unknown as Snapshot["notes"] }, deleted: [] });
    expect(after.transactions).toBe(before.transactions);
    expect(after.notes).not.toBe(before.notes);
    expect(applyChanges(before, { rev: 2, docs: {}, deleted: [] })).toBe(before);
    expect(applyChanges(before, { rev: 2, reset: true })).toBe(before);
    expect(applyChanges(before, undefined)).toBe(before);
  });

  test("a document created and deleted between two looks never shows", () => {
    const after = applyChanges(snap(), { rev: 3, docs: { notes: [note("x", "gone")] as unknown as Snapshot["notes"] }, deleted: [{ table: "notes", id: "x" }] });
    expect(after.notes.map((n) => n._id)).toEqual(["a", "b", "c"]);
  });
});

test("an entry that got into the copy twice is kept once", () => {
  const twice = { ...emptySnapshot(), notes: [note("a", "one"), note("a", "one again")] as unknown as Snapshot["notes"] };
  const after = applyChanges(twice, { rev: 2, docs: { notes: [note("a", "latest")] as unknown as Snapshot["notes"] }, deleted: [] });
  expect(after.notes.map((n) => [n._id, n.text])).toEqual([["a", "latest"]]);
});
