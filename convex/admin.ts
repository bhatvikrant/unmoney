/**
 * The superadmin dashboard's backend (src/pages/admin, shared/admin.ts). Every public function here
 * answers only the superadmin; everyone else is refused. Read-only: it counts what users keep and do,
 * never returns amounts, notes or names of anything in a ledger.
 */
import { v } from "convex/values";
import { getDocumentSize } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { currentUserId, type AnyCtx } from "./lib/auth";
import { dayAt, hourAt, isSuperadmin } from "../shared/admin";

export async function requireSuperadmin(ctx: AnyCtx): Promise<Id<"users">> {
  const id = await currentUserId(ctx);
  const user = id && (await ctx.db.get(id));
  if (!user || !isSuperadmin(user.email)) throw new Error("Not allowed");
  return id;
}

/** Daily rows read at most by one overview; past it the range is cut short and the page says so. */
const DAILY_LIMIT = 15_000;

/** Everything the dashboard charts for days `from`…`to` (device-local YYYY-MM-DD). The page filters and sums it. */
export const overview = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    await requireSuperadmin(ctx);
    const users = (await ctx.db.query("users").collect()).map((u) => ({ id: u._id, name: u.name ?? null, email: u.email ?? null, image: u.image ?? null, joinedAt: u._creationTime }));
    const devices = (await ctx.db.query("usageDevices").collect()).map(({ _id, _creationTime, ...d }) => d);
    const daily = (await ctx.db.query("usageDaily").withIndex("by_day", (q) => q.gte("day", from).lte("day", to)).take(DAILY_LIMIT + 1))
      .map(({ _id, _creationTime, ...d }) => d);
    const stats = (await ctx.db.query("adminStats").collect()).map(({ _id, _creationTime, ...s }) => s);
    // a row per user, day and feature that used Claude: few next to the usage rows
    const ai = (await ctx.db.query("aiDaily").withIndex("by_day", (q) => q.gte("day", from).lte("day", to)).take(DAILY_LIMIT))
      .map(({ _id, _creationTime, ...d }) => d);
    return { users, devices, daily: daily.slice(0, DAILY_LIMIT), truncated: daily.length > DAILY_LIMIT, stats, ai, now: Date.now() };
  },
});

/** One user's latest sessions, newest first, for the drill-down. */
export const userSessions = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    await requireSuperadmin(ctx);
    const rows = await ctx.db.query("usageSessions").withIndex("by_user_started", (q) => q.eq("userId", userId)).order("desc").take(Math.min(limit ?? 50, 200));
    return rows.map(({ _id, _creationTime, userId: _u, ...s }) => s);
  },
});

/** "Refresh now": count everyone's documents again, in the background. */
export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    await requireSuperadmin(ctx);
    await ctx.scheduler.runAfter(0, internal.admin.refreshStats, {});
  },
});

// ---- counting what each user keeps (daily cron, or "Refresh now") ----

/**
 * The tables counted per user, each with an index that starts with userId. Auth tables are counted
 * separately (signIns); usage tables are the dashboard's own and left out of "storage".
 */
const COUNTED = {
  settings: "by_user", accountGroups: "by_user", accounts: "by_user", categories: "by_user_rev", transactions: "by_user_date",
  repeats: "by_user", bookmarks: "by_user", budgets: "by_user", notes: "by_user_date", currencies: "by_user",
  categoryCleanups: "by_user", history: "by_user", drafts: "by_user", importLinks: "by_user", pendingImports: "by_user",
  fileOwners: "by_user", aiUsage: "by_user", syncState: "by_user", tombstones: "by_user_rev", syncOps: "by_user_op",
  gmailConnections: "by_user", gmailSeen: "by_user_message",
} as const satisfies Partial<Record<TableNames, string>>;
type Counted = keyof typeof COUNTED;
const countedArg = v.union(...(Object.keys(COUNTED) as Counted[]).map((t) => v.literal(t)));

/** Entries per page: each is one bounded read. */
const PAGE = 1000;
/** How far back "entries created per day" goes. */
const DAYS_KEPT = 365;

/**
 * One page of a user's documents in one table, counted: how many, their size, and tallies keyed
 * "<what>:<value>" that the action sums across pages.
 */
