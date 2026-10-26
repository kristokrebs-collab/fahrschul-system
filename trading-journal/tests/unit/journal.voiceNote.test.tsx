/**
 * Spracheingabe für Notizfelder (F31): the microphone button under a note field. The browser's recogniser is replaced by a fake
 * (the real one is the vendor's service): a tap starts it, the interim text shows while it listens, every finished phrase is
 * appended word for word, the next tap stops; every state that cannot work says why (unsupported, denied, no speech, offline) and
 * leaves typing alone; the card says where the recognition happens and that nothing is recorded by the app. Also in the trade
 * editor's text fields.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_STRINGS, VoiceNote, joinNote } from "@/journal/editor/VoiceNote";

interface Alt {
  transcript: string;
}
class FakeRec {
  static last: FakeRec | null = null;
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: Alt }> }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  started = 0;
  stopped = 0;
  start(): void {
    this.started += 1;
    FakeRec.last = this;
  }
  stop(): void {
    this.stopped += 1;
  }
  abort(): void {}
}

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <textarea aria-label="Notiz" value={v} onChange={(e) => setV(e.target.value)} />
      <VoiceNote value={v} onChange={setV} label="Begründung" testId="voice" />
    </div>
  );
}

const say = (text: string, final: boolean): void => {
  act(() => FakeRec.last!.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: text } }] }));
};

beforeEach(() => {
  FakeRec.last = null;
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRec;
});
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  vi.restoreAllMocks();
});

describe("joinNote", () => {
  it("appends with one space, keeps what was said, ignores an empty phrase", () => {
    expect(joinNote("", "  Ich war ungeduldig ")).toBe("Ich war ungeduldig");
    expect(joinNote("Plan: Ausbruch", "ich war ungeduldig")).toBe("Plan: Ausbruch ich war ungeduldig");
    expect(joinNote("Zeile eins\n", "Zeile zwei")).toBe("Zeile eins\nZeile zwei");
    expect(joinNote("Text", "   ")).toBe("Text");
  });
});

describe("VoiceNote", () => {
  it("says where the recognition happens and that nothing is recorded, before any tap", () => {
    render(<Harness />);
    expect(screen.getByTestId("voice")).toHaveTextContent(VOICE_STRINGS.note);
    expect(screen.getByTestId("voice")).toHaveTextContent("Die App nimmt nichts auf und speichert kein Audio");
    expect(screen.getByTestId("voice-mic")).toHaveAttribute("aria-pressed", "false");
    expect(FakeRec.last).toBeNull();
  });

  it("a tap starts the recogniser in German; interim text shows while listening; a finished phrase is appended; a second tap stops", () => {
    render(<Harness initial="Plan: Range-Ausbruch." />);
    fireEvent.click(screen.getByTestId("voice-mic"));
    const rec = FakeRec.last!;
    expect(rec.started).toBe(1);
    expect(rec.lang).toBe("de-DE");
    expect(rec.continuous).toBe(false);
    act(() => rec.onstart?.());
    expect(screen.getByTestId("voice-mic")).toHaveAttribute("aria-pressed", "true");
    say("ich war", false);
    expect(screen.getByTestId("voice-state")).toHaveTextContent("Hört zu … „ich war“");
    expect((screen.getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe("Plan: Range-Ausbruch."); // nothing before the phrase is final
    say("ich war ungeduldig", true);
    expect((screen.getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe("Plan: Range-Ausbruch. ich war ungeduldig");
    fireEvent.click(screen.getByTestId("voice-mic"));
    expect(rec.stopped).toBe(1);
    expect(screen.getByTestId("voice-mic")).toHaveAttribute("aria-pressed", "false");
  });

  it("a second phrase goes after the first", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("voice-mic"));
    act(() => FakeRec.last!.onstart?.());
    say("erste Aussage", true);
    say("zweite Aussage", true);
    expect((screen.getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe("erste Aussage zweite Aussage");
  });

  it("typing keeps working: what is typed while listening is not overwritten by the phrase that follows", () => {
    render(<Harness initial="a" />);
    fireEvent.click(screen.getByTestId("voice-mic"));
    act(() => FakeRec.last!.onstart?.());
    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "a b" } });
    say("c", true);
    expect((screen.getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe("a b c");
  });

  it("a refused microphone, no speech and no network are named – and the field stays as it is", () => {
    render(<Harness initial="x" />);
    fireEvent.click(screen.getByTestId("voice-mic"));
    act(() => FakeRec.last!.onerror?.({ error: "not-allowed" }));
    expect(screen.getByTestId("voice-problem")).toHaveTextContent("Das Mikrofon ist gesperrt");
    fireEvent.click(screen.getByTestId("voice-mic"));
    act(() => FakeRec.last!.onerror?.({ error: "network" }));
    expect(screen.getByTestId("voice-problem")).toHaveTextContent("braucht eine Internetverbindung");
    fireEvent.click(screen.getByTestId("voice-mic"));
    act(() => FakeRec.last!.onerror?.({ error: "no-speech" }));
    expect(screen.getByTestId("voice-problem")).toHaveTextContent("nichts gehört");
    expect((screen.getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe("x");
  });

  it("a browser without speech recognition: a disabled button and the plain sentence", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    render(<Harness />);
    expect(screen.getByTestId("voice-mic")).toBeDisabled();
    expect(screen.getByTestId("voice-unsupported")).toHaveTextContent("Dieser Browser bietet keine Spracheingabe an – tippe die Notiz.");
    expect(screen.queryByTestId("voice-problem")).toBeNull();
  });
});
