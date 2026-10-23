import { afterEach, expect, test, vi } from "vitest";
import { listMessageIds, tidyBody } from "./gmailApi";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const limited = () => Response.json({ error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "rateLimitExceeded" }], details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } }, { status: 403 });
/** Every page of a listing, flattened. */
const all = async (pages: AsyncIterable<string[]>) => { const ids: string[] = []; for await (const p of pages) ids.push(...p); return ids; };

test("a rate-limited call backs off and retries until Gmail answers", async () => {
  vi.useFakeTimers();
  const answers = [limited(), new Response("{}", { status: 429 }), Response.json({ messages: [{ id: "a" }, { id: "b" }] })];
  const fetch = vi.fn(async () => answers.shift()!);
  vi.stubGlobal("fetch", fetch);
  const ids = all(listMessageIds("tok", "q"));
  await vi.runAllTimersAsync();
  expect(await ids).toEqual(["a", "b"]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("after five backoffs (over a minute) it gives up with a plain rate-limit error", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => limited());
  vi.stubGlobal("fetch", fetch);
  const ids = all(listMessageIds("tok", "q"));
  const outcome = expect(ids).rejects.toThrow(/rate limit reached/);
  await vi.runAllTimersAsync();
  await outcome;
  expect(fetch).toHaveBeenCalledTimes(6);
});

test("a 403 that is not a rate limit is not retried", async () => {
  const fetch = vi.fn(async () => Response.json({ error: { errors: [{ reason: "accessNotConfigured" }] } }, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  await expect(all(listMessageIds("tok", "q"))).rejects.toThrow(/not enabled/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a listing follows Gmail's page tokens to the end, and stops at an empty page", async () => {
  const answers = [
    Response.json({ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" }),
    Response.json({ messages: [{ id: "c" }], nextPageToken: "p3" }),
    Response.json({ nextPageToken: "p4" }),
  ];
  const fetch = vi.fn(async (_url: string) => answers.shift()!);
  vi.stubGlobal("fetch", fetch);
  expect(await all(listMessageIds("tok", "q"))).toEqual(["a", "b", "c"]);
  expect(fetch.mock.calls.map(([url]) => new URL(url).searchParams.get("pageToken"))).toEqual([null, "p2", "p3"]);
});

test("a mail's indentation and CRLFs are stripped, so the details fit within the cap", () => {
  const pad = " ".repeat(40);
  const raw = `13-10-2026 \r\n${`${pad}\r\n`.repeat(80)}${pad}Amount Credited: \r\n${pad}\r\n${pad}INR 598.00 \r\n${`${pad}\r\n`.repeat(60)}${pad}Transaction Info: \r\n${pad}UPI/P2A/529312345690/PRIYA MENON \r\n`;
  const text = tidyBody(raw.replace(/\r\n?/g, "\n"));
  expect(text.length).toBeLessThan(200);
  expect(text).toContain("Transaction Info:\nUPI/P2A/529312345690/PRIYA MENON");
});