export const countPage = internalQuery({
  args: { userId: v.id("users"), table: countedArg, tzOffset: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { userId, table, tzOffset, paginationOpts }) => {
    // every COUNTED index begins with userId; the table-by-table types are more than this needs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (ctx.db.query(table) as any).withIndex(COUNTED[table], (q: any) => q.eq("userId", userId));
    const res = await q.paginate(paginationOpts) as { page: Doc<Counted>[]; isDone: boolean; continueCursor: string };
    const tally: Record<string, number> = {};
    const add = (k: string, n = 1) => { tally[k] = (tally[k] ?? 0) + n; };
    let bytes = 0;
    let firstEntryDate: string | undefined;
    const since = Date.now() - DAYS_KEPT * 86_400_000;
    for (const d of res.page) {
      bytes += getDocumentSize(d);
      if (table === "transactions") {
        const t = d as Doc<"transactions">;
        if (!firstEntryDate || t.date < firstEntryDate) firstEntryDate = t.date;
        add(t.source ? "src:gmail" : t.importId ? "src:imported" : t.repeatId ? "src:repeat" : "src:manual");
        if (t.split) add("src:split");
        if (t.photoIds.length) add("src:withPhotos");
        if (t.type === "transfer") add("src:transfers");
        if (t._creationTime >= since) add(`day:${dayAt(t._creationTime, tzOffset)}`);
        add(`hour:h${hourAt(t._creationTime, tzOffset)}`);
      } else if (table === "accounts") {
        const a = d as Doc<"accounts">;
        if (!a.deletedAt && !a.system) add(`kind:${a.kind ?? "other"}`);
      } else if (table === "drafts") {
        const r = d as Doc<"drafts">;
        add(`draft:${r.status}`);
        add(`draft:${r.how}`);
      } else if (table === "syncOps") {
        add(`op:${(d as Doc<"syncOps">).status}`);
      } else if (table === "repeats") {
        const r = d as Doc<"repeats">;
        if (r.active) add(r.kind === "installment" ? "feat:installments" : "feat:repeats");
      } else if (table === "fileOwners") {
        const f = await ctx.db.system.get((d as Doc<"fileOwners">).storageId);
        if (f) { add("file:count"); add("file:bytes", f.size); }
      } else if (table === "currencies") {
        add("feat:subCurrencies");
      }
    }
    return { count: res.page.length, bytes, tally, firstEntryDate, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});

/** What is read once per user, not a page at a time. */
export const userBasics = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const settings = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    const gmail = await ctx.db.query("gmailConnections").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect();
    const device = (await ctx.db.query("usageDevices").withIndex("by_user_device", (q) => q.eq("userId", userId)).collect())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
    return {
      settings: settings && {
        mainCurrency: settings.mainCurrency, theme: settings.theme, accent: settings.accent, startScreen: settings.startScreen,
        passcode: !!settings.passcodeHash, subcategories: settings.subcategoryEnabled, carryOver: settings.carryOver,
        timeInput: settings.timeInputEnabled, imports: settings.recentImports?.length ?? 0, onboarded: settings.onboarded,
        sips: settings.sips?.length ?? 0,
      },
      gmail: gmail && { status: gmail.status, aiCalls: gmail.aiCalls, aiMonth: gmail.aiMonth, lastSyncAt: gmail.lastSyncAt, hasError: !!gmail.lastError, senders: gmail.senders.length, backfill: !!gmail.backfill },
      signIns: sessions.length,
      lastSignInAt: sessions.reduce<number | undefined>((m, s) => Math.max(m ?? 0, s._creationTime), undefined),
      // the user's own clock, for "created per day / hour"; India's when they never reported one
      tzOffset: device?.tzOffset ?? 330,
    };
  },
});

export const userIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("users").collect()).map((u) => u._id),
});

const statsValidator = {
  tables: v.record(v.string(), v.object({ count: v.number(), bytes: v.number() })),
  files: v.object({ count: v.number(), bytes: v.number() }),
  entries: v.object({ manual: v.number(), gmail: v.number(), imported: v.number(), repeat: v.number(), split: v.number(), withPhotos: v.number(), transfers: v.number() }),
  createdByDay: v.record(v.string(), v.number()),
  createdByHour: v.record(v.string(), v.number()),
  firstEntryDate: v.optional(v.string()),
  features: v.record(v.string(), v.boolean()),
  prefs: v.record(v.string(), v.string()),
  accountKinds: v.record(v.string(), v.number()),
  gmail: v.optional(v.object({
    status: v.string(), aiCalls: v.number(), aiMonth: v.string(), lastSyncAt: v.optional(v.number()), hasError: v.boolean(), senders: v.number(),
    drafts: v.object({ open: v.number(), accepted: v.number(), dismissed: v.number(), rule: v.number(), ai: v.number() }),
  })),
  syncOps: v.object({ applied: v.number(), rejected: v.number() }),
  signIns: v.number(),
  lastSignInAt: v.optional(v.number()),
};

