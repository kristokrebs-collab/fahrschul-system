import { Badge } from "@/primitives/Badge";
import { MoreInfo } from "@/views/settings/MoreInfo";
import { SHOT_EXTRACT_STATE_TEXT, useShotExtractState } from "./availability";

/**
 * Help text of the screenshot import (settings → Daten): what it does, what it needs, where the pictures go – and why
 * the button in the trade form is (not) there right now. The editor itself stays silent when the import is off.
 * The local reading (`src/journal/ocr/`, „Alle Trades → Screenshot importieren“) needs nothing of this: the state and the
 * badge below are only about the OPTIONAL model path.
 */
export function ExtractSettingsNote() {
  const state = useShotExtractState();
  return (
    <div className="mt-5 grid gap-2 border-t border-line pt-4" data-testid="settings-shot-extract" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">Screenshot-Import</h3>
        <Badge tone={state === "ready" ? "win" : "mute"} dot>
          {state === "ready" ? "KI verfügbar" : state === "checking" ? "KI wird geprüft" : state === "server-error" ? "KI: Status unbekannt" : "KI nicht verfügbar"}
        </Badge>
      </div>
      <MoreInfo summary="So funktioniert der Import" className="text-[12.5px]">
      <p className="text-[12.5px] leading-relaxed text-mute" data-testid="settings-shot-local">
        Ohne Konto und ohne Schlüssel: Unter „Alle Trades → Screenshot importieren“ liest die Texterkennung deines Browsers Order-, Positions- und Trade-Historien direkt auf deinem Gerät – die Bilder werden weder gespeichert noch gesendet. Du siehst alle erkannten Trades in einer Vorschau, korrigierst Gelbes und trägst sie mit einem Klick ein (mit „Rückgängig“). Beim ersten Mal lädt der Browser einmalig die Erkennungsdateien (rund 8 MB).
      </p>
      <p className="text-[12.5px] leading-relaxed text-mute">
        Optional zusätzlich: Eine KI liest Einstieg, Ausstieg, Stop, Ziele, Menge, Hebel, Gebühren, Funding und Ergebnis aus Börsen-Screenshots, auch aus Orderhistorien („Long öffnen“, „Short schließen“ …). Fehlt die Eröffnung im Bild, bleibt der Einstieg leer – du kannst ihn aus dem Ergebnis berechnen lassen, als gekennzeichnete Annahme. Unsicheres wird markiert, nichts wird erfunden oder automatisch gespeichert – du prüfst den Entwurf im Editor. Die Bilder werden nur zum Auslesen gesendet.
        Ohne den Import trägst du die Werte wie gewohnt von Hand ein; deine Screenshots bleiben in jedem Fall am Trade.
      </p>
      </MoreInfo>
      <p className="text-[12.5px] leading-relaxed text-faint" data-testid="settings-shot-extract-state">
        {SHOT_EXTRACT_STATE_TEXT[state]}
      </p>
    </div>
  );
}
