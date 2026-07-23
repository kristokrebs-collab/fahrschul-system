import { assertMockOnly, type IntegrationMode } from "../types.js";

/**
 * KI-Vorschlags-Hook-Point für das Sprachprotokoll (apps/instructor,
 * Prompt 3). GAP (siehe docs/integration-gaps.md): kein echter LLM-Anbieter
 * in dieser Sandbox verfügbar. Der Mock-Adapter liefert einfache,
 * regelbasierte Platzhaltervorschläge – NIEMALS ein automatisches
 * "Fahrlehrer-Go" oder eine Diagnose-/Charakter-/Motivations-/
 * Intelligenzbewertung (Spec-Vorgabe, siehe
 * packages/domain/src/instructor.ts KOMPETENZSTATUS, das absichtlich kein
 * solches Feld enthält). Die KI darf laut Aufgabenstellung ausschließlich
 * einen Hinweis/Vorschlag liefern, den der Fahrlehrer explizit bestätigen
 * muss (Schritt 6 im Sprachprotokoll-Fluss) – kein automatisches
 * Publizieren.
 */
export interface AiSuggestionResult {
  vorschlaege: Record<string, unknown>;
  providerName: string;
}

export interface AiSuggestionAdapter {
  mode: IntegrationMode;
  suggest(transcript: string): Promise<AiSuggestionResult>;
}

export class MockAiSuggestionAdapter implements AiSuggestionAdapter {
  mode: IntegrationMode = "mock";

  async suggest(transcript: string): Promise<AiSuggestionResult> {
    // GAP: KEIN echter LLM-Aufruf. Liefert nur den unveränderten Transkript
    // gespiegelt als "zusammenfassungsVorschlag", damit der
    // Fahrlehrer-UI-Fluss (Vorschlag anzeigen -> Fahrlehrer bearbeitet ->
    // Fahrlehrer bestätigt) end-to-end testbar ist.
    return {
      vorschlaege: { zusammenfassungsVorschlag: transcript, kompetenzvorschlaege: [] },
      providerName: "mock-echo",
    };
  }
}

export function createAiSuggestionAdapter(mode: IntegrationMode): AiSuggestionAdapter {
  assertMockOnly(mode, "KI-Vorschlag");
  return new MockAiSuggestionAdapter();
}
