# Skill-Suite (20 Module): Status, Quellenprüfung, offene Freigaben

Stand 2026-11-07. Grundlage: `Claude_Master_Skillpaket_20_Skills_v2.zip` und `Claude_Master_Prompt_20_Skills.md` des Nutzers. Installiert wurde **nur**, was im Paket selbst liegt (eigene Anleitungen). **Kein Drittanbieter-Code installiert, keine Konten verbunden, keine Orders/Nachrichten/Anrufe/Postings ausgelöst.**

## (a) Die 20 Skills: Status

Alle 20 liegen unter `.claude/skills/<name>/` (projektbezogen, per Git rückgängig zu machen). Es wurde nichts überschrieben (kein Namenskonflikt mit den 38 bisherigen Skills). Status laut Vorgabe: **eigenständiger Skill bereit**; Verbindungen siehe (c).

| Bereich | Skill | Status | Überschneidung mit vorhandenen Skills |
|---|---|---|---|
| Business | `crm-intake-booking` | eigenständiger Skill bereit; CRM-Zugang fehlt | keine |
| Business | `b2b-lead-research` | bereit; nur zulässige Quellen | keine |
| Business | `outbound-approval` | bereit; § 7 UWG, nur Entwürfe ohne Einwilligung | Freigabe-Muster ähnlich `trading-lab/outbox.py` |
| Business | `meta-ad-research` | bereit; Ad-Library-Zugang nicht eingerichtet | keine |
| Business | `agent-chief-of-staff` | bereit (Konzept/Workflow) | keine |
| Business | `opportunity-monitor` | bereit; echter Zeitplan/Server nötig für Dauerbetrieb | keine |
| Kommunikation | `whatsapp-client-agent` | bereit; WhatsApp-Business-Konto nötig | keine |
| Kommunikation | `voice-reception` | bereit; Telefonie-Provider nötig | keine |
| Content | `content-operating-system` | bereit | `social-drafts` (Trading-Posts) |
| Content | `video-reels-editing` | bereit (Konzept, DaVinci-Workflow) | keine |
| Content | `social-carousel-publishing` | bereit; Veröffentlichung nur nach Freigabe | `social-drafts` |
| Content | `photo-video-tours` | bereit; Videoanbieter nicht verbunden | keine |
| Content | `silent-ugc-workflow` | bereit (eigene Anleitung, **nicht** der Original-Skill) | keine |
| Design | `design-art-direction` | bereit | `taste-skill`, `pulse-motion` (Styles) |
| Design | `frontend-motion-system` | bereit | `pulse-motion` (deckt mehr ab, inkl. Easing-Regeln) |
| Design | `browser-visual-qa` | bereit | `webapp-testing`, `fresh-eyes-critic` |
| Design | `conversion-psychology` | bereit | keine |
| Security | `website-security-audit` | bereit | keine |
| Security | `german-website-compliance` | bereit; **kein Rechtssiegel**, Anwaltspunkte werden ausgewiesen | keine |
| Security | `private-data-file-uploads` | bereit | keine |

## (b) Drittanbieter: wirklich installiert
**Auf deine Freigabe vom 2026-11-08 installiert (nur Skill-Ordner kopiert, ohne npx/npm, mit Lizenzdatei, Commit festgehalten in `.claude/skills/THIRD_PARTY.md`):** gsap-skills (8 Skills), `playwright-cli` (Skill; vorab erteilte Bash-Rechte `allowed-tools` entfernt), `extract-design`, `silent-ugc` (Original). **Nicht installiert:** alles andere. Geprüft wurden alle Quellen unten nur lesend (flache Klone in getrenntem Ordner, nichts ausgeführt).

