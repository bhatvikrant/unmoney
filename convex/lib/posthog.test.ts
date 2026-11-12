import { afterEach, describe, expect, it, vi } from "vitest";
import { framesOf, reportServerError } from "./posthog";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

describe("reportServerError", () => {
  it("sends nothing without a key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await reportServerError("gmail.syncUser", new Error("boom"), { userId: "u1" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends an $exception for the user, with where it happened", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await reportServerError("gmail.syncUser", new TypeError("bad mail"), { userId: "u1", context: { batch: 3 } });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      api_key: "phc_test", event: "$exception", distinct_id: "u1",
      properties: { $exception_list: [{ type: "TypeError", value: "bad mail" }], source: "convex", where: "gmail.syncUser", batch: 3 },
    });
    expect(body.properties.$process_person_profile).toBeUndefined();
  });

  it("files server jobs without a user under one id, with no person profile, at the chosen host", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com/";
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await reportServerError("crons", "not an Error");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body);
    expect(body.distinct_id).toBe("convex-server");
    expect(body.properties.$process_person_profile).toBe(false);
    expect(body.properties.$exception_list[0].value).toBe("not an Error");
  });

  it("never throws when PostHog is unreachable", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    await expect(reportServerError("ai", new Error("x"))).resolves.toBeUndefined();
  });
});

describe("framesOf", () => {
  it("reads V8 stack lines as raw frames, innermost call last", () => {
    const stack = [
      "Error: boom",
      "    at readMail (convex:/user/gmail.js:10:5)",
      "    at async handler (convex:/user/gmail.js:40:12)",
      "    at <anonymous> (node_modules/convex/dist/server.js:1:2)",
    ].join("\n");
    expect(framesOf(stack)).toEqual([
      { platform: "node:javascript", filename: "node_modules/convex/dist/server.js", function: "?", lineno: 1, colno: 2, in_app: false },
      { platform: "node:javascript", filename: "convex:/user/gmail.js", function: "async handler", lineno: 40, colno: 12, in_app: true },
      { platform: "node:javascript", filename: "convex:/user/gmail.js", function: "readMail", lineno: 10, colno: 5, in_app: true },
    ]);
  });
});
