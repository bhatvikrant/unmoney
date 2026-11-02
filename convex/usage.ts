/**
 * Usage counts for the superadmin dashboard (shared/admin.ts). The app reports each session's running
 * totals (src/lib/usage.ts); a ping adds only what grew since the last one, so a retried or repeated
 * ping counts nothing twice. Server-only tables, never synced to devices.
 */
import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentUserId } from "./lib/auth";
import { lengthBucket } from "../shared/admin";

const counts = { activeMs: v.number(), bytesDown: v.number(), bytesUp: v.number(), photoFetches: v.number(), opsSent: v.number() };
type Counts = { activeMs: number; bytesDown: number; bytesUp: number; photoFetches: number; opsSent: number };
const COUNT_KEYS = ["activeMs", "bytesDown", "bytesUp", "photoFetches", "opsSent"] as const;

/** Sessions are kept this long for the per-user drill-down; the daily sums stay. */
const SESSION_TTL_MS = 120 * 24 * 60 * 60 * 1000;
const PRUNE_BATCH = 500;

const clip = (s: string, n = 40) => s.slice(0, n);
const bump = (r: Record<string, number>, k: string, by = 1) => ({ ...r, [k]: (r[k] ?? 0) + by });

export const ping = mutation({
  args: {
    sessionId: v.string(),
    deviceId: v.string(),
    /** The device's local day and hour when the session began. */
    day: v.string(),
    hour: v.number(),
    startedAt: v.number(),
    tzOffset: v.number(),
    os: v.string(),
    browser: v.string(),
    formFactor: v.union(v.literal("phone"), v.literal("tablet"), v.literal("desktop")),
    standalone: v.boolean(),
    appVersion: v.string(),
    totals: v.object(counts),
    screens: v.record(v.string(), v.number()),
  },
  handler: async (ctx, a) => {
    const userId = await currentUserId(ctx);
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(a.day)) return;
    const now = Date.now();
    const deviceId = clip(a.deviceId, 64);
    const device = { os: clip(a.os), browser: clip(a.browser), formFactor: a.formFactor, standalone: a.standalone, appVersion: clip(a.appVersion), tzOffset: Math.round(a.tzOffset), lastSeenAt: now };

    let session = await ctx.db.query("usageSessions").withIndex("by_session", (q) => q.eq("sessionId", a.sessionId)).unique();
    if (session && session.userId !== userId) return;
    const isNew = !session;
    const before: Counts = session ?? { activeMs: 0, bytesDown: 0, bytesUp: 0, photoFetches: 0, opsSent: 0 };
    // a session cannot have been on screen longer than it has existed
    const totals: Counts = { ...a.totals, activeMs: Math.min(a.totals.activeMs, Math.max(0, now - (session?.startedAt ?? a.startedAt))) };
    const delta = Object.fromEntries(COUNT_KEYS.map((k) => [k, Math.max(0, Math.round(totals[k] - before[k]))])) as Counts;
    const screens: Record<string, number> = {};
    for (const [k, n] of Object.entries(a.screens).slice(0, 100)) {
      const d = Math.round(n - (session?.screens[k] ?? 0));
      if (d > 0) screens[clip(k, 60)] = d;
    }

    const known = await ctx.db.query("usageDevices").withIndex("by_user_device", (q) => q.eq("userId", userId).eq("deviceId", deviceId)).unique();
    if (known) await ctx.db.patch(known._id, { ...device, sessions: known.sessions + (isNew ? 1 : 0) });
    else await ctx.db.insert("usageDevices", { userId, deviceId, firstSeenAt: now, sessions: 1, ...device });

    if (session) {
      let seen = session.screens;
      for (const [k, n] of Object.entries(screens)) seen = bump(seen, k, n);
      await ctx.db.patch(session._id, { ...max(session, totals), lastSeenAt: now, appVersion: device.appVersion, screens: seen });
    } else {
      const id = await ctx.db.insert("usageSessions", { userId, deviceId, sessionId: clip(a.sessionId, 64), day: a.day, startedAt: Math.min(a.startedAt, now), lastSeenAt: now, ...max(before, totals), screens, appVersion: device.appVersion });
      session = (await ctx.db.get(id))!;
    }

    // everything a session does counts on the day it began
    const day = session.day;
    const rows = await ctx.db.query("usageDaily").withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day)).collect();
    const row = rows.find((r) => r.deviceId === deviceId);
    const oldBucket = isNew ? null : lengthBucket(before.activeMs);
    const newBucket = lengthBucket(Math.max(before.activeMs, totals.activeMs));
    let lengths = row?.lengths ?? {};
    if (oldBucket !== newBucket) {
      if (oldBucket && lengths[oldBucket]) lengths = bump(lengths, oldBucket, -1);
      lengths = bump(lengths, newBucket);
    }
    let rowScreens = row?.screens ?? {};
    for (const [k, n] of Object.entries(screens)) rowScreens = bump(rowScreens, k, n);
    const sums = Object.fromEntries(COUNT_KEYS.map((k) => [k, (row?.[k] ?? 0) + delta[k]])) as Counts;
    const opens = (row?.opens ?? 0) + (isNew ? 1 : 0);
    const hours = isNew ? bump(row?.hours ?? {}, `h${Math.min(23, Math.max(0, Math.floor(a.hour)))}`) : row?.hours ?? {};
    if (row) await ctx.db.patch(row._id, { ...sums, opens, hours, screens: rowScreens, lengths });
    else await ctx.db.insert("usageDaily", { userId, deviceId, day, ...sums, opens, hours, screens: rowScreens, lengths });
  },
});

function max(a: Counts, b: Counts): Counts {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, Math.max(a[k], Math.round(b[k]))])) as Counts;
}

/** Daily cron: drop sessions older than the TTL. */
export const pruneSessions = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - SESSION_TTL_MS;
    const old = await ctx.db.query("usageSessions").withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff)).take(PRUNE_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === PRUNE_BATCH) await ctx.scheduler.runAfter(0, internal.usage.pruneSessions, { cutoff });
  },
});
