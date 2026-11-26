import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { heard, listen, WAIT } from "./dictation";

test("what was heard is one tidy line, cut to the sentence limit", () => {
  const results = [[{ transcript: " 450 swiggy  dinner" }, { transcript: "an alternative" }], [{ transcript: " hdfc yesterday " }]];
  expect(heard(results, 200)).toBe("450 swiggy dinner hdfc yesterday");
  expect(heard(results, 10)).toBe("450 swiggy");
  expect(heard([], 200)).toBe("");
});

/** A browser recogniser that does only what the test tells it to, like the ones that never end. */
class Fake {
  static made: Fake[] = [];
  static failStart = false;
  lang = "";
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  calls: string[] = [];
  constructor() { Fake.made.push(this); }
  start() { this.calls.push("start"); if (Fake.failStart) throw new Error("InvalidStateError"); }
  stop() { this.calls.push("stop"); }
  abort() { this.calls.push("abort"); }
  say(...words: string[]) { this.onresult?.({ results: words.map((transcript) => [{ transcript }]) } as unknown as SpeechRecognitionEvent); }
  fail(error: string) { this.onerror?.({ error } as SpeechRecognitionErrorEvent); }
}

/** Starts a go; `ends` collects what it reported. */
function go() {
  const ends: [string, string?][] = [];
  const texts: string[] = [];
  const trails: string[] = [];
  const stop = listen(Fake, { lang: "en-IN", max: 200, onText: (t) => texts.push(t), onEnd: (text, error, trail) => { ends.push([text, error]); trails.push(trail); } });
  return { r: Fake.made.at(-1)!, ends, texts, trails, stop };
}

beforeEach(() => { vi.useFakeTimers(); Fake.made = []; Fake.failStart = false; });
afterEach(() => { vi.useRealTimers(); });

test("a sentence, then the browser's own end: reported once, and the recogniser is let go of", () => {
  const { r, ends, texts, trails } = go();
  expect([r.lang, r.interimResults]).toEqual(["en-IN", true]);
  r.onstart!();
  r.say("450 swiggy");
  r.say("450 swiggy", "dinner");
  const end = r.onend!;
  end();
  expect(texts).toEqual(["450 swiggy", "450 swiggy dinner"]);
  expect(ends).toEqual([["450 swiggy dinner", undefined]]);
  // a go that ended by itself is not cut short on top of that
  expect(r.calls).toEqual(["start"]);
  expect(trails).toEqual(["on r10 r17 end"]);
  // a second end, a late result or a timer changes nothing
  end();
  expect([r.onstart, r.onresult, r.onerror, r.onend]).toEqual([null, null, null, null]);
  vi.advanceTimersByTime(60_000);
  expect(ends).toHaveLength(1);
});

test("a browser that goes deaf and never ends is given up on, and the next go works", () => {
  const first = go();
  first.r.onstart!();
  vi.advanceTimersByTime(WAIT.first - 1);
  expect(first.r.calls).toEqual(["start"]);
  vi.advanceTimersByTime(1);
  expect(first.r.calls).toEqual(["start", "stop"]);
  expect(first.ends).toEqual([]);
  vi.advanceTimersByTime(WAIT.stop);
  expect(first.r.calls).toEqual(["start", "stop", "abort"]);
  expect(first.ends).toEqual([["", "no-speech"]]);

  const second = go();
  expect(second.r).not.toBe(first.r);
  second.r.say("40 chai");
  second.r.onend!();
  expect(second.ends).toEqual([["40 chai", undefined]]);
  expect(first.ends).toHaveLength(1);
});

test("the permission prompt gets longer than the first word does", () => {
  const { r, ends } = go();
  vi.advanceTimersByTime(WAIT.prompt - 1);
  expect(r.calls).toEqual(["start"]);
  vi.advanceTimersByTime(1 + WAIT.stop);
  expect(ends).toEqual([["", "no-speech"]]);
});

test("words, then silence the browser never ends on: filled in with what was said", () => {
  const { r, ends } = go();
  r.onstart!();
  r.say("450 swiggy");
  vi.advanceTimersByTime(WAIT.more - 1);
  r.say("450 swiggy dinner");
  vi.advanceTimersByTime(WAIT.more - 1);
  expect(r.calls).toEqual(["start"]);
  vi.advanceTimersByTime(1);
  expect(r.calls).toEqual(["start", "stop"]);
  // the last words can still arrive while it stops
  r.say("450 swiggy dinner hdfc");
  vi.advanceTimersByTime(WAIT.stop);
  expect(ends).toEqual([["450 swiggy dinner hdfc", undefined]]);
});

test("a tap on stop ends it even when the browser never answers, and is not a failure", () => {
  const said = go();
  said.r.onstart!();
  said.r.say("40 chai");
  said.stop();
  said.stop();
  expect(said.r.calls).toEqual(["start", "stop"]);
  vi.advanceTimersByTime(WAIT.stop);
  expect(said.ends).toEqual([["40 chai", undefined]]);

  const silent = go();
  silent.r.onstart!();
  silent.stop();
  silent.r.fail("no-speech");
  silent.r.onend!();
  expect(silent.ends).toEqual([["", undefined]]);
});

test("a last result with no words in it, as the go stops, does not take back what was heard", () => {
  const { r, ends, texts, trails, stop } = go();
  r.onstart!();
  r.say("40 chai");
  stop();
  r.say("");
  r.say();
  r.onend!();
  expect(texts).toEqual(["40 chai"]);
  expect(ends).toEqual([["40 chai", undefined]]);
  expect(trails).toEqual(["on r7 tap r0 r0 end"]);

  // and one that only ever had such results heard nothing
  const empty = go();
  empty.r.onstart!();
  empty.r.say("");
  vi.advanceTimersByTime(WAIT.first - 1);
  expect(empty.ends).toEqual([]);
  vi.advanceTimersByTime(1 + WAIT.stop);
  expect(empty.ends).toEqual([["", "no-speech"]]);
  expect(empty.trails).toEqual(["on r0 quiet cut"]);
});

test("a blocked microphone and a recogniser that will not start are reported with their reason", () => {
  const blocked = go();
  blocked.r.fail("not-allowed");
  blocked.r.onend!();
  expect(blocked.ends).toEqual([["", "not-allowed"]]);

  Fake.failStart = true;
  const broken = go();
  // only once the caller holds the stop function
  expect(broken.ends).toEqual([]);
  vi.advanceTimersByTime(0);
  expect(broken.ends).toEqual([["", "start"]]);
});

test("leaving the screen stops the mic and reports nothing", () => {
  const { r, ends, stop } = go();
  r.onstart!();
  r.say("450 swiggy");
  stop(true);
  expect(r.calls).toEqual(["start", "abort"]);
  vi.advanceTimersByTime(60_000);
  expect(ends).toEqual([]);
});
