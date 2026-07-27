# Offene Entscheidungen des Inhabers

Diese Punkte kann und darf das System nicht selbst entscheiden. Solange sie
offen sind, arbeitet es eingeschränkt — bewusst.

---

## Dringend: blockiert derzeit Inhalte

### 1. Zwölf Marken-Tatsachen bestätigen oder verwerfen

Der Fact Verifier blockiert jeden Beitrag, der eine unbestätigte Angabe
verwendet. Zu entscheiden:

| Angabe | Recherchierter Wert | Quelle |
|---|---|---|
| Gründungsjahr und Gründer | 1965, Günter Krebs | Öffentliche Verzeichnisse |
| Anzahl Fahrlehrer | 18 | Öffentliche Verzeichnisse |
| Adresse Fulda | Am Bahnhof 3, 36037 Fulda | Öffentliche Verzeichnisse |
| Adresse Bad Hersfeld | Bahnhofstr. 20, 36251 Bad Hersfeld | Öffentliche Verzeichnisse |
| Instagram-Konto | @fahrschulekrebs | Öffentliche Verzeichnisse |
| Facebook-Seite | facebook.com/fahrschulekrebs | Öffentliche Verzeichnisse |
| Klassen im Detail | Motorrad, Pkw, Lkw, Bus, Traktor, Anhänger | Öffentliche Verzeichnisse |
| Intensivkurse | Theorie und/oder Praxis | Öffentliche Verzeichnisse |
| Simulator | vorhanden? | Aus dem Auftrag als „zu prüfen" |
| Behindertengerechte Ausbildung | angeboten? | Aus dem Auftrag als „zu prüfen" |
| Fuhrpark | „umfangreich" | Aus dem Auftrag als „zu prüfen" |
| Digitale Lerninhalte | vorhanden? | Aus dem Auftrag als „zu prüfen" |

**Wo:** Einstellungen → Marken-Tatsachen.
**Hinweis:** Bei Zahlen bitte den konkreten Wert eintragen. „Umfangreicher
Fuhrpark" ist keine Aussage — „34 Fahrzeuge, davon 6 Lkw" schon.

### 2. Rechte und Einwilligung für 30 Archivobjekte

Alle importierten Higgsfield-Objekte stehen auf `UNKNOWN` und sind damit
gesperrt. Es handelt sich um vollständig synthetisch erzeugtes Markenmaterial
ohne reale Personen, Fahrzeuge oder Kennzeichen.

**Zu entscheiden:** Ist synthetisches Material für Ihre Marke akzeptabel, oder
soll ausschließlich echtes Material aus dem Betrieb verwendet werden?

Der Auftrag sagt: echtes Material hat Vorrang. Das System hält sich daran —
es generiert nie von sich aus. Wenn Sie synthetisches Material grundsätzlich
ablehnen, setzen Sie die Objekte auf `rights: FORBIDDEN`; sie tauchen dann in
keiner Suche mehr auf.

**Wo:** Medien → Wartet auf Rechteklärung.

---

## Wichtig: Grundsatzentscheidungen

### 3. Sollen Menschen aus dem Betrieb gezeigt werden?

Instruktoren und Fahrschüler sind der stärkste Vertrauensbeweis einer
Fahrschule — und rechtlich der heikelste Inhalt.

**Wenn ja, brauchen Sie:**
- eine schriftliche Einwilligungserklärung für Fahrlehrer (Arbeitsvertrag
  reicht in der Regel nicht)
- eine Einwilligung der Erziehungsberechtigten bei allen unter 18
- eine Regelung für den Widerruf (das System setzt ihn technisch sofort um:
  `consent: WITHDRAWN` stoppt auch eingeplante Beiträge)

**Wenn nein:** Die Säule „Menschen im Betrieb" (9 % Zielanteil) sollte
deaktiviert und ihr Anteil auf andere Säulen verteilt werden.

### 4. Dürfen Preise genannt werden?

Derzeit blockiert der Fact Verifier jede Preisangabe.

- **Nein:** Alles bleibt wie es ist. Antwortentwürfe fragen nach der Klasse,
  statt einen Preis zu nennen.
- **Ja:** Sie müssen eine belegte Preistabelle als Marken-Tatsache hinterlegen
  und **aktuell halten**. Ein veralteter Preis im Netz ist schlimmer als
  keiner. Prüfen Sie vorher die Preisangabenverordnung.

