# Rollen-Berechtigungsmatrix

Quelle der Wahrheit ist `packages/permissions/src/matrix.ts`
(`ROLE_PERMISSIONS`). Diese Datei wird von Hand gepflegt, um mit dem Code
synchron zu bleiben, und ist Gegenstand automatisierter Tests
(`packages/permissions/src/matrix.test.ts`). Bei jeder Änderung an der
Matrix im Code muss diese Tabelle im selben Commit aktualisiert werden.

`own` = nur eigene bzw. zugeordnete Datensätze. `any` = alle Datensätze im
zuständigen Standort/Organisation (zusätzlich durch Datenbank-Scoping in
`apps/api` geprüft, nicht nur durch die Matrix).

| Berechtigung | Schüler | Fahrlehrer | Büro | Finanzen | Geschäftsführung | Systemdienst |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| students:read:own | ✅ | ✅ | – | – | – | – |
| students:read:any | – | – | ✅ | ✅ | ✅ | – |
| students:write:any | – | – | ✅ | – | – | – |
| appointments:read:own | ✅ | ✅ | – | – | – | – |
| appointments:read:any | – | – | ✅ | – | ✅ | – |
| appointments:create | – | ✅ | ✅ | – | – | – |
| appointments:cancel:own | ✅ | ✅ | – | – | – | – |
| appointments:cancel:any | – | – | ✅ | – | – | – |
| availability:write:own | – | ✅ | – | – | – | – |
| availability:write:any | – | – | ✅ | – | – | – |
| documents:upload:own | ✅ | – | – | – | – | – |
| documents:read:own | ✅ | ✅ | – | – | – | – |
| documents:read:any | – | – | ✅ | – | ✅ | – |
| documents:verify | – | – | ✅ | – | – | – |
| invoices:read:own | ✅ | – | ✅ | ✅ | ✅ | – |
| invoices:manage | – | – | – | ✅ | ✅ | – |
| payments:manage | – | – | – | ✅ | – | – |
| bank:reconcile | – | – | – | ✅ | – | – |
| reports:management | – | – | – | ✅ | ✅ | – |
| users:manage | – | – | – | – | – | ✅ |
| audit:read | – | – | – | – | ✅ | ✅ |
| system:admin | – | – | – | – | – | ✅ |
| appointments:accept:own | ✅ | – | – | – | – | – |
| wunschzeiten:write:own | ✅ | – | – | – | – | – |
| exam:read:own | ✅ | – | – | – | – | – |
| exam:clearance:set | – | ✅ | ✅ | – | – | – |
| feedback:read:own | ✅ | – | – | – | – | – |
| feedback:manage:own | – | ✅ | – | – | – | – |
| learning:read:own | ✅ | – | – | – | – | – |
| flex:participate:own | ✅ | – | – | – | – | – |

## Prompt 1 – Erweiterungen (apps/student)

Die folgenden Berechtigungen wurden für die Fahrschüler-App ergänzt. Sie
bleiben bewusst eng geschnitten (`own`-Scope, keine Schreibrechte über
Genehmigungen hinaus):

- **appointments:accept:own** ist ausdrücklich NICHT dasselbe wie
  `appointments:create`. Ein Schüler kann damit ausschließlich ein
  bestehendes, offenes Terminangebot eines Fahrlehrers annehmen (serverseitig
  erneut konfliktgeprüft, siehe `apps/api/src/routes/appointment-offers.ts`),
  niemals selbst einen neuen Termin für sich oder andere anlegen.
- **exam:clearance:set** haben ausschließlich Fahrlehrer und Büro. Die
  Schüler-App ist bei der PrüfungsReady-Ansicht rein lesend
  (`exam:read:own`); das wird serverseitig über die Rollen-Middleware
  erzwungen, nicht nur durch das Verstecken eines Buttons im UI.
- **feedback:read:own** liefert niemals das Feld `internalNotes` der
  Fahrlehrer-Notizen – das wird auf Query-/Serialisierungsebene in
  `apps/api` gefiltert, nicht nur im UI ausgeblendet (siehe
  `docs/student-app-final-qa.md`).

