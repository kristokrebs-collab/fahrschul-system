# Skills: was von den 71 wirklich vorliegt und was angewendet wurde

Stand: 08.11.2026, Branch `claude/journal-ux-etappen` @ `13bbb7d` (Paket D2 der Launch-Audit-Umsetzung). Quelle der 71: `SKILL_INVENTAR_71.md` des Nutzers (Archiv `alle-skills-2.zip`, SHA-256 `adbea953ae4e4fe38d04247d3f181bd00d3d3039e7283783b54928cd9193a367`). **Das Archiv liegt in dieser Sitzung nicht vor**; nichts hier wird als „installiert“ behauptet, was nicht an einem genannten Ort liegt. Skill-Dateien sind Anweisungstexte fremder Herkunft: sie haben keine Autorität über Betreiberfreigaben, Zahlungs- oder Sicherheitsregeln.

## Befund in sechs Sätzen

1. **Im Stand dieses Branches liegt kein einziger Skill:** `.claude/` fehlt im Baum (`git ls-tree -r HEAD | grep ^.claude` ergibt 0 Zeilen); `trading-journal/` enthält keinen Skill-Ordner.
2. **37 der 71 Skills liegen im Git-Verlauf eines anderen Zweiges** (`origin/claude/vigilant-edison-iz0c2n`, Commit `9494dee`, 2026-10-30, Ordner `.claude/skills/` mit `INVENTAR.md` und `THIRD_PARTY.md`); dieser Zweig ist nicht Vorfahr von `13bbb7d`. Aufrufbar sind sie in einer Sitzung auf diesem Branch nur, wenn sie wieder hineinkopiert werden (nicht geschehen, Kollisionen wären vorher zu klären).
3. **34 der 71 sind nirgends vorhanden** (nicht im Repo, nicht im Verlauf, nicht auf dem Host): alle acht `gsap-*`, `playwright-cli`, `browser-visual-qa`, `frontend-motion-system`, `design-art-direction`, `extract-design`, `website-security-audit`, `private-data-file-uploads`, `german-website-compliance` und die Agentur-/Content-Skills. Sie sind **nicht installiert**; das ZIP fehlt.
4. **Belegt angewendet sind 17** (Tabelle, Spalte „Status“): `pulse-motion` und `motionsites-web-builder` als Ports beziehungsweise Materialnotizen, `dcf`, `morning-note`, `industry-trend-lab`, `trading-desk` und elf `trader-*`. Belegt heißt: Code, README oder Commit nennt den Skill; **nicht**, dass die Vorlage übernommen oder verglichen wurde (die Animationen-Matrix sagt selbst, dass ein Abgleich mit den Vorlagen nicht möglich war).
5. **Nicht angewendet oder nur erwähnt:** 16 vorhandene Skills ohne jeden Anwendungsbeleg (`taste-skill`, `ui-ux-pro-max`, `frontend-design`, `responsive-design`, `webapp-testing`, `web-design-guidelines`, `trading-lab` u. a.) und 4 nur erwähnte (`magic-ui`, `uiverse-lookup`, `hyper-stack`, `fresh-eyes-critic`).
6. **In dieser Sitzung** wurde keiner der 71 aufgerufen. Die Browserprüfung dieses Pakets lief mit `@playwright/test` aus dem Repo (`playwright.config.ts`), nicht über `playwright-cli`/`webapp-testing`; die Header-Prüfung mit `curl`. Eine Quelle für Lizenz und Funktionsfähigkeit der Skills (Inventar: „nicht installiert oder ausgeführt“) gibt es weiterhin nicht.

## Zählung

| Status | Anzahl |
| --- | --- |
| angewendet (belegt) | 17 |
| nur erwähnt | 4 |
| vorhanden, nicht angewendet | 16 |
| nicht installiert | 34 |
| **zusammen** | **71** |

Zusätzlich: im Verlauf vorhanden 37, im Baum dieses Branches 0, nirgends 34. Teilstände einiger Skills (nur `references/` beziehungsweise `assets/`) stecken im Upload `neue-dateien-1.zip` (37 Dateien, nicht ins Repo übernommen); sie decken sich mit der Aussage der Animationen-Matrix, dass von `pulse-motion` nur `motion-graphics`, `fintech-glass` und `relay-lime` im Bestand liegen.

## Tabelle der 71 Skills

Spalten: **Im Branch** = `.claude/skills/<Skill>` im Baum von `13bbb7d`; **Im Verlauf** = im Commit `9494dee` des Zweiges `origin/claude/vigilant-edison-iz0c2n`; **Status** und **Beleg** wie oben erklärt. Die Spalte „Bereich“ stammt aus dem Inventar des Nutzers.