### 5. TikTok — ja oder nein?

Die Zielgruppe der Fahranfänger ist dort, aber:
- Ohne bestandenes TikTok-App-Audit sind Beiträge **nur für Sie sichtbar**
- Das Audit dauert und verlangt eine dokumentierte Anwendung
- TikTok liefert deutlich weniger Kennzahlen (keine Speicherungen, keine
  Profilbesuche, keine Wiedergabedauer)

**Empfehlung:** erst Instagram stabil betreiben, TikTok frühestens ab Monat 2.

### 6. Wer bekommt welche Rolle?

| Rolle | Sinnvoll für |
|---|---|
| **owner** | Nur Sie. Diese Rolle kann freigeben und Regeln ändern. |
| **editor** | Mitarbeitende, die vorbereiten — kann alles außer freigeben. |
| **viewer** | Steuerberater, Berater, Praktikanten. |

**Empfehlung:** genau ein owner. Wenn zwei Personen freigeben dürfen sollen,
klären Sie vorher, wer bei Uneinigkeit entscheidet — das System hat dafür keine
Regel.

---

## Betrieblich

### 7. Wo läuft das System?

| Variante | Kosten | Aufwand | Für Sie geeignet wenn |
|---|---|---|---|
| Kleiner Server (VPS) | ca. 5–10 €/Monat | Einmalig einrichten | Sie jemanden haben, der Linux kennt |
| Rechner im Betrieb | Strom | Sie müssen ihn laufen lassen | Sie ohnehin einen Server haben |
| Verwaltetes Hosting | 20–50 €/Monat | Gering | Sie sich nicht kümmern wollen |

Nötig ist in jedem Fall: **HTTPS** (sonst `COOKIE_SECURE=false`, was unsicher
ist) und ein **persistentes Datenverzeichnis** für `data/`.

Mitgeliefert: `ops/Dockerfile`, `ops/docker-compose.yml`,
`ops/fahrschul-autopilot.service` (systemd).

### 8. Soll ein LLM angebunden werden?

Ohne `ANTHROPIC_API_KEY` arbeiten die generativen Agenten im deterministischen
Modus. Die Texte sind korrekt und belegt, aber vorhersehbar.

**Mit LLM:** deutlich bessere Hooks und Formulierungen, Kosten nach Verbrauch
(bei drei Beiträgen pro Woche im niedrigen einstelligen Eurobereich pro Monat).
**Wichtig:** Die prüfenden Agenten bleiben Regelwerke — das LLM kann das
Freigabe-Gate nicht umgehen.

**Datenschutz:** Bei Anbindung werden Beitragsentwürfe und Markendaten an
Anthropic übermittelt. Ein Auftragsverarbeitungsvertrag ist erforderlich.

### 9. Aufbewahrungsfrist für Nachrichten

Standard: 180 Tage, danach werden Text und Anzeigename automatisch entfernt.
Änderbar über `INBOX_RETENTION_DAYS`.

- Kürzer (90 Tage): datensparsamer
- Länger (365 Tage): bessere Auswertung wiederkehrender Fragen

Prüfen Sie, ob Ihre bestehende Datenschutzerklärung dazu passt.

### 10. Wer pflegt die Leads?

Der Business Impact Score bleibt strukturell unvollständig, wenn niemand
einträgt, welche Anfrage zu einer Anmeldung wurde. Das System kann das nicht
wissen.

**Zu klären:** Wer trägt Anmeldung und Umsatz ein, und wann? Ohne feste
Zuständigkeit passiert es nicht.

---

## Vor dem ersten öffentlichen Beitrag

- [ ] Zwölf Marken-Tatsachen entschieden
- [ ] Medienrechte für mindestens 10 Objekte gesetzt
- [ ] Einwilligungserklärung juristisch geprüft (falls Personen gezeigt werden)
- [ ] Auftragsverarbeitungsverträge mit Meta (und ggf. Anthropic) geschlossen
- [ ] HTTPS aktiv, `COOKIE_SECURE=true`
- [ ] Sicherung eingerichtet, Wiederherstellung einmal geübt
- [ ] Impressum auf den Social-Media-Profilen geprüft
