/**
 * Keeps Gmail refresh tokens unreadable at rest and signs the OAuth `state`. One 32-byte key,
 * GMAIL_TOKEN_KEY (base64), serves both: AES-256-GCM for the tokens, HMAC-SHA256 for the state.
 * Make one with `openssl rand -base64 32` and set it with `npx convex env set GMAIL_TOKEN_KEY`.
 */

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function keyBytes(): Uint8Array {
  const b64 = process.env.GMAIL_TOKEN_KEY;
  if (!b64) throw new Error("GMAIL_TOKEN_KEY is not set");
  const raw = fromB64(b64.trim());
  if (raw.length !== 32) throw new Error("GMAIL_TOKEN_KEY must be 32 bytes, base64");
  return raw;
}

/** Whether the key is configured, so the UI can say "not set up" instead of failing on connect. */
export function hasTokenKey(): boolean {
  try {
    keyBytes();
    return true;
  } catch {
    return false;
  }
}

async function aesKey(usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes() as BufferSource, "AES-GCM", false, [usage]);
}

export async function encryptText(text: string): Promise<{ enc: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey("encrypt"), textEnc.encode(text));
  return { enc: toB64(new Uint8Array(ct)), iv: toB64(iv) };
}

export async function decryptText(enc: string, iv: string): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, await aesKey("decrypt"), fromB64(enc) as BufferSource);
  return textDec.decode(pt);
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", keyBytes() as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** HMAC-SHA256 of `text`, base64url. */
export async function sign(text: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), textEnc.encode(text));
  return toB64Url(new Uint8Array(sig));
}

/** Whether `sig` is the signature of `text`, compared in constant time. */
export async function verify(text: string, sig: string): Promise<boolean> {
  const expected = await sign(text);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
