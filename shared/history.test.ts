import { expect, test } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { applyOp, emptySnapshot, OP_TABLES, TABLES, type Op, type Snapshot, type Table } from "./ops";
import { HISTORY_KINDS, HISTORY_MAX } from "./history";

const ctx = { userId: "u" as Id<"users"> };
let n = 0;
/** Runs an op the way the device does, and checks the server (which loads only the op's tables) words its history the same. */
function run(snap: Snapshot, kind: string, args: unknown, at = ++n * 60_000): Snapshot {
  const op: Op = { id: `op${++n}`, kind: kind as never, args, at };
  const device = applyOp(snap, op, ctx).snap;
  const loaded = new Set<Table>(OP_TABLES[op.kind]);
  const serverBase = emptySnapshot();
  for (const t of TABLES) if (loaded.has(t)) (serverBase as Record<Table, unknown[]>)[t] = snap[t];
  const server = applyOp(serverBase, op, ctx).snap;
  expect(texts(server, "accounts"), `${kind} on the server`).toEqual(texts(device, "accounts"));
  expect(texts(server, "categories"), `${kind} on the server`).toEqual(texts(device, "categories"));
  return device;
}
const texts = (s: Snapshot, scope: string) => s.history.filter((h) => h.scope === scope).sort((a, b) => a.at - b.at || a._creationTime - b._creationTime).map((h) => h.text);
const acc = (s: Snapshot, name: string) => s.accounts.find((a) => a.name === name)!;

test("every change to payment methods and groups reads as a sentence", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "INR" });
  expect(s.history).toEqual([]); // setting up is not a change the user made
  s = run(s, "accounts.create", { name: "HDFC", kind: "bank", initialBalance: 0, includeInTotals: true, hidden: false, transferAsExpense: false, groupId: s.accountGroups.find((g) => g.name === "Bank accounts")!._id });
  const hdfc = acc(s, "HDFC");
  s = run(s, "accounts.update", { ...hdfc, id: hdfc._id, name: "HDFC Savings", initialBalance: 250000, groupId: undefined });
  s = run(s, "accounts.setArchived", { ids: [hdfc._id], archived: true });
  s = run(s, "accounts.setArchived", { ids: [hdfc._id], archived: false });
  const cash = acc(s, "Cash")._id;
  s = run(s, "accounts.merge", { sourceIds: [hdfc._id], targetId: acc(s, "Bank")._id });
  const groupId = s.accountGroups.find((g) => g.name === "Cash")!._id;
  s = run(s, "accountGroups.update", { id: groupId, name: "Wallet" });
  s = run(s, "accountGroups.remove", { id: groupId });
  s = run(s, "accounts.setHidden", { id: cash, hidden: true });
  s = run(s, "settings.setDefaultAccount", { id: acc(s, "Bank")._id });

  expect(texts(s, "accounts")).toEqual([
    "Added HDFC (Bank account) in Bank accounts",
    "Edited HDFC: renamed to HDFC Savings, moved out of its group, opening balance ₹ 0.00 → ₹ 2,500.00",
    "Archived HDFC Savings",
    "Unarchived HDFC Savings",
    "Merged HDFC Savings into Bank (0 entries moved)",
    "Renamed group Cash to Wallet",
    "Deleted group Wallet; Cash moved to No group",
    "Hid Cash",
    "Made Bank the default payment method",
  ]);
  expect(texts(s, "categories")).toEqual([]);
});

test("category changes are written to their own history", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  s = run(s, "categories.create", { type: "expense", name: "Coffee" });
  const coffee = s.categories.find((c) => c.name === "Coffee")!._id;
  const food = s.categories.find((c) => c.name === "Food")!._id;
  s = run(s, "categories.update", { id: coffee, name: "Cafés", parentId: food });
  s = run(s, "categories.setArchived", { ids: [food], archived: true });
  s = run(s, "categories.remove", { id: food });
  expect(texts(s, "categories")).toEqual([
    "Added expense category Coffee",
    "Renamed Coffee to Cafés",
    "Moved Cafés under Food",
    "Archived Food with subcategories",
    "Deleted Food and its subcategories Cafés",
  ]);
  expect(texts(s, "accounts")).toEqual([]);
});

test("reordering step by step leaves one line, and the history is capped", () => {
  let s = run(emptySnapshot(), "settings.completeOnboarding", { currency: "USD" });
  const ids = s.accountGroups.map((g) => g._id);
  s = run(s, "accountGroups.reorder", { ids: [...ids].reverse() }, 1_000_000);
  s = run(s, "accountGroups.reorder", { ids }, 1_060_000);
  expect(texts(s, "accounts")).toEqual(["Reordered groups"]);
  expect(s.history[0].at).toBe(1_060_000);
  // much later, it is a new line
  s = run(s, "accountGroups.reorder", { ids: [...ids].reverse() }, 1_060_000 + 3_600_000);
  expect(texts(s, "accounts")).toEqual(["Reordered groups", "Reordered groups"]);

  const cash = acc(s, "Cash")._id;
  for (let i = 0; i < HISTORY_MAX + 5; i++) s = applyOp(s, { id: `h${i}`, kind: "accounts.setHidden", args: { id: cash, hidden: i % 2 === 0 }, at: 10_000_000 + i * 60_000 }, ctx).snap;
  expect(s.history).toHaveLength(HISTORY_MAX);
  expect(texts(s, "accounts").at(-1)).toBe("Hid Cash");
});

test("every op that writes history declares the tables it needs", () => {
  for (const k of HISTORY_KINDS) expect(OP_TABLES[k], k).toEqual(expect.arrayContaining(["history", "settings"]));
});