## Fachliche Anmerkungen

- **Schüler** sieht/verwaltet ausschließlich eigene Daten (`own`-Scope). Kein
  Zugriff auf andere Schüler, keine Verwaltungsrechte.
- **Fahrlehrer** sieht/verwaltet nur zugeordnete Schüler/Termine, kann eigene
  Verfügbarkeit pflegen und Termine anbieten (`appointments:create` als
  Terminangebot, nicht als Fremdbuchung für andere Fahrlehrer).
- **Büro** hat operative Verwaltungsrechte über alle Schüler/Termine/Dokumente
  eines Standorts, aber keine Finanz- oder Systemrechte.
- **Finanzen** verwaltet Rechnungen, Zahlungen, Bankabgleich und
  betriebswirtschaftliche Auswertungen, hat aber keinen Zugriff auf
  Terminbuchung oder Dokumentprüfung.
- **Geschäftsführung** hat lesenden Überblick über Schüler/Termine/Dokumente
  und volle Managementauswertungen inkl. Audit-Log, aber keine operativen
  Schreibrechte auf Termine/Verfügbarkeit (das bleibt bei Büro/Fahrlehrer).
- **Systemdienst** hat ausschließlich technische Rechte (Benutzerverwaltung,
  Audit-Log, Systemadministration) und **keinen** Zugriff auf fachliche
  Schüler-/Finanzdaten – entspricht der Vorgabe "nur technische Rechte".

## Prompt 2 – Erweiterungen (apps/office)

Neue Berechtigungen, alle ausschließlich für die Rolle Büro (`buero`), mit
einer Ausnahme (`exam:pipeline:advance`, siehe unten):

| Berechtigung | Zweck |
|---|---|
| `office:dashboard:read` | Heute-Queue/Planung/Auswertungen |
| `leads:manage` | Leads/CRM anlegen, bearbeiten, zu Schüler konvertieren |
| `messages:manage` | Nachrichtenvorlagen + Sende-Log |
| `resources:manage` | Räume/Simulatoren/Fahrzeugmängel/Arbeitszeitregeln |
| `exam:pipeline:advance` | Prüfungs-Pipeline-Zustand weiterschalten |
| `storno:manage` | Storno-Retter-Flow auslösen/steuern |
| `audit:read:office` | Audit-Log des eigenen Standorts (enger als `audit:read`) |

- **`exam:pipeline:advance`** haben sowohl Büro als auch Fahrlehrer – die
  Matrix allein reicht hier bewusst NICHT aus: der Übergang in den Zustand
  `fahrlehrer_go` darf laut Aufgabenstellung ausschließlich von einem
  Akteur mit Rolle `fahrlehrer` ausgeführt werden. Das wird zusätzlich zur
  Permission-Prüfung transition-spezifisch in
  `packages/domain/src/pruefungspipeline.ts` (`assertTransitionAllowed`) und
  in `apps/api/src/routes/exam-pipeline.ts` erzwungen – ein Büro-Akteur mit
  `exam:pipeline:advance` darf alle anderen Übergänge ausführen, aber NICHT
  diesen einen.
- Alle übrigen neuen Berechtigungen bleiben ausschließlich Büro vorbehalten;
  Finanzen bekommt **keine** davon (Non-Negotiable: "office should be
  read-mostly on finance, full financial mutation authority belongs to
  Prompt 4's Finance app" – umgekehrt bekommt Büro keine
  `invoices:manage`/`payments:manage`/`bank:reconcile`).

Diese Matrix ist die Ausgangsbasis für Prompt 0. Feingranularere Rechte
(z. B. differenzierte Dokumenttypen, Mehr-Augen-Prinzip bei
Prüfungsfreigaben, siehe `docs/fachliche-bestaetigungen.md` Punkt 11) werden
in späteren Prompts ergänzt und bleiben bis zur fachlichen Bestätigung
konservativ (eher zu wenig als zu viel Zugriff).
