import { describe, expect, it } from "vitest";
import { beforeSend, stripQuery } from "./analytics";
import type { CaptureResult } from "posthog-js";

describe("stripQuery", () => {
  it("drops the query string and hash", () => {
    expect(stripQuery("https://unmoney.vikrantbhat.com/search?q=swiggy#x")).toBe("https://unmoney.vikrantbhat.com/search");
    expect(stripQuery("/stats#top")).toBe("/stats");
    expect(stripQuery("/stats")).toBe("/stats");
  });
});

describe("beforeSend", () => {
  it("cuts search terms from every URL the event carries, on the event and the person", () => {
    const event = {
      uuid: "1", event: "$pageview",
      properties: { $current_url: "https://a.app/search?q=rent", $referrer: "https://a.app/stats?period=2026-10", $pathname: "/search", other: "?q=kept" },
      $set: { $current_url: "https://a.app/t/1?from=gmail" },
      $set_once: { $initial_current_url: "https://a.app/?gmail=connected", $initial_referrer: "$direct" },
    } as unknown as CaptureResult;
    const out = beforeSend(event)!;
    expect(out.properties.$current_url).toBe("https://a.app/search");
    expect(out.properties.$referrer).toBe("https://a.app/stats");
    expect(out.properties.other).toBe("?q=kept");
    expect(out.$set!.$current_url).toBe("https://a.app/t/1");
    expect(out.$set_once!.$initial_current_url).toBe("https://a.app/");
    expect(out.$set_once!.$initial_referrer).toBe("$direct");
  });

  it("passes a dropped event through", () => {
    expect(beforeSend(null)).toBeNull();
  });
});
