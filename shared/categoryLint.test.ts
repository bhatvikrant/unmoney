import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, type Snapshot } from "./ops";
import { lintCategories } from "./categoryLint";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
const run = (snap: Snapshot, kind: string, args: unknown) => applyOp(snap, { id: `op${++n}`, kind: kind as never, args, at: n }, ctx);

function withDuplicate(name: string) {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" }).snap;
  const cash = s.accounts.find((a) => a.name === "Cash")!._id;
  const r = run(s, "categories.create", { type: "expense", name });
  s = r.snap;
  const dup = r.result as Id<"categories">;
  for (const note of ["a", "b"]) s = run(s, "transactions.create", { type: "expense", accountId: cash, categoryId: dup, amount: 100, note, tags: [], photoIds: [], date: "2026-03-05" }).snap;
  return { s, dup };
}

const mergeOf = (s: Snapshot) => lintCategories(s, 0).find((f) => f.kind === "merge" && f.type === "expense")!;

test("tidy-up keeps the starter category's name when a user-made duplicate has more entries", () => {
  const { s, dup } = withDuplicate("food");
  const starter = s.categories.find((c) => c.name === "Food")!;
  const fix = mergeOf(s);
  expect(fix.ids).toContain(dup);
  expect(fix.targetId).toBe(starter._id);

  const after = run(s, "categories.applyCleanup", { steps: [{ kind: "merge", sourceIds: fix.ids, target: { id: fix.targetId } }] }).snap;
  const live = after.categories.filter((c) => c.type === "expense" && !c.deletedAt && c.name.toLowerCase() === "food");
  expect(live.map((c) => c.name)).toEqual(["Food"]);
  expect(after.transactions.every((t) => t.categoryId === starter._id)).toBe(true);
});

test("without a starter category among the duplicates, the most-used one still wins", () => {
  let { s, dup } = withDuplicate("Coffee");
  s = run(s, "categories.create", { type: "expense", name: "coffee" }).snap;
  expect(mergeOf(s).targetId).toBe(dup);
});
