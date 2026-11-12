import { describe, expect, it } from "vitest";
import { beforeSend, deviceProperties, stripQuery } from "./analytics";
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

  it("names the screen with ids taken out, as the superadmin dashboard does", () => {
    const at = (props: object) => beforeSend({ uuid: "1", event: "$pageview", properties: props } as unknown as CaptureResult)!.properties.screen;
    expect(at({ $pathname: "/t/k57abc123" })).toBe("t/:id");
    expect(at({ $pathname: "/" })).toBe("ledger");
    expect(at({ $current_url: "https://a.app/stats/2026-10?x=1" })).toBe("stats/:id");
    expect(at({})).toBeUndefined();
  });

  it("passes a dropped event through", () => {
    expect(beforeSend(null)).toBeNull();
  });
});

describe("deviceProperties", () => {
  it("splits devices the way the dashboard does", () => {
    expect(deviceProperties({ os: "iOS", browser: "Safari", formFactor: "tablet", standalone: true }))
      .toMatchObject({ display_mode: "installed", form_factor: "tablet", device_os: "iOS" });
    expect(deviceProperties({ os: "macOS", browser: "Chrome", formFactor: "desktop", standalone: false }))
      .toMatchObject({ display_mode: "browser", form_factor: "desktop", device_os: "macOS" });
  });
});
