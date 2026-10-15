/**
 * Import links: how an iPhone gets a Money Manager export into UnMoney without the file picker.
 * iOS gives home-screen web apps no share-sheet entry, so a Shortcut in the share sheet posts the
 * file to POST /import/<token> on the Convex site. The file waits in pendingImports until the
 * user reviews and imports it in the app, so a leaked link can only drop files into that inbox.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, httpAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib/auth";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PENDING = 10;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Makes a fresh import link for the signed-in user and returns it. The token is shown only now. */
export const createLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string; createdAt: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const token = newToken();
    const createdAt = Date.now();
    await ctx.runMutation(internal.imports.storeLink, { userId, tokenHash: await sha256(token), createdAt });
    return { url: `${process.env.CONVEX_SITE_URL}/import/${token}`, createdAt };
  },
});

export const storeLink = internalMutation({
  args: { userId: v.id("users"), tokenHash: v.string(), createdAt: v.number() },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("importLinks").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect();
    for (const o of old) await ctx.db.delete(o._id);
    await ctx.db.insert("importLinks", args);
  },
});

/** When the current link was made, or null if there is none. */
export const linkStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const link = await ctx.db.query("importLinks").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    return link ? { createdAt: link.createdAt } : null;
  },
});

export const revokeLink = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const links = await ctx.db.query("importLinks").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    for (const l of links) await ctx.db.delete(l._id);
  },
});

export const userForToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const link = await ctx.db.query("importLinks").withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    return link?.userId ?? null;
  },
});

export const addPending = internalMutation({
  args: { userId: v.id("users"), storageId: v.id("_storage"), name: v.string(), size: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("pendingImports", args);
    // Keep the inbox small: drop the oldest beyond the cap.
    const all = await ctx.db.query("pendingImports").withIndex("by_user", (q) => q.eq("userId", args.userId)).order("desc").collect();
    for (const old of all.slice(MAX_PENDING)) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
  },
});

/** Files waiting to be reviewed, newest first, with a URL to download each. */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db.query("pendingImports").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").collect();
    return Promise.all(rows.map(async (r) => ({ _id: r._id, name: r.name, size: r.size, at: r._creationTime, url: await ctx.storage.getUrl(r.storageId) })));
  },
});

/** Removes a waiting file, after it was imported or when the user discards it. */
export const discardPending = mutation({
  args: { id: v.id("pendingImports") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) return;
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(id);
  },
});

const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * POST /import/<token>, from the Shortcut. The body is the file itself, or multipart form data
 * with the file in any field. The reply is plain text the Shortcut shows to the user.
 */
export const receive = httpAction(async (ctx, req) => {
  const token = new URL(req.url).pathname.split("/").filter(Boolean)[1] ?? "";
  const userId = token ? await ctx.runQuery(internal.imports.userForToken, { tokenHash: await sha256(token) }) : null;
  if (!userId) return text("This import link no longer works. In UnMoney, open More › Import from Money Manager and set up the shortcut again.", 401);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return text("That file is too big to import (15 MB at most).", 413);

  let file: Blob | null = null;
  let name = req.headers.get("x-filename") ?? "";
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    for (const value of form.values()) {
      if (typeof value !== "string") {
        file = value;
        name ||= (value as File).name ?? "";
        break;
      }
    }
  } else {
    file = await req.blob();
  }
  if (!file || file.size === 0) return text("No file came through. Share the Excel file from Money Manager's export to this shortcut.", 400);
  if (file.size > MAX_BYTES) return text("That file is too big to import (15 MB at most).", 413);

  const storageId = await ctx.storage.store(file);
  await ctx.runMutation(internal.imports.addPending, { userId, storageId, name: name.trim() || "Money Manager export.xlsx", size: file.size });
  return text("Sent to UnMoney. Open UnMoney to review and import it.");
});
