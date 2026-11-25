import { useEffect, useRef, useState } from "react";

// TypeScript ships the events but not the recogniser itself (Chrome and Safari only have it as webkit*)
type Recogniser = {
  lang: string;
  interimResults: boolean;
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
 * Speaking a sentence instead of typing it, with the browser's own speech recognition: the browser (or the
 * company that makes it) turns the voice into text, and this app only ever gets the text. `onText` gets the
 * words as they are heard, `onDone` the whole sentence once the person stops; `onError` the browser's reason
 * when it could not listen. `supported` is false where the browser has none (Firefox).
 */
export function useDictation(opts: { max: number; onText: (text: string) => void; onDone: (text: string) => void; onError: (code: string) => void }) {
  const cb = useRef(opts);
  useEffect(() => { cb.current = opts; });
  const rec = useRef<Recogniser | null>(null);
  const [listening, setListening] = useState(false);
  // leaving the screen mid-sentence: stop the mic and fill nothing in
  useEffect(() => () => { if (rec.current) { rec.current.onend = null; rec.current.abort(); } }, []);

  function toggle() {
    if (rec.current) { rec.current.stop(); return; }
    if (!Recognition) return;
    const r = new Recognition();
    let text = "";
    r.lang = navigator.language;
    r.interimResults = true;
    r.onresult = (e) => { text = heard(e.results, cb.current.max); cb.current.onText(text); };
    // silence and a tap on stop are not failures
    r.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") cb.current.onError(e.error); };
    r.onend = () => { rec.current = null; setListening(false); if (text) cb.current.onDone(text); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { rec.current = null; setListening(false); cb.current.onError("start"); }
  }

  return { supported: !!Recognition, listening, toggle };
}
