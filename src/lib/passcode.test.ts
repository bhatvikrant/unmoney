import { expect, test } from "vitest";
import { hashPin, isOldSalt, newSalt } from "./passcode";

test("a passcode set before the slow hash still checks, and new ones use the slow hash", async () => {
  // one round of SHA-256 over "salt:pin", as every passcode was stored before
  expect(await hashPin("1234", "ab12")).toBe("04992417c7ca75a8135279050f3e9b8ef35b215f3f1a2e8543b479c046dd6d0e");
  expect(isOldSalt("ab12")).toBe(true);

  const salt = newSalt();
  expect(isOldSalt(salt)).toBe(false);
  const hash = await hashPin("1234", salt);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashPin("1234", salt)).toBe(hash);
  expect(await hashPin("1235", salt)).not.toBe(hash);
  expect(await hashPin("1234", newSalt())).not.toBe(hash);
});
