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

// ---- coming back to the app ----

const HIDDEN_KEY = "unmoney:hiddenAt";
/** "Every open" still allows a quick trip out, e.g. to the camera for a receipt photo. */
const AWAY_MS = { always: 10_000, "5m": 5 * 60_000, "1h": 60 * 60_000 } as const;

export function markHidden() {
  sessionStorage.setItem(HIDDEN_KEY, String(Date.now()));
}

/** Whether the app was in the background long enough to ask for the passcode again. */
export function awayTooLong(lockAfter: "always" | "5m" | "1h"): boolean {
  const at = Number(sessionStorage.getItem(HIDDEN_KEY) ?? 0);
  return at > 0 && Date.now() - at > AWAY_MS[lockAfter];
}

// ---- wrong guesses ----

const FAIL_KEY = "unmoney:pinFailures";
const FREE_TRIES = 5;

function failures(): { count: number; at: number } {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) ?? "") as { count: number; at: number };
  } catch {
    return { count: 0, at: 0 };
  }
}

/** Milliseconds until the next guess is allowed: 30 s after five wrong ones, doubling each time after. */
export function lockoutRemaining(): number {
  const { count, at } = failures();
  if (count < FREE_TRIES) return 0;
  const wait = 30_000 * 2 ** Math.min(count - FREE_TRIES, 6);
  return Math.max(0, at + wait - Date.now());
}

export function recordFailure() {
  const { count } = failures();
  localStorage.setItem(FAIL_KEY, JSON.stringify({ count: count + 1, at: Date.now() }));
}

export function clearFailures() {
  localStorage.removeItem(FAIL_KEY);
}

// ---- forgotten passcode ----

const RESET_KEY = "unmoney:resetPasscodeFor";

/** Forgot the passcode: remember to remove it once this user has signed in with Google again. */
export function requestPasscodeReset(userId: string) {
  localStorage.setItem(RESET_KEY, userId);
}

export function passcodeResetPendingFor(userId: string | null): boolean {
  return !!userId && localStorage.getItem(RESET_KEY) === userId;
}

export function clearPasscodeReset() {
  localStorage.removeItem(RESET_KEY);
  clearFailures();
}
