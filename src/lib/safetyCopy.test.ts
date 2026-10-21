import { expect, test } from "vitest";
import { expiredCopies } from "./safetyCopy";

test("safety copies: the newest three are kept, and none past a week", () => {
  const day = 86_400_000;
  const now = 100 * day;
  const copies = [
    { id: "a", at: now - 1 * day },
    { id: "b", at: now - 2 * day },
    { id: "c", at: now - 3 * day },
    { id: "d", at: now - 4 * day },
    { id: "old", at: now - 8 * day },
  ];
  expect(expiredCopies(copies, now).sort()).toEqual(["d", "old"]);
  expect(expiredCopies([{ id: "x", at: now - 8 * day }], now)).toEqual(["x"]);
  expect(expiredCopies([], now)).toEqual([]);
});
