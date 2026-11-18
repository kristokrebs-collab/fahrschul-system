/**
 * Spracheingabe für ein Notizfeld (F31): a microphone button under a text field. A tap starts the browser's speech recognition,
 * every finished phrase is appended to the field word for word (nothing is corrected or summarised), the next tap – or a pause –
 * stops it. The recogniser is the BROWSER's service (on Chrome / Edge the vendor's cloud recogniser): the app records and stores
 * no audio, and the card says so on the spot. Without support, permission or network the reason is shown and typing stays as it is.
 */
import { chipClass } from "@/primitives/chip";
import { useEffect, useRef } from "react";
import { GlyphMic, GlyphStop } from "@/assistant/icons";
import { speechMessage, useSpeechInput } from "@/assistant/speech";

export const VOICE_STRINGS = {
  start: "Diktieren",
  stop: "Aufnahme beenden",
  listening: "Hört zu …",
  note: "Die Sprache erkennt der Dienst deines Browsers (bei Chrome und Edge über die Server des Herstellers). Die App nimmt nichts auf und speichert kein Audio; der Text landet unverändert im Feld.",
} as const;

/** The note with `add` appended: one space between, a new line when the note already ends with one; nothing is changed in `add`. */
export function joinNote(current: string, add: string): string {
  const a = add.trim();
  if (!a) return current;
  if (!current.trim()) return a;
  return `${current}${/\s$/.test(current) ? "" : " "}${a}`;
}

export function VoiceNote({ value, onChange, label, testId }: { value: string; onChange: (next: string) => void; label: string; testId: string }) {
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);
  const voice = useSpeechInput((text) => {
    const cur = latest.current;
    const next = joinNote(cur.value, text);
    if (next !== cur.value) cur.onChange(next);
  });
  const on = voice.state === "listening" || voice.state === "starting";
  const problem = voice.state === "unsupported" ? null : speechMessage(voice.state);
  return (
    <div className="grid gap-1" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={voice.toggle}
          disabled={!voice.supported}
          aria-pressed={on}
          aria-label={`${on ? VOICE_STRINGS.stop : VOICE_STRINGS.start}: ${label}`}
          data-testid={`${testId}-mic`}
          className={chipClass(on, { tone: "loss", className: "py-1 font-normal" })}
        >
          {on ? <GlyphStop className="size-[14px]" /> : <GlyphMic className="size-[14px]" />}
          {on ? VOICE_STRINGS.stop : VOICE_STRINGS.start}
        </button>
        {on && (
          <span className="text-[11.5px] text-mute" role="status" data-testid={`${testId}-state`}>
            {voice.interim ? `${VOICE_STRINGS.listening} „${voice.interim}“` : VOICE_STRINGS.listening}
          </span>
        )}
      </div>
      {problem && (
        <p className="text-[11.5px] leading-snug text-warn" role="status" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      )}
      {!voice.supported && (
        <p className="text-[11.5px] leading-snug text-mute" data-testid={`${testId}-unsupported`}>
          Dieser Browser bietet keine Spracheingabe an – tippe die Notiz.
        </p>
      )}
      <p className="text-[11px] leading-snug text-faint">{VOICE_STRINGS.note}</p>
    </div>
  );
}
