import { expect, test } from "vitest";
import { heard } from "./dictation";

test("what was heard is one tidy line, cut to the sentence limit", () => {
  const results = [[{ transcript: " 450 swiggy  dinner" }, { transcript: "an alternative" }], [{ transcript: " hdfc yesterday " }]];
  expect(heard(results, 200)).toBe("450 swiggy dinner hdfc yesterday");
  expect(heard(results, 10)).toBe("450 swiggy");
  expect(heard([], 200)).toBe("");
});