### Quellenprüfung (Stand der Repos: Commit-Datum)
| Quelle | Befund | Status laut Vorgabe |
|---|---|---|
| greensock/gsap-skills (Commit 2026-04-21) | MIT; 8 reine Anleitungs-Skills (core, timeline, scrolltrigger, plugins, utils, react, frameworks, performance); keine Skripte, keine Hooks, keine verdächtigen Muster; GSAP laut README inzwischen kostenlos | **INSTALLIERT** (8 Skill-Ordner) |
| microsoft/playwright-cli (2026-11-05) | Apache-2.0, offizielle Microsoft-Quelle; Skill `playwright-cli` (reine Anleitung); das CLI selbst ist ein globales npm-Paket (`@playwright/cli`) und installiert Browser | **INSTALLIERT** (nur Skill; `npm -g @playwright/cli` nicht installiert, Playwright ist hier schon da) |
| Manavarya09/design-extract (2026-11-05) | MIT; npm-Paket `designlang` (Node >= 20, Playwright, MCP-SDK), liest Designsysteme fremder Websites; Repo enthält 1.800 Dateien inkl. Galerie mit Designs bekannter Marken; Skill `extract-design` | **INSTALLIERT** (nur Skill; `npx designlang` nur nach Freigabe je Lauf; Rechte an fremden Websites beachten) |
| jasonlee-breadcrumb/silent-ugc (2026-08-20) | MIT; 1 Skill (SKILL.md, 4 Dateien), keine Skripte; braucht Arcads-MCP (Konto, Credits), `yt-dlp`, `ffmpeg`; **Zweck laut Skill: virale TikTok-Hooks nachbauen, "Account um eine KI-Creatorin", Massenproduktion von UGC-Anzeigen** | **INSTALLIERT auf deinen Wunsch, trotz meiner Bedenken**: Risiko irreführender "UGC"-Werbung (Kennzeichnung), Download fremder Videos (Plattformregeln, Urheberrecht), erfundene Testimonials. Auflagen stehen in `THIRD_PARTY.md`; ohne Arcads-Konto läuft nur das Konzept |
| gokapso/agent-skills (2026-10-09) | **keine LICENSE-Datei im Repo**; Alpha; 4 Skills (WhatsApp integrieren/automatisieren/beobachten/Anrufe), braucht `KAPSO_API_KEY`, `kapso login`; liest API-Schlüssel nur aus Umgebungsvariablen (üblich) | **externer Account erforderlich**; Lizenz unklar, daher **nicht kopieren**, bis geklärt |
| DavidHDev/react-bits (2026-10-31) | "MIT + Commons Clause": Nutzung in Anwendungen erlaubt, **kein Weiterverkauf** der Komponenten; enthält **keinen Claude-Skill**, sondern eine React-Bibliothek (8.800 Dateien) | **nur Konzept**: als Quelle für Komponenten, nicht als Skill |
| Leonxlnx/taste-skill (2026-11-07) | MIT; **bereits vorhanden** (frühere Kopie `taste-skill`, Name `design-taste-frontend`); Upstream hat seither Änderungen; `install.sh` legt nur Symlinks an | **bereits vorhanden**; Update auf Anfrage |
| transitions.dev | Website mit Motion-Skill, Bibliothek (43+), `npx transitions-agent`; **keine Lizenz genannt, Installationsschritte nicht einsehbar**, Teile "Pro" | **nicht geprüft genug**, nicht installieren |
| ethanplusai/sellbird (früher Harvey) (2026-11-07) | **AGPL-3.0** (starkes Copyleft, Netzwerkklausel); ganze Python-Anwendung (253 Dateien), **kein Skill**; sendet Kalt-E-Mails über dein Postfach, läuft in einer Schleife; Standardaufbau über `pip install -e .` in einer venv | **nicht installiert**; Anwendung, AGPL und § 7 UWG sprechen dagegen, nur als Muster nutzen |
| tenfoldmarc/ghl-mcp (2026-03-17) | **keine LICENSE**; 5 Dateien, `main.py` (68 KB) spricht nur mit `services.leadconnectorhq.com` (httpx); `install.sh` legt venv an, fragt Token und Location-ID ab und trägt sie per `claude mcp add -e` ein (Klartext in der Claude-Konfiguration) | **nicht installiert**; Lizenz unklar, `main.py` nur per Muster-Suche geprüft (nicht Zeile für Zeile); externer Account (GoHighLevel-Token) erforderlich |
| fishaudio/fish-audio-plugin (2026-10-26) | MIT; Plugin mit 3 reinen Dokumentations-Skills (fish-audio, -sdk, -api) und `.mcp.json` auf `https://api.fish.audio/mcp` (OAuth-Anmeldung, kein Schlüssel); `scripts/sync-docs-skills.sh` nur für Entwickler | **geprüft, installierbar**; die 3 Skills sind kopierbar, die MCP-Verbindung braucht deine Anmeldung bei Fish Audio; **nicht installiert**, weil nicht in deiner Freigabeliste |
| pbakaus/impeccable (2026-11-06) | Apache-2.0; 1 Skill mit 24 Befehlen, 4 Agenten, CLI `impeccable` (npm); **Hooks führen bei jedem Edit/Write und beim Stopp ein mitgeliefertes Programm aus**; Repo 4.469 Dateien | **nicht installiert**; geprüft nur als Muster, Hook-Programm nicht auditiert; Installation nur mit Freigabe des Hooks |
| Harvey (altes Repo) | in früherer Sitzung gelesen: Vertriebsagent für Kalt-E-Mails; nur Bauweisen übernommen, kein Code (`trading-lab/references/harvey-muster.md`). Das Repo heißt heute Sellbird | gelesen, nicht installiert |

