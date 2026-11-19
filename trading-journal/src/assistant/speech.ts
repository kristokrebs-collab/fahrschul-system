/**
 * Voice for the assistant (F74): speech input through the browser's own recognition (`SpeechRecognition`, Chrome /
 * Edge / Samsung Internet / Safari) and optional read-aloud through `speechSynthesis`. No audio is recorded or stored by
 * the app, nothing runs in the background: recognition starts on a tap, stops on the next tap, on a pause in speech or
 * on `stop()`. The recogniser itself is the browser's service – on Chromium browsers it is the vendor's cloud
 * recogniser, which the UI says before the first use. Without support, permission or network the state says why and
 * typing stays available.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface RecAlt {
  transcript: string;
}
interface RecResult {
  isFinal: boolean;
  0: RecAlt;
}
interface RecEvent {
  resultIndex: number;
  results: ArrayLike<RecResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Does this browser offer speech recognition at all? */
export const speechInputSupported = (): boolean => ctor() !== null;

export type SpeechState = "idle" | "starting" | "listening" | "unsupported" | "denied" | "nospeech" | "nomic" | "network" | "error";

/** German explanation of a state (null = nothing to say). */
export function speechMessage(s: SpeechState): string | null {
  switch (s) {
    case "unsupported":
      return "Dieser Browser kann nicht zuhören. Tippe deine Frage – oder öffne das Journal in Chrome, Edge oder Safari.";
    case "denied":
      return "Das Mikrofon ist gesperrt. Erlaube es in den Seiteneinstellungen deines Browsers und versuche es noch einmal.";
    case "nospeech":
      return "Ich habe nichts gehört. Tippe aufs Mikrofon und sprich gleich los.";
    case "nomic":
      return "Es wurde kein Mikrofon gefunden.";
    case "network":
      return "Die Spracherkennung deines Browsers braucht eine Internetverbindung und ist gerade nicht erreichbar.";
    case "error":
      return "Die Spracherkennung ist ausgefallen. Tippen funktioniert weiterhin.";
    default:
      return null;
  }
}

/** Maps a `SpeechRecognition` error code to a state. */
export function stateOfError(code: string): SpeechState {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "nospeech";
    case "audio-capture":
      return "nomic";
    case "network":
      return "network";
    case "aborted":
      return "idle";
    default:
      return "error";
  }
}

export interface SpeechInput {
  state: SpeechState;
  /** interim text while listening (the final text is delivered once through `onFinal`) */
  interim: string;
  supported: boolean;
  /** toggles: starts listening, or stops it */
  toggle(): void;
  stop(): void;
}

/** Push-to-talk speech input; `onFinal(text)` receives each finished phrase. */
export function useSpeechInput(onFinal: (text: string) => void, lang = "de-DE"): SpeechInput {
  const [state, setState] = useState<SpeechState>(() => (speechInputSupported() ? "idle" : "unsupported"));
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  useEffect(() => {
    finalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onresult = r.onerror = r.onend = r.onstart = null;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
    setInterim("");
    setState((s) => (s === "listening" || s === "starting" ? "idle" : s));
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(() => {
    if (rec.current) return stop();
    const C = ctor();
    if (!C) return setState("unsupported");
    const r = new C();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => setState("listening");
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0].transcript;
        if (res.isFinal) finalRef.current(text.trim());
        else live += text;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      rec.current = null;
      setInterim("");
      setState(stateOfError(e.error));
    };
    r.onend = () => {
      rec.current = null;
      setInterim("");
      setState((s) => (s === "listening" || s === "starting" ? "idle" : s));
    };
    rec.current = r;
    setState("starting");
    try {
      r.start();
    } catch {
      rec.current = null;
      setState("error");
    }
  }, [lang, stop]);

  return { state, interim, supported: speechInputSupported(), toggle, stop };
}

/* ------------------------------------------------------------------ read aloud */

export const speechOutputSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

/** Reads `text` aloud in German (cancels anything still speaking). */
export function speak(text: string, rate = 1): void {
  if (!speechOutputSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 900));
  u.lang = "de-DE";
  u.rate = rate;
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("de"));
  if (voice) u.voice = voice;
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
