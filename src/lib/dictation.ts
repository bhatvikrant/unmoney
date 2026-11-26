import { useEffect, useRef, useState } from "react";

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

/** How long each wait may take, in ms: the browser's permission prompt, the first word, the next word, and the browser finishing once told to stop. */
export const WAIT = { prompt: 30_000, first: 8_000, more: 3_000, stop: 1_500 };

/**
 * One go at listening. Browsers cannot be relied on to say when it is over: iOS can go deaf with no error
 * and no end (WebKit bug 321436), and a go that never ended used to leave the mic button dead until a
 * reload. So every wait has a timer, and the go ends exactly once, at the browser's own end or when a timer
 * gives up on it; the recogniser is then let go of, and the next go gets a new one. `onEnd` gets what was
 * heard, or else the reason nothing was (none when the person stopped it themself). The function returned
 * stops early: the words so far still count, unless `drop` (leaving the screen).
 */
export function listen(Rec: Ctor, o: { lang: string; max: number; onText: (text: string) => void; onEnd: (text: string, error?: string) => void }): (drop?: boolean) => void {
  const r = new Rec();
  let text = "";
  let error: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;
  let over = false;
  const end = (report = true) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    // a late event from this go must not reach the next one
    r.onstart = r.onresult = r.onerror = r.onend = null;
    try { r.abort(); } catch { /* it never started */ }
    if (report) o.onEnd(text, text ? undefined : error);
  };
  const stop = (reason?: string) => {
    if (over || stopping) return;
    stopping = true;
    error ??= reason;
    clearTimeout(timer);
    // stop() asks the browser for the last words; it ends here anyway when the browser never answers
    timer = setTimeout(end, WAIT.stop);
    try { r.stop(); } catch { end(); }
  };
  const wait = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => stop("no-speech"), ms); };
  r.lang = o.lang;
  r.interimResults = true;
  r.onstart = () => { if (!stopping) wait(WAIT.first); };
  r.onresult = (e) => { text = heard(e.results, o.max); o.onText(text); if (!stopping) wait(WAIT.more); };
  // a tap on stop is not a failure, whatever the browser calls it afterwards
  r.onerror = (e) => { if (!stopping && e.error !== "aborted") error = e.error; };
  r.onend = () => end();
  try {
    r.start();
    wait(WAIT.prompt);
  } catch {
    error = "start";
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
    if (stop.current) { stop.current(); return; }
    if (!Recognition) return;
    setListening(true);
    stop.current = listen(Recognition, {
      lang: navigator.language,
      max: cb.current.max,
      onText: (text) => cb.current.onText(text),
      onEnd: (text, error) => {
        stop.current = null;
        setListening(false);
        if (text) cb.current.onDone(text);
        else if (error) cb.current.onError(error);
      },
    });
  }

  return { supported: !!Recognition, listening, toggle };
}