export const saveStats = internalMutation({
  args: { userId: v.id("users"), stats: v.object(statsValidator) },
  handler: async (ctx, { userId, stats }) => {
    // deleted while being counted: nothing of theirs is written back
    if (!(await ctx.db.get(userId))) return;
    const row = await ctx.db.query("adminStats").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const doc = { userId, computedAt: Date.now(), ...stats };
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("adminStats", doc);
  },
});

/** Count every user's documents again and store the result in adminStats. */
export const refreshStats = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const userId of await ctx.runQuery(internal.admin.userIds, {})) {
      const basics = await ctx.runQuery(internal.admin.userBasics, { userId });
      const tables: Record<string, { count: number; bytes: number }> = {};
      const tally: Record<string, number> = {};
      let firstEntryDate: string | undefined;
      for (const table of Object.keys(COUNTED) as Counted[]) {
        let cursor: string | null = null;
        const sum = { count: 0, bytes: 0 };
        for (;;) {
          const page: { count: number; bytes: number; tally: Record<string, number>; firstEntryDate?: string; isDone: boolean; continueCursor: string } =
            await ctx.runQuery(internal.admin.countPage, { userId, table, tzOffset: basics.tzOffset, paginationOpts: { numItems: PAGE, cursor } });
          sum.count += page.count;
          sum.bytes += page.bytes;
          for (const [k, n] of Object.entries(page.tally)) tally[k] = (tally[k] ?? 0) + n;
          if (page.firstEntryDate && (!firstEntryDate || page.firstEntryDate < firstEntryDate)) firstEntryDate = page.firstEntryDate;
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
        tables[table] = sum;
      }
      const pick = (prefix: string) => Object.fromEntries(Object.entries(tally).filter(([k]) => k.startsWith(prefix)).map(([k, n]) => [k.slice(prefix.length), n]));
      const src = pick("src:");
      const draft = pick("draft:");
      const op = pick("op:");
      const count = (t: Counted) => tables[t]?.count ?? 0;
      const s = basics.settings;
      await ctx.runMutation(internal.admin.saveStats, {
        userId,
        stats: {
          tables,
          files: { count: tally["file:count"] ?? 0, bytes: tally["file:bytes"] ?? 0 },
          entries: { manual: src.manual ?? 0, gmail: src.gmail ?? 0, imported: src.imported ?? 0, repeat: src.repeat ?? 0, split: src.split ?? 0, withPhotos: src.withPhotos ?? 0, transfers: src.transfers ?? 0 },
          createdByDay: pick("day:"),
          createdByHour: pick("hour:"),
          firstEntryDate,
          features: {
            budgets: count("budgets") > 0,
            repeats: !!tally["feat:repeats"],
            installments: !!tally["feat:installments"],
            bookmarks: count("bookmarks") > 0,
            notes: count("notes") > 0,
            subCurrencies: !!tally["feat:subCurrencies"],
            photos: (src.withPhotos ?? 0) > 0,
            imports: (src.imported ?? 0) > 0 || (s?.imports ?? 0) > 0,
            unsplit: (src.split ?? 0) > 0,
            gmail: !!basics.gmail,
            gmailBackfill: !!basics.gmail?.backfill,
            sips: (s?.sips ?? 0) > 0,
            aiTidy: count("aiUsage") > 0,
            tidyUp: count("categoryCleanups") > 0,
            iphoneShortcut: count("importLinks") > 0,
            passcode: !!s?.passcode,
            subcategories: !!s?.subcategories,
            carryOver: !!s?.carryOver,
            timeInput: !!s?.timeInput,
            onboarded: !!s?.onboarded,
          },
          prefs: s ? { currency: s.mainCurrency, theme: s.theme, accent: s.accent, startScreen: s.startScreen } : {},
          accountKinds: pick("kind:"),
          gmail: basics.gmail ? {
            status: basics.gmail.status, aiCalls: basics.gmail.aiCalls, aiMonth: basics.gmail.aiMonth, lastSyncAt: basics.gmail.lastSyncAt,
            hasError: basics.gmail.hasError, senders: basics.gmail.senders,
            drafts: { open: draft.open ?? 0, accepted: draft.accepted ?? 0, dismissed: draft.dismissed ?? 0, rule: draft.rule ?? 0, ai: draft.ai ?? 0 },
          } : undefined,
          syncOps: { applied: op.applied ?? 0, rejected: op.rejected ?? 0 },
          signIns: basics.signIns,
          lastSignInAt: basics.lastSignInAt,
        },
      });
    }
  },
});
