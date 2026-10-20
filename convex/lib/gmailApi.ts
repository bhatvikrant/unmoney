/**
 * The slice of Google's OAuth and Gmail REST APIs the sync uses, as plain fetch calls. Only
 * actions call this; message bodies never leave them. Read-only scope, nothing is ever written
 * to the mailbox.
 */
import { htmlToText, type Mail } from "../../shared/gmail/mail";

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** How much of a mail's text the parsers see. Receipts put the total early; footers are noise. */
export const MAX_TEXT = 4000;

/** The user revoked access, changed their password, or the token is otherwise dead: they must reconnect. */
export class GmailAuthError extends Error {}

function creds(): { id: string; secret: string } {
  const id = process.env.AUTH_GOOGLE_ID;
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!id || !secret) throw new Error("AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are not set");
  return { id, secret };
}

/** The consent page: offline access with a refresh token every time, and the user's sign-in address pre-filled. */
export function authUrl(opts: { redirectUri: string; state: string; loginHint?: string }): string {
  const p = new URLSearchParams({
    client_id: creds().id,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  if (opts.loginHint) p.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${p}`;
}

async function tokenCall(body: Record<string, string>): Promise<Record<string, unknown>> {
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.error ?? res.status);
    if (code === "invalid_grant") throw new GmailAuthError("Google no longer accepts the saved access. Reconnect Gmail.");
    throw new Error(`Google token call failed: ${code}`);
  }
  return json;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string }> {
  const json = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  return { accessToken: String(json.access_token), refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined };
}

/** A short-lived access token from the stored refresh token. Never stored. */
export async function accessToken(refreshToken: string): Promise<string> {
  const json = await tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
  return String(json.access_token);
}

/** Tells Google to forget the grant. Best effort: a token already dead is fine. */
export async function revoke(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
}

async function api<T>(token: string, path: string): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new GmailAuthError("Gmail refused the access token. Reconnect Gmail.");
  if (res.status === 429) throw new Error("Gmail rate limit reached; the next check will retry.");
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(`Gmail API ${path.split("?")[0]} failed: ${res.status}`);
  return { status: res.status, json };
}

export async function profile(token: string): Promise<{ email: string }> {
  const { json } = await api<{ emailAddress?: string }>(token, "/profile");
  if (!json.emailAddress) throw new Error("Gmail profile had no address");
  return { email: json.emailAddress };
}

/** Ids of the messages matching a Gmail search, newest first, up to `max`. */
export async function listMessageIds(token: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const p = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
    if (pageToken) p.set("pageToken", pageToken);
    const { json } = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${p}`);
    for (const m of json.messages ?? []) ids.push(m.id);
    pageToken = json.nextPageToken;
    if (!pageToken || !(json.messages ?? []).length) break;
  }
  return ids.slice(0, max);
}

type Part = { mimeType?: string; body?: { data?: string; size?: number }; parts?: Part[] };
type Message = { id: string; threadId: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } };

function decodeBody(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** The first text/plain and text/html bodies anywhere in the part tree. */
function bodies(part: Part | undefined, out: { plain?: string; html?: string } = {}): { plain?: string; html?: string } {
  if (!part) return out;
  const data = part.body?.data;
  if (data && part.mimeType === "text/plain" && !out.plain) out.plain = decodeBody(data);
  else if (data && part.mimeType === "text/html" && !out.html) out.html = decodeBody(data);
  for (const p of part.parts ?? []) bodies(p, out);
  return out;
}

/** Quoted replies and signatures are not the transaction. */
function trimQuoted(text: string): string {
  const cut = text.search(/^(?:On .{0,120} wrote:|-{2,}\s*Original Message|From: .+\n(?:Sent|Date): )/m);
  const body = cut > 200 ? text.slice(0, cut) : text;
  return body.split("\n").filter((l) => !l.startsWith(">")).join("\n");
}

/** One mail, reduced to what the parsers need; the body is capped and never stored. */
export async function getMail(token: string, id: string): Promise<Mail> {
  const { json } = await api<Message>(token, `/messages/${id}?format=full`);
  const header = (name: string) => json.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const { plain, html } = bodies(json.payload);
  const raw = plain?.trim() ? plain : html ? htmlToText(html) : "";
  return {
    id: json.id,
    threadId: json.threadId,
    from: header("from"),
    subject: header("subject"),
    receivedAt: Number(json.internalDate ?? Date.now()),
    text: trimQuoted(raw).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT),
  };
}
