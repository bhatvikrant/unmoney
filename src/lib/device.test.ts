import { expect, test } from "vitest";
import { describeDevice } from "./device";

test("an iPad asking for the desktop site is an iOS tablet, not a Mac", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  expect(describeDevice(mac, 5)).toEqual({ os: "iOS", browser: "Safari", formFactor: "tablet" });
  expect(describeDevice(mac, 0)).toEqual({ os: "macOS", browser: "Safari", formFactor: "desktop" });
});

test("phones and Android tablets", () => {
  expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1", 5))
    .toEqual({ os: "iOS", browser: "Chrome", formFactor: "phone" });
  expect(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", 5))
    .toEqual({ os: "Android", browser: "Chrome", formFactor: "tablet" });
});
