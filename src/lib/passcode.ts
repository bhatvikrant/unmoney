export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const KEY = "unmoney:unlockedAt";

export function markUnlocked() {
  sessionStorage.setItem(KEY, String(Date.now()));
}

export function isLocked(lockAfter: "always" | "5m" | "1h"): boolean {
  const at = Number(sessionStorage.getItem(KEY) ?? 0);
  if (!at) return true;
  const ms = lockAfter === "always" ? 0 : lockAfter === "5m" ? 5 * 60_000 : 60 * 60_000;
  if (ms === 0) return false; // "always" = every fresh app load; this session already unlocked
  return Date.now() - at > ms;
}

export function clearUnlock() {
  sessionStorage.removeItem(KEY);
}
