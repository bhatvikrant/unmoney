import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { applyOp, emptySnapshot, rewriteIds, tmpIdsIn, type Snapshot } from "../../shared/ops";
import { budgetCrossings, budgetsAt } from "../../shared/views";
import type { QueuedOp } from "./db";
import { viewOf, type Landed } from "./replay";

const userId = "u";
const ctx = { userId: userId as Id<"users"> };
let n = 0;
const queued = (kind: string, args: unknown): QueuedOp => ({ id: `op${++n}`, kind: kind as never, args, at: n, seq: n });

/** What the server does with an op: the same reducer, with real ids in place of the temporary ones. */
function serverApply(snap: Snapshot, op: QueuedOp): { snap: Snapshot; idMap: Record<string, string> } {
  const after = applyOp(snap, op, ctx).snap;
  const idMap: Record<string, string> = {};
  for (const tmp of tmpIdsIn(after)) idMap[tmp] = `real_${tmp}`;
  return { snap: rewriteIds(after, idMap), idMap };
}

/** A ₹10,000 Household budget with ₹6,555 spent this month, as the server has it at change number 10. */
function ledger() {
  let s = applyOp(emptySnapshot(), { id: "setup1", kind: "settings.completeOnboarding", args: { currency: "INR" }, at: 0 }, ctx).snap;
  const household = s.categories.find((c) => c.name === "Household")!._id;
  s = applyOp(s, { id: "setup2", kind: "budgets.upsert", args: { period: "monthly", categoryId: household, amount: 1_000_000 }, at: 0 }, ctx).snap;
  s = applyOp(s, { id: "setup3", kind: "transactions.create", args: entry(s, household, 655_500), at: 0 }, ctx).snap;
  // everything the device was loaded with has real ids
  const real: Record<string, string> = {};
  for (const tmp of tmpIdsIn(s)) real[tmp] = `real_${tmp}`;
  return { base: rewriteIds(s, real), household: real[household] ?? household };
}

function entry(s: Snapshot, categoryId: string, amount: number) {
  return { type: "expense", date: "2026-11-14", accountId: s.accounts[0]._id, categoryId, amount, note: "Ram ordered from zepto", tags: [], photoIds: [] };
}

const household = (s: Snapshot) => budgetsAt(s, "2026-11-14").find((i) => i.budget.categoryId)!;

test("an entry the server has saved is counted once while it waits to leave the queue", () => {
  const { base, household: cat } = ledger();
  const op = queued("transactions.create", entry(base, cat, 175_852));
  const server = serverApply(base, op);

  // 1. saved here: replayed on the copy, 83% of the budget
  const saved = viewOf(base, 10, [op], {}, new Map(), userId);
  expect(household(saved).spent).toBe(831_352);

  // 2. the server applied it at change 11; the copy is still at 10, so it is still replayed
  const landed: Landed = new Map([[op.id, { rev: 11, idMap: server.idMap }]]);
  expect(household(viewOf(base, 10, [op], {}, landed, userId)).spent).toBe(831_352);

  // 3. change 11 arrives before the op leaves the queue: the server's copy alone, not both
  const arrived = viewOf(server.snap, 11, [op], {}, landed, userId);
  expect(arrived.transactions.filter((t) => t.amount === 175_852)).toHaveLength(1);
  expect(household(arrived).spent).toBe(831_352);

  // 4. the op leaves the queue
  const settled = viewOf(server.snap, 11, [], {}, new Map(), userId);
  expect(household(settled).spent).toBe(831_352);

  // the alert sees 65% → 83% → 83% → 83%: one 80% crossing, never "over"
  const levels = [base, saved, arrived, settled].map((s) => budgetsAt(s, "2026-11-14"));
  const crossings = levels.slice(1).flatMap((after, i) => budgetCrossings(levels[i], after));
  expect(crossings.map((c) => c.level)).toEqual([1]);
});

test("without knowing it landed, the arrival is counted twice (the reported ₹72.04 over)", () => {
  const { base, household: cat } = ledger();
  const op = queued("transactions.create", entry(base, cat, 175_852));
  const server = serverApply(base, op);
  const doubled = viewOf(server.snap, 11, [op], {}, new Map(), userId);
  expect(household(doubled).remaining).toBe(-7_204);
});

test("a later change to the new entry still applies once the entry has arrived", () => {
  const { base, household: cat } = ledger();
  const create = queued("transactions.create", entry(base, cat, 175_852));
  const tmpId = applyOp(base, create, ctx).result as string;
  const edit = queued("transactions.update", { ...entry(base, cat, 100_000), id: tmpId });
  const server = serverApply(base, create);
  const landed: Landed = new Map([[create.id, { rev: 11, idMap: server.idMap }]]);

  const view = viewOf(server.snap, 11, [create, edit], {}, landed, userId);
  expect(view.transactions.filter((t) => t.note === "Ram ordered from zepto").map((t) => t.amount).sort()).toEqual([100_000, 655_500]);
  expect(household(view).spent).toBe(755_500);
});
