import { assertMockOnly, type IntegrationMode } from "../types.js";

/**
 * Transkriptions-Hook-Point für das Sprachprotokoll (apps/instructor,
 * Prompt 3). GAP (siehe docs/integration-gaps.md): kein echter
 * Speech-to-Text-Anbieter in dieser Sandbox verfügbar. Der Mock-Adapter
 * liefert einen deterministischen Platzhaltertext, damit die
 * Sprachprotokoll-UI vollständig durchgetestet werden kann, OHNE eine
 * "funktionierende Live-Transkription" zu behaupten.
 */
export interface TranscriptionResult {
  transcript: string;
  providerName: string;
}

export interface TranscriptionAdapter {
  mode: IntegrationMode;
  transcribe(audioReferenceOrNote: string): Promise<TranscriptionResult>;
}

export class MockTranscriptionAdapter implements TranscriptionAdapter {
  mode: IntegrationMode = "mock";

  async transcribe(audioReferenceOrNote: string): Promise<TranscriptionResult> {
    // GAP: KEIN echtes Speech-to-Text. Gibt die Eingabe (z. B. vom
    // Fahrlehrer bereits als Text diktierte Notiz) unverändert als
    // "Transkript" zurück, sodass die Schritte "Original anzeigen" /
    // "Fahrlehrer bearbeitet" trotzdem sinnvoll testbar sind.
    return { transcript: audioReferenceOrNote, providerName: "mock-passthrough" };
  }
}

export function createTranscriptionAdapter(mode: IntegrationMode): TranscriptionAdapter {
  assertMockOnly(mode, "Transkription");
  return new MockTranscriptionAdapter();
}