## (c) MCP/API-Verbindungen und Teststatus
| Dienst | Verbindung | Teststatus |
|---|---|---|
| GoHighLevel, Kapso/WhatsApp, Fish Audio, Telefonie-Provider, Arcads, Meta Ad Library, Blotato, Higgsfield, Cloudflare | **nicht verbunden** | nicht getestet (kein Zugang) |
| TradingView (lesend) | in früherer Sitzung freigegeben und getestet | OK (nur Kurse lesen) |
| Playwright | im System vorinstalliert | OK (Screenshots/Messung in früheren Läufen) |

## (d) Was von dir noch benötigt wird
1. **Eine Freigabe der Installationsliste** (siehe unten und die Frage im Chat).
2. **Entscheidung zu den 4 jetzt geprüften Repos**: Fish Audio (Skills + OAuth-Verbindung) wäre kopier-/verbindbar; Impeccable nur mit Freigabe des Hooks; ghl-mcp wegen fehlender Lizenz und Token im Klartext nur auf deine Entscheidung; Sellbird (AGPL, Kalt-E-Mail-Anwendung) nicht empfohlen.
3. **Konten, nur von dir im Anbieter-Dialog**: GoHighLevel (Token), WhatsApp Business/Kapso (API-Key), Telefonie-Anbieter plus Fish Audio, Arcads (nur wenn Silent-UGC-Original gewünscht), Meta-Ad-Library-Zugang. Keine Passwörter oder Tokens in den Chat.
4. **Rechtliches**: anwaltliche Prüfung vor Kaltakquise (§ 7 UWG), Telefon-/Aufzeichnungshinweise, Datenschutz bei WhatsApp/Voice.

## (e) Kosten und Risiko
Kosten nur, wo belegbar: **für keinen der Anbieter wurden Preise geprüft**; Arcads, Telefonie, WhatsApp Business, GoHighLevel sind kostenpflichtig (Betrag nicht belegt). Risiken: Outbound (UWG, Abmahnung), Voice (Aufzeichnung, DSGVO), Silent UGC (Kennzeichnung, Rechte), Scraping (Plattformregeln), Fremdcode (Lizenz, Updates). Keine "abmahnsicher"-Aussage.

## (f) Testprotokoll (dieser Lauf)
- Paket entpackt in getrenntem Ordner; `install_skills.py` vorher gelesen (kopiert nur nicht vorhandene Skills, kein Netzwerk).
- Vorschau, dann `--apply`: **20 kopiert, 0 übersprungen**. Danach 11 Drittanbieter-Skills (8 GSAP, playwright-cli, extract-design, silent-ugc) mit Lizenzdatei kopiert; vorher gelesen: nur Markdown, keine Skripte.
- Struktur-Test aller 20: Frontmatter, Name = Ordner, Beschreibung <= 1024 Zeichen, kein Konflikt, keine verdächtigen Muster (curl|sh, eval, base64, eingebettete Schlüssel, Steuerzeichen): **bestanden**. Gesamtbau aller Skills (57) lief fehlerfrei.
- Einschränkung: Funktions-/Integrationstests gegen echte Dienste waren **nicht möglich** (keine Konten). Ein Skill (`design-art-direction`) hat keinen Abschnitt "Ergebnis"; inhaltlich nicht kritisch.
- Quellenprüfung: nur statisch (Lizenz, Struktur, Skripte, Muster), kein Code ausgeführt, kein Sicherheitsaudit.

## (g) Empfehlungen für Automationen mit echtem Zeitplan/Server
- `opportunity-monitor` (tägliche Auftragssuche), `content-operating-system` (Trendbeobachtung), `social-carousel-publishing` (Veröffentlichungsplan): brauchen einen Planer (Cron/Server) und autorisierte Zugänge; Veröffentlichen nur nach Freigabe.
- `whatsapp-client-agent`, `voice-reception`: brauchen dauerhaft erreichbaren Webhook-Server und Provider-Konten (nicht in dieser Sitzung leistbar).
- Reihenfolge nach Nutzen und Sicherheit: 1) Skills nutzen (jetzt), 2) gsap-skills kopieren, 3) Konten klären (CRM, WhatsApp), 4) erst dann Outbound/Voice testen.
