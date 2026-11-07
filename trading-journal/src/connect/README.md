# `src/connect` – Verbindungen

Fremde Nutzer verbinden **ihre eigenen** Dienste selbst; nichts wird für sie gehostet. Ein klickbarer Platzhalter (`ConnectSlot`) steht überall, wo eine
Verbindung gebraucht wird, und öffnet einen geführten Dialog. Die Zentrale ist **Einstellungen → Verbindungen** (`ConnectionsHub`).

## Zustände des Platzhalters (`slotState.ts`)

| Zustand | Bedingung (Reihenfolge = Vorrang) | Klick |
|---|---|---|
| nicht eingerichtet | der Betreiber hat es nicht eingerichtet (Env/Server fehlt, Telefon-Alarm gibt es noch nicht) | Dialog erklärt es |
| Anmeldung nötig | Dienst braucht das Cloud-Konto, es ist keins angemeldet | Anmelden |
| verbindet | Prüfung oder Erstimport läuft | Dialog |
| Fehler | z. B. Key abgelehnt, letztes Signal abgelehnt – mit Klartext und nächstem Schritt | Dialog |
| verbunden | Verbindung steht (TradingView: erst nach einem angekommenen Signal) | Dialog (verwalten) |
| im höheren Tarif | Tarif erlaubt die Verbindung nicht (liest `plans.ts`, nichts hartkodiert) | Tarif ansehen |
| nicht verbunden | alles bereit | Dialog |

Ein unbekannter Zustand (lädt noch) ist **nie** „verbunden“ und nie „nicht eingerichtet“.

## Wo die Platzhalter stehen

Nur auf Seiten mit `[data-rich]` (nie Übersicht/Cockpit):

- Einstellungen → Verbindungen (alle sieben Dienste, gruppiert) · Konto → Börse (Binance Spot, Binance Futures; die Bitunix-Karte bleibt wie sie war)
- Aktien → Branchen-Trend → Pine-Skript (TradingView; Hinweis, dass das Branchen-Signal noch nicht ausgewertet wird)
- Markt → Alarme (Telefon-Alarm; der E-Mail-Alarm hat dort schon seinen eigenen Abschnitt)
- Einstellungen → Daten → Backup importieren (Binance Futures, Bitunix; das Fenster schließt sich, bevor der Dialog öffnet)

## Dateien

| Datei | Was |
|---|---|
| `ConnectSlot.tsx` | schlanke Hülle (lazy `SlotView`), gleich großer Umriss bis der Chunk da ist (kein Layout-Springen) |
| `SlotView.tsx`, `connect.css` | der Platzhalter, Glas-Look (Verlauf + Glanzkante, `backdrop-filter` nur wo möglich, sonst volle Kartenfläche; Text bleibt `fg`/`mute`) |
| `slotState.ts` | Zustandsmaschine des Platzhalters und der Dialog-Schritte (`wizardReducer`: Prüf-Schritt nur über `submit`, kein Doppel-Absenden, Rückfrage `ask` → `accept` → erneut senden) |
| `facts.ts` | macht aus den vorhandenen Stores (Cloud-Sitzung, Börsen-Status, TradingView-Status, Alarm-Status) `SlotFacts` + eine Statuszeile |
| `open.ts` | winziger Store „welcher Dialog ist offen“ (die App lädt den Dialog-Chunk erst beim ersten Klick: `ConnectMount` in `DeferredHosts`) |
| `ConnectHost.tsx` | der Dialog (ein `Sheet` für alle Dienste), pro Öffnen neu eingehängt |
| `BinanceWizard.tsx` | Binance: Anleitung → Key eintragen → Prüfung (Rechte lesen: ablehnen / nachfragen / ok) → Erstimport mit Fortschritt; verbunden: abgleichen, Probelauf, neu einlesen, trennen |
| `TradingViewWizard.tsx`, `tvStore.ts`, `tvTemplates.ts` | Zieladresse erstellen/ersetzen/löschen → Alarm-Vorlagen und Pine-Beispiel kopieren → Testsignal senden → Empfang |
| `InfoPanels.tsx` | Bitunix (übergibt an den vorhandenen Dialog), E-Mail-Alarm, Telefon-Alarm, Cloud-Konto |
| `partners.ts`, `PartnerBox.tsx` | Partnerlinks, **aus** solange der Betreiber keinen Link setzt; immer gekennzeichnet (`docs/PARTNERLINKS.md`) |
| `ConnectionsHub.tsx` | die Karte für Einstellungen |
| `strings.ts`, `services.ts` | Texte, Katalog der Dienste |

## Ehrlichkeit

- **Binance** wurde nach der offiziellen Dokumentation gebaut und gegen Test-Doubles geprüft, **nicht gegen das echte Binance** (die Entwicklungsumgebung
  erreicht es nicht, HTTP 451). Der Dialog behauptet nichts darüber hinaus.
- **TradingView ohne OAuth/MCP:** die Verbindung ist die Zieladresse des Nutzers; die App liest nichts aus dessen TradingView-Konto. Das steht im Dialog.
- **Telefon-Alarm** gibt es noch nicht (`PHONE_ALERTS_READY = false` in `services.ts`).
- Der Schlüssel eines Nutzers wird nie im Browser gehalten: er geht einmal an `POST /api/v1/exchange/connect`, wird dort verschlüsselt, und kommt nie zurück
  (nur die letzten 4 Zeichen). Das eingetippte Secret verlässt den Zustand und das DOM, bevor die Anfrage rausgeht (`flushSync`).

## Server-Seite

`netlify/functions/_lib/exchanges/binance.ts` (Signatur, Rechte-Check, Client mit Allowlist, Adapter), `binanceTrades.ts` (Fills → Positionen, rein),
`exchange-connect.mts` (Rechte lesen vor dem Speichern: 422 `rights_refused`, 409 `rights_confirm`), `connections-tradingview.mts` (Zieladresse),
`hooks-tradingview.mts` (`action: test`), `_lib/connections/receipts.ts` (Empfangsprotokoll, Migration `0012_connections.sql`). Details in
`netlify/functions/_lib/exchanges/README.md`.

## Tests

`tests/unit/connect.state.test.ts` (Zustandsmaschinen, Sichten, Partnerlink an/aus, Vorlagen), `connect.binance.pure.test.ts` (Signatur gegen das Beispiel der
Doku, Rechte-Matrix, Fill-Parser, Gruppierung, Dubletten), `connect.binance.adapter.test.ts` (Fake-Binance prüft jede Signatur, nur GET und nur erlaubte Pfade,
7-Tage-Fenster, Fehler auf Deutsch), `connect.functions.test.ts` (Connect/Sync/Trennen, Verschlüsselung hin und zurück, Tarif-Limit aus `plans.ts`, TradingView-Adresse),
`connect.ui.test.tsx` (Platzhalter, Binance- und TradingView-Dialog, kein Secret im DOM), `supabase.connections.test.ts` (Migration 0012 auf PGlite: RLS).
E2E: `tests/e2e/connect.spec.ts` (mobil + Desktop, Mock).