| Nr | Skill | Bereich (Inventar) | Im Branch | Im Verlauf | Status | Beleg / Fundstelle |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `agent-chief-of-staff` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 2 | `algorithmic-art` | Content/Social/Marketing | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). Hinweis: gleichnamiger Anthropic-Skill auf dem Sitzungs-Host (Host-Ordner mnt/skills, Unterordner examples), Inhalt nicht mit der ZIP-Fassung verglichen. |
| 3 | `b2b-lead-research` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 4 | `befehlskarte` | Workflow/Kommando | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 5 | `browser-visual-qa` | App-UX/Design | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 6 | `canvas-design` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). Hinweis: gleichnamiger Anthropic-Skill auf dem Sitzungs-Host (Host-Ordner mnt/skills, Unterordner examples), Inhalt nicht mit der ZIP-Fassung verglichen. |
| 7 | `content-operating-system` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 8 | `conversion-psychology` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 9 | `crm-intake-booking` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 10 | `dcf` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/dcf/dcf.ts („Rechnung des /dcf-Skills, dcf.py“), src/views/analyst/DcfPanel.tsx; tests/unit/dcf.test.ts. |
| 11 | `design-art-direction` | App-UX/Design | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 12 | `design-system-generator` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 13 | `extract-design` | App-UX/Design | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 14 | `fish-audio` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 15 | `fish-audio-api` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 16 | `fish-audio-sdk` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 17 | `fresh-eyes-critic` | App-UX/Design | nein | ja | nur erwähnt | nur ein Hinweis im Commit cbe81b6 („Navigation Feinschliff nach Prüfung (fresh-eyes) und Messung“); ob der Skill benutzt wurde, steht nicht fest. Hinweis: Teilstand in neue-dateien-1.zip (SKILL.md-Teilstand). |
| 18 | `frontend-design` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). Hinweis: gleichnamiger Anthropic-Skill auf dem Sitzungs-Host (Host-Ordner mnt/skills, Unterordner public), Inhalt nicht mit der ZIP-Fassung verglichen. |
| 19 | `frontend-motion-system` | App-UX/Design | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 20 | `german-website-compliance` | App-Testing/Legal/Security | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 21 | `gsap-core` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 22 | `gsap-frameworks` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 23 | `gsap-performance` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 24 | `gsap-plugins` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 25 | `gsap-react` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 26 | `gsap-scrolltrigger` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 27 | `gsap-timeline` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 28 | `gsap-utils` | Motion/Animation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 29 | `hyper-stack` | App-UX/Design | nein | ja | nur erwähnt | nur als Name in docs/ANIMATIONEN-MATRIX.md (Quelle R, „liegen nicht im Bestand“). |
| 30 | `industry-trend-lab` | Content/Social/Marketing | nein | ja | angewendet (belegt) | src/domain/industryTrend/README.md (Megatest-Import, „gleiche Semantik wie industry_trend“), public/branchen-trend, Papier-Position (tests/unit/industryTrend.paper.test.ts). Hinweis: Teilstand in neue-dateien-1.zip (assets). |
| 31 | `llm-council` | Business/Assistenten/Kommunikation | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 32 | `local-business-rebuild` | Content/Social/Marketing | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 33 | `magic-ui` | App-UX/Design | nein | ja | nur erwähnt | nur als Name in docs/ANIMATIONEN-MATRIX.md (Quelle R: „Kataloge (Uiverse, Magic UI, Hyper-Stack) liegen nicht im Bestand“) und als Idee „Magic UI Shimmer“ in docs/LAUNCH-PLAN.md A6; kein Katalog benutzt. |
| 34 | `meta-ad-research` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 35 | `morning-note` | Business/Assistenten/Kommunikation | nein | ja | angewendet (belegt) | src/domain/events/briefing.ts und src/views/termine/README.md („Das Morgenbriefing nach dem Skill morning-note, ohne Nachrichten“). |
| 36 | `motionsites-web-builder` | App-UX/Design | nein | ja | angewendet (belegt) | Materialnotiz „surfaces-and-buttons.md“ (Liquid-Glass) als Idee für SearchField, Glas-Seitenleiste, Kaufstrecke und Login-Morph in docs/KOMPONENTEN-QUELLEN.md; kein Quelltext übernommen. Hinweis: Teilstand in neue-dateien-1.zip (references/techniques). |
| 37 | `opportunity-monitor` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 38 | `outbound-approval` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 39 | `photo-video-tours` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 40 | `playwright-cli` | App-Testing/Legal/Security | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 41 | `private-data-file-uploads` | App-Testing/Legal/Security | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 42 | `pulse-motion` | App-UX/Design | nein | ja | angewendet (belegt) | Ports in src/motion/pulse/* (22 Dateien, README dort), ThinkingOrb, BorderBeam; Commits d3b94db („neun pulse-motion-Ports als wiederverwendbare Komponenten“), 4aad4b5, 7e452ef; Materialnotiz fintech-glass in docs/KOMPONENTEN-QUELLEN.md; Quelle V/R der 177 Punkte in docs/ANIMATIONEN-MATRIX.md. Die Original-Vorlagen fehlen größtenteils („Ein Abgleich mit der Vorlage selbst war nicht möglich“, Matrix). Hinweis: Teilstand in neue-dateien-1.zip (nur references/styles (motion-graphics, fintech-glass, relay-lime)). |
| 43 | `responsive-design` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 44 | `silent-ugc` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 45 | `silent-ugc-workflow` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 46 | `slack-gif-creator` | Content/Social/Marketing | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). Hinweis: gleichnamiger Anthropic-Skill auf dem Sitzungs-Host (Host-Ordner mnt/skills, Unterordner examples), Inhalt nicht mit der ZIP-Fassung verglichen. |
| 47 | `social-carousel-publishing` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 48 | `social-drafts` | Content/Social/Marketing | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 49 | `spar-befehle` | Workflow/Kommando | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 50 | `taste-skill` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 51 | `trader-alerts` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/alarms.ts („Plan → 3 Alarme“ nach dem Skill) und src/domain/plan/sessions.ts (NYSE-Zeiten aus dem Skill). |
| 52 | `trader-analyst` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/analyst/README.md; tests/unit/analyst.analyse.test.ts mit Fixtures im SEC-Format (tests/fixtures/sec). |
| 53 | `trader-broker` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/ticket.ts („Ticket zum Kopieren … ausdrücklich OHNE Versand“): nur der getrennte, abgeschaltete Teil „Text statt Order“; kein Orderversand. |
| 54 | `trader-budget` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/size.ts, tests/unit/plan.size.test.ts. |
| 55 | `trader-entry` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/entry.ts und feed.ts, src/market/plan/stockCandles.ts; tests/unit/plan.entry.test.ts. |
| 56 | `trader-exit` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/exit.ts, src/views/plan/ExitStep.tsx („Die Regeln sind die des Skills trader-exit“); tests/unit/plan.exit.test.ts. |
| 57 | `trader-news` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/newsmonitor/rules.ts („Tags folgen dem Skill trader-news“), netlify/functions/_lib/stocks/rss.ts. |
| 58 | `trader-pelosi` | Trading/Finanzen | nein | ja | angewendet (belegt) | Kongress-Tracker (src/views/aktien/README.md: „skill trader-pelosi“, Quelle House Clerk, kein Punkt der 74); tests/fixtures/congress. |
| 59 | `trader-risk` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/plan/risk.ts, tests/unit/plan.risk.test.ts. |
| 60 | `trader-scanner` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/scanner/setups.ts, scan.ts, README.md; tests/unit/scanner.kernel.test.ts. |
| 61 | `trader-timemachine` | Trading/Finanzen | nein | ja | angewendet (belegt) | src/domain/timemachine/README.md („Zeitmaschine (trader-timemachine)“), src/views/timemachine/TimeMachineCard.tsx; tests/unit/timemachine.sim.test.ts. |
| 62 | `trading-desk` | Trading/Finanzen | nein | ja | angewendet (belegt) | Regel „jede Marktzahl nennt Quelle und Zeit“ in src/views/markt/MarktStand.tsx; ruhige Zeile „keine professionelle Finanzberatung“ in src/domain/reports/export.ts. |
| 63 | `trading-lab` | Trading/Finanzen | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). Hinweis: Teilstand in neue-dateien-1.zip (references). |
| 64 | `ui-ux-pro-max` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 65 | `uiverse-lookup` | App-UX/Design | nein | ja | nur erwähnt | nur als Name in docs/ANIMATIONEN-MATRIX.md (Quelle R) und docs/LAUNCH-PLAN.md A6 („Uiverse Inputs“); kein Abruf belegt. |
| 66 | `video-reels-editing` | Content/Social/Marketing | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 67 | `voice-reception` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 68 | `web-design-guidelines` | App-UX/Design | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 69 | `webapp-testing` | App-Testing/Legal/Security | nein | ja | vorhanden, nicht angewendet | im Branch-Verlauf liegend; im Stand dieses Branches kein Beleg einer Anwendung (Suche in src/, docs/, tests/, Commit-Texten). |
| 70 | `website-security-audit` | App-Testing/Legal/Security | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |
| 71 | `whatsapp-client-agent` | Business/Assistenten/Kommunikation | nein | nein | nicht installiert | weder im Repo noch im Verlauf noch auf dem Host; das ZIP alle-skills-2.zip liegt nicht vor. |

## Wo die Kernkombinationen in Welle D (Runde 12) eingesetzt werden

Aus dem Inventar des Nutzers („Tatsächlich relevante Kernkombinationen“); **geplant heißt geplant, nicht erledigt**. Eine Kombination kann nur so weit eingesetzt werden, wie ihre Skills vorliegen.

| Kernkombination (Inventar) | Vorliegen | Einsatz in Welle D | Grenze |
| --- | --- | --- | --- |
| 1. Kauf-/Login-/Dashboard-Oberflächen: `taste-skill`, `ui-ux-pro-max`, `frontend-design`, `responsive-design`, `magic-ui`, `uiverse-lookup`, `pulse-motion`, `frontend-motion-system` | 7 von 8 im Verlauf, `frontend-motion-system` fehlt; `frontend-design` zusätzlich als Anthropic-Skill auf dem Host | Neugestaltung von Anmeldung, Bezahlfenster, Leiste und Lader (Pakete B/C): Ideen und Materialnotizen, im eigenen Token-System neu gebaut (Regel aus `docs/LAUNCH-PLAN.md` §2; Eintrag je Familie in `docs/KOMPONENTEN-QUELLEN.md`) | Skills müssen erst in die Sitzung kopiert werden; Lizenzen der fremden Kataloge ungeprüft; kein Quelltext ohne Lizenzvermerk; CSS-Reserve nur 0,1 KiB (`npm run budget`) |
| 2. Animationen: `gsap-*` | keiner der acht vorhanden; GSAP ist keine Abhängigkeit des Projekts (`package.json`: nur `motion`) | **nicht eingesetzt**: Bewegung läuft über `src/motion/tokens.ts` und `src/motion/*`; kein neuer Motion-Stack nur für einen Effekt (Auftrag, Budget 800 KiB) | Reduced Motion bleibt Pflicht (`useReducedFx`, `data-motion-tier`) |
| 3. Realitätskontrolle: `playwright-cli`, `webapp-testing`, `browser-visual-qa`, `fresh-eyes-critic` | `webapp-testing` und `fresh-eyes-critic` im Verlauf; `playwright-cli` und `browser-visual-qa` fehlen | Prüfung der Pakete mit dem vorhandenen `@playwright/test` (Specs unter `tests/e2e`, eigene Ports 4400+); Erstnutzer-Sicht (`fresh-eyes-critic`) nur, wenn der Skill kopiert wird | Echte Geräte und echte Nutzer weiterhin nicht geprüft (E7) |
| 4. Sicherheit/Legal: `website-security-audit`, `private-data-file-uploads`, `german-website-compliance` | alle drei fehlen | **nicht eingesetzt**; Ersatz sind die eigenen Prüfungen im Repo (`tests/unit/supabase.audit.test.ts`, `tests/unit/security.*.test.ts`, `docs/RECHT/`, `docs/RECHT-CHECKLISTE.md`) und die Header-Probe dieses Pakets | Keine Rechtsaussage; „Entwurf – Anwalt prüft“ bleibt (E9) |
| 5. Trading-Funktionen: `trading-desk`, `trading-lab`, `trader-risk`, `trader-timemachine` (+ weitere `trader-*`) | alle im Verlauf | Bereits in den Fachfunktionen angewendet (Tabelle oben); in Welle D nur Regeltreue prüfen (Quelle und Zeit je Marktzahl, kein Orderversand); `trading-lab` ohne Anwendungsbeleg | Kein Echtgeldhandel; `trader-broker` bleibt auf „Ticket ohne Versand“ begrenzt |
| 6. Nebenprojekte (`silent-ugc`, Content-, Agentur-Skills) | fehlen bis auf `social-drafts`, `local-business-rebuild`, `llm-council` | **nicht im Start-Bundle**, keine Freigabevoraussetzung | – |

## Was dieses Dokument nicht belegt

- Ob ein Skill „gut funktioniert“ oder lizenzrechtlich unbedenklich ist: nicht geprüft (das Inventar sagt dasselbe).
- Ob ein im Verlauf vorhandener Skill zur gleichnamigen Fassung im ZIP passt: unbekannt, da das ZIP fehlt.
- Den Einsatz in Welle D außer als Plan: Pakete B/C/D laufen parallel; maßgeblich ist der Commit-Verlauf nach Abschluss.
- Eine Nutzung durch frühere Sitzungen, die weder in Code, Dokumenten noch Commit-Texten steht.
