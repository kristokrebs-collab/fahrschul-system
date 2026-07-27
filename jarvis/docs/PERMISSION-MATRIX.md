# Berechtigungsmatrix

Verbindliche Quelle für „was darf JARVIS ohne Rückfrage?“.
Durchgesetzt in `src/tools/safety.ts` und `src/tools/actions.ts`, getestet in
`test/security.test.ts` und `test/reliability.test.ts`.

---

## Risikoklassen

| Klasse | Bedeutung | Bestätigung | Kann eine Regel das automatisieren? |
|---|---|---|---|
| `read_only` | ändert nichts, nirgends | nein | entfällt |
| `reversible_write` | lokal, mit billigem Rückweg | **ja**, außer eine enge Regel greift | ja |
| `external_comm` | verlässt den Rechner, erreicht Menschen | **immer** | **nein** |
| `destructive` | löscht/überschreibt ohne billigen Rückweg | **immer** | **nein** |
| `financial_security` | Geld, Zugangsdaten, Sicherheitsregeln | **immer** | **nein** |

Die letzten drei stehen in `ALWAYS_CONFIRM` (`@jarvis/shared`). Keine
Einstellung, kein Prompt und kein Dokumenteninhalt kann sie herabstufen.

---

## Werkzeuge

| Werkzeug | Domäne | Klasse | Umkehrbar | Voraussetzung |
|---|---|---|---|---|
| `search_private_knowledge` | general-jarvis | `read_only` | – | – |
| `read_source` | general-jarvis | `read_only` | – | – |
| `read_file` | general-jarvis | `read_only` | – | Pfad in Quellordnern |
| `recall_memory` | general-jarvis | `read_only` | – | – |
| `list_tasks` | general-jarvis | `read_only` | – | – |
| `query_social_autopilot` | social-autopilot | `read_only` | – | `SOCIAL_AUTOPILOT_URL` |
| `query_finance_crypto` | finance-crypto | `read_only` | – | `FINANCE_CRYPTO_URL` |
| `remember` | general-jarvis | `reversible_write` | ja | – |
| `create_task` | general-jarvis | `reversible_write` | ja | – |
| `complete_task` | general-jarvis | `reversible_write` | ja | – |
| `draft_email` | general-jarvis | `reversible_write` | ja | – (versendet **nichts**) |
| `send_email` | general-jarvis | `external_comm` | **nein** | SMTP — **nicht installiert** |
| `forget_memory` | general-jarvis | `destructive` | 30 Tage | – |
| `run_local_script` | general-jarvis | `destructive` | **nein** | Skript auf Allowlist |

---

## Der Action Safety Reviewer

Läuft **nach** dem Planer und **vor** der Bestätigungskarte. Regelbasiert und
deterministisch — er lässt sich durch nichts im Gespräch überreden.

Prüfungen in Reihenfolge:

1. **Risikoklasse** setzt den Boden (Tabelle oben).
2. **Injektionsdruck** dieses Zuges:
   * Score ≥ 0.5 und Klasse ≠ `read_only` → Bestätigung erzwungen, **alle**
     Automatikregeln für diesen Zug ausgesetzt.
   * Score ≥ 0.5 und Klasse `external_comm`/`financial_security` → **blockiert**.
     Daten nach außen zu senden, während der Kontext manipuliert wirkt, ist genau
     die Form einer erfolgreichen Exfiltration.
   * `read_only` bleibt erlaubt — es kann keinen Schaden anrichten, und es zu
     sperren würde den Assistenten nur unbrauchbar machen.
3. **Nutzlastprüfung**: API-Schlüssel, private Schlüssel, JWTs, `*_KEY=`-Zeilen
   → **blockiert**.
4. **Form bei externer Kommunikation**: ≥ 5 Empfänger → Hinweis; Empfänger
   außerhalb der eigenen Domain → Hinweis.
5. **Destruktiver Umfang**: `alle`, `*`, `%` → kritischer Hinweis.
6. **Integration fehlt** → **blockiert**, mit dem ausdrücklichen Zusatz, dass
   nichts ausgeführt und nichts als erfolgreich gemeldet wird.

Ergebnis ist `allow` (nur `read_only`), `confirm` oder `block`.

---

## Lebenszyklus einer Aktion

```
vorgeschlagen → geprüft ─┬─ allow    → ausgeführt → Ergebnis geprüft
                         ├─ confirm  → Karte → [Ausführen] → ausgeführt
                         │                   → [Ablehnen]  → abgelehnt
                         └─ block    → abgelehnt, keine Karte
```

Garantien:

* **Genau einmal.** Vor dem Lauf wird die Zeile auf `executing` gesetzt; ein
  zweites `Ausführen` findet nichts mehr zu tun.
* **Kein falscher Erfolg.** Liefert ein Werkzeug `ok: false`, ist der Status
  `failed`, nicht `executed`.
* **Ehrlich nach Absturz.** Eine Aktion, die als `executing` überlebt, wird beim
  Start auf `failed` gesetzt mit „Ergebnis unbekannt, bitte manuell prüfen“ —
  weil wir nicht wissen können, ob die Nebenwirkung eingetreten ist.
* **Ablauf.** Bestätigungen verfallen nach 30 Minuten.

---

## Rollen

| Fähigkeit | `owner` | `guest` |
|---|---|---|
| Chatten | ✅ | nur lesen |
| Quellen und Projekte lesen | ✅ | ✅ |
| Erinnerungen lesen | ✅ | ✅ |
| Erinnerungen schreiben/löschen | ✅ | ⛔ |
| Aktionen freigeben | ✅ | ⛔ |
| Neu indexieren, Backup, Jobs | ✅ | ⛔ |
| Prompts, Vorschläge freigeben | ✅ | ⛔ |
| Audit-Log | ✅ | ⛔ |

Definiert in `ROLE_CAPS` (`@jarvis/shared`), geprüft bei jeder Route über
`requireCap` und im Audit-Log als `authz.deny` festgehalten.

---

## Automatisierungsregeln (`memory_rules`)

Enge Ausnahmen, die der Besitzer selbst anlegt:

* betreffen ausschließlich `reversible_write`,
* greifen nur bei passendem `subject`-Muster **und** passender Art,
* haben eine Vertraulichkeitsobergrenze,
* können **niemals** löschen und **niemals** `secret` automatisieren,
* verlieren ihre Wirkung, sobald der Zug unter Injektionsverdacht steht.
