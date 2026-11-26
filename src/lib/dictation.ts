import { useEffect, useRef, useState } from "react";
import { track } from "./analytics";
import { trace } from "./voiceTrace";

// TypeScript ships the events but not the recogniser itself (Chrome and Safari only have it as webkit*)
type Recogniser = {
  lang: string;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type Ctor = new () => Recogniser;

const Recognition = typeof window === "undefined" ? undefined : ((window as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }).SpeechRecognition ?? (window as { webkitSpeechRecognition?: Ctor }).webkitSpeechRecognition);

/** Everything heard so far as one line. */
export function heard(results: ArrayLike<ArrayLike<{ transcript: string }>>, max: number): string {
  return Array.from(results, (r) => r[0].transcript).join(" ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Safari's Audio Session API: what the page's sound is for. The iPhone home screen app kept the microphone
 * on after a go had ended by itself (the recording dot stayed lit until the app was closed). "ambient" is
 * sound that never records, so setting it makes the phone let go of the microphone; "auto" hands the
 * choice back to the browser, which records while it listens. Absent in other browsers.
 */
function audioSession(type?: "auto" | "ambient"): string {
  const a = typeof navigator === "undefined" ? undefined : (navigator as { audioSession?: { type: string; state?: string } }).audioSession;
  if (!a) return "none";
  try { if (type) a.type = type; } catch { /* not a kind this browser knows */ }
  return `${a.type}/${a.state}`;
}

/** How long each wait may take, in ms: the browser's permission prompt, the first word, the next word, and the browser finishing once told to stop. */
export const WAIT = { prompt: 30_000, first: 8_000, more: 3_000, stop: 1_500 };

/**
 * One go at listening. Browsers cannot be relied on to say when it is over: iOS can go deaf with no error
 * and no end (WebKit bug 321436), and a go that never ended used to leave the mic button dead until a
 * reload. So every wait has a timer, and the go ends exactly once, at the browser's own end or when a timer
 * gives up on it; the recogniser is then let go of, and the next go gets a new one. `onEnd` gets what was
 * heard, or else the reason nothing was (none when the person stopped it themself), and the steps the go
 * took (never the words), for telling one browser's way of failing from another's. The function returned
 * stops early: the words so far still count, unless `drop` (leaving the screen).
 */
export function listen(Rec: Ctor, o: { lang: string; max: number; onText: (text: string) => void; onEnd: (text: string, error: string | undefined, trail: string) => void }): (drop?: boolean) => void {
  audioSession("auto");
  const r = new Rec();
  let text = "";
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let over = false;
  const trail: string[] = [];
  const note = (step: string) => { if (trail.length < 40) trail.push(step); };
  const end = (report = true, byBrowser = false) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    // a late event from this go must not reach the next one
    r.onstart = r.onresult = r.onerror = r.onend = null;
    // a go the browser ended itself is left alone: on iOS, cutting goes short is reported to deafen later ones (WebKit bug 321436)
    if (!byBrowser) try { r.abort(); } catch { /* it never started */ }
    note(byBrowser ? "end" : "cut");
    note(`audio:${audioSession()}>${audioSession("ambient")}`);
    if (report) o.onEnd(text, text ? undefined : error, trail.join(" "));
  };
  const stop = (reason?: string) => {
    if (over || stopping) return;
    stopping = true;
    note(reason ? "quiet" : "tap");
    error ??= reason;
    clearTimeout(timer);
    // stop() asks the browser for the last words; it ends here anyway when the browser never answers
    timer = setTimeout(end, WAIT.stop);
    try { r.stop(); } catch { end(); }
  };
  const wait = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => stop("no-speech"), ms); };
  r.lang = o.lang;
  r.interimResults = true;
  r.onstart = () => { note("on"); if (!stopping) wait(WAIT.first); };
  r.onresult = (e) => {
    const now = heard(e.results, o.max);
    note(`r${now.length}`);
    // the iPhone app heard a sentence and then filled nothing in: a last result with no words in it, as
    // the go stops, must not take back the words already heard
    if (!now) return;
    text = now;
    o.onText(text);
    if (!stopping) wait(WAIT.more);
  };
  // a tap on stop is not a failure, whatever the browser calls it afterwards
  r.onerror = (e) => { note(`e:${e.error}`); if (!stopping && e.error !== "aborted") error = e.error; };
  r.onend = () => end(true, true);
  try {
    r.start();
    wait(WAIT.prompt);
  } catch {
    error = "start";
    note("throw");
    // not before the caller has the function returned below
    timer = setTimeout(end, 0);
  }
  return (drop) => (drop ? end(false) : stop());
}

/**
 * Speaking a sentence instead of typing it, with the browser's own speech recognition: the browser (or the
 * company that makes it) turns the voice into text, and this app only ever gets the text. `onText` gets the
 * words as they are heard, `onDone` the whole sentence once the person stops; `onError` the reason when
 * nothing was heard (the browser's code, or "start"). `supported` is false where the browser has none (Firefox).
 */
export function useDictation(opts: { max: number; onText: (text: string) => void; onDone: (text: string) => void; onError: (code: string) => void }) {
  const cb = useRef(opts);
  useEffect(() => { cb.current = opts; });
  const stop = useRef<((drop?: boolean) => void) | null>(null);
  const [listening, setListening] = useState(false);
  // leaving the screen mid-sentence: stop the mic and fill nothing in
  useEffect(() => () => stop.current?.(true), []);

  function toggle() {
    trace(`${stop.current ? "tap-stop" : "tap-start"}:audio:${audioSession()}`);
    if (stop.current) { stop.current(); return; }
    if (!Recognition) return;
    setListening(true);
    stop.current = listen(Recognition, {
      lang: navigator.language,
      max: cb.current.max,
      onText: (text) => cb.current.onText(text),
      onEnd: (text, error, trail) => {
        stop.current = null;
        setListening(false);
        // how each go went on which browser: its steps and the length of what was heard, never the words
        track("dictation", { outcome: text ? "heard" : error ?? "nothing", trail });
        trace(`ended:${text.length}:${error ?? ""}[${trail}]`);
        // temporary, with the trace: whether the phone has let go of the microphone a little later
        setTimeout(() => trace(`later:audio:${audioSession()}`), 5000);
        if (text) cb.current.onDone(text);
        else if (error) cb.current.onError(error);
      },
    });
  }

  return { supported: !!Recognition, listening, toggle };
}
