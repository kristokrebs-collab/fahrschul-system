import { Badge } from "@/primitives/Badge";
import { SHOT_EXTRACT_STATE_TEXT, useShotExtractState } from "./availability";

/**
 * Help text of the screenshot import (settings → Daten): what it does, what it needs, where the pictures go – and why
 * the button in the trade form is (not) there right now. The editor itself stays silent when the import is off.
 */
export function ExtractSettingsNote() {
  const state = useShotExtractState();
  return (
    <div className="mt-5 grid gap-2 border-t border-line pt-4" data-testid="settings-shot-extract" data-state={state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">Screenshot-Import</h3>
        <Badge tone={state === "ready" ? "win" : "mute"} dot>
          {state === "ready" ? "Verfügbar" : state === "checking" ? "Wird geprüft" : state === "server-error" ? "Status unbekannt" : "Nicht verfügbar"}
        </Badge>
      </div>
      <p className="text-[12.5px] leading-relaxed text-mute">
        Eine KI liest Einstieg, Ausstieg, Stop, Ziele, Menge, Hebel, Gebühren, Funding und Ergebnis aus Börsen-Screenshots, auch aus Orderhistorien („Long öffnen“, „Short schließen“ …). Fehlt die Eröffnung im Bild, bleibt der Einstieg leer – du kannst ihn aus dem Ergebnis berechnen lassen, als gekennzeichnete Annahme. Unsicheres wird markiert, nichts wird erfunden oder automatisch gespeichert – du prüfst den Entwurf im Editor. Die Bilder werden nur zum Auslesen gesendet.
        Ohne den Import trägst du die Werte wie gewohnt von Hand ein; deine Screenshots bleiben in jedem Fall am Trade.
      </p>
      <p className="text-[12.5px] leading-relaxed text-faint" data-testid="settings-shot-extract-state">
        {SHOT_EXTRACT_STATE_TEXT[state]}
      </p>
    </div>
  );
}
