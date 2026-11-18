## Offene Anwaltsfragen

Stand: 07.11.2026. Das ist die Liste dessen, was ein Anwalt entscheiden muss, bevor die App Geld nimmt. Sie ist kein Rechtsgutachten; wo Quellen sekundär sind (Kanzlei-Beiträge), steht das in docs/RECHT-CHECKLISTE.md. Reihenfolge nach Gewicht: A und B können den Start blockieren.

### A. Aufsichtsrecht: Signale als „Anlageempfehlung“ (höchstes Risiko)

1. Sind der Branchen-Trend (Grün = Long-ETF, Rot = Cash), die Lage-Ampel, der Einstiegs-Check, Top-Trader-Kennzahlen und der TradingView-Signal-Empfänger eine „Anlageempfehlung“ nach Art. 3 Abs. 1 Nr. 34/35 MAR (mit Delegierter VO (EU) 2016/958 und Art. 20 MAR) – auch wenn sie an alle Nutzer gleich gehen und als „Beobachtung“ formuliert sind? Genügt der Hinweis „keine Anlageberatung“, wenn der Inhalt „kaufen/verkaufen“ nahelegt (Rot = Cash, Grün = Long)?
2. Wird aus dem Allgemeinen etwas Persönliches (Anlageberatung, § 1 Abs. 1a Nr. 1a KWG / Art. 4 Abs. 1 Nr. 4 MiFID II), sobald die App Kandidaten gegen die Daten, Limits und Risikoregeln des Nutzers prüft (Handelsplan, Ticket, Risiko-Check, Kandidatenprüfung der Zeitmaschine, geplant: Paper-Position aus Signal)? Reicht „rein rechnerisch, ohne Eignungsurteil“?
3. Kryptowerte: Fällt die Anzeige von Signalen zu Krypto-Perpetuals unter „Beratung zu Kryptowerten“ nach MiCA (Art. 3 Abs. 1 Nr. 24, Art. 81)? ESMA Q&A 2882 (2026) nennt Zuschnitt auf die Person und „als geeignet dargestellt“ als Kriterium. Sind Perpetuals überhaupt Kryptowerte-Dienstleistung oder Finanzinstrumente (Derivate/CFD)?
4. Automatisierung: Wird die geplante Kette Signal → Kandidatenprüfung → Paper-Position (nie echte Order) wie Copy-/Auto-Trading behandelt (ESMA Q&A 2463 wendet MiFID-II-Maßstäbe analog an)? Wo liegt die Grenze zur Portfolioverwaltung?
5. Länder: UK (Erlaubnispflicht „Advising on investments“ Art. 53 RAO; Werbung für Kryptowerte seit 8.10.2023 über § 21 FSMA), USA (Investment Advisers Act § 202(a)(11) und Publisher-Ausnahme nach Lowe v. SEC – gilt nur ohne individualisierte Beratung; CFTC „commodity trading advisor“), weitere. Soll der Dienst in bestimmten Ländern gesperrt werden (Geoblocking, AGB-Ausschluss)?
6. Reicht der Risikohinweis in der jetzigen Form (Seitenende, Fließtext) oder braucht es Pflichtangaben je Land (z. B. Verlustquote bei CFD-Anbietern gilt für Anbieter, nicht für Software – bitte bestätigen)?

### B. Kaufstrecke und Verbraucherrecht

7. Button-Beschriftung (§ 312j Abs. 3 BGB): Genügt der Stripe-Checkout-Button („Abonnieren“/„Testversion starten“) plus Hinweis in der App? Sind „N Tage gratis testen“ und „Anmelden und testen“ in der App als erste Stufe zulässig, oder müssen sie bereits „zahlungspflichtig“ tragen? Stand B4: der Button der App heißt jetzt genau „Zahlungspflichtig bestellen“ (`BUTTON_LABELS.order`), die Karten und der Upgrade-Dialog führen mit „Weiter zur Bestellung“ dorthin; bei Stripe steht `submit_type: pay` plus ein `custom_text` neben dem Button (der Stripe-Button selbst bleibt „Zahlen“/„Testversion starten“). Genügt das?
8. Zustimmung zum sofortigen Beginn und Wertersatz (§ 356 BGB, § 357a BGB): Dienst oder digitales Produkt? Wie wirkt das bei Testphase, bei Abo ohne „vollständige“ Erbringung? Wann beginnt die Frist (Start der Testphase oder erste Zahlung)? Reicht der Wortlaut aus docs/RECHT/widerruf.md?
9. Widerrufsfunktion (§ 356a BGB seit 19.06.2026): Muss sie für jedes Abo mit Widerrufsrecht gebaut werden (ja nach Quellen), ohne Login, mit Eingangsbestätigung? Wo gehört die Schaltfläche hin?
10. Kündigungsbutton (§ 312k BGB): Muss „Verträge hier kündigen“ ohne Login erreichbar sein (OLG Nürnberg 3 U 2214/23; OLG Düsseldorf 20 UKl 3/23)? Stripe-Portal und App-Dialog reichen das? Sind der Grund-Schritt und die Angebote (Pause/Tarif wechseln) vor „Jetzt kündigen“ zulässig (BGH-Entscheidung zu Bestätigungsseite 2026 prüfen)?
11. § 309 Nr. 9 BGB: automatische Verlängerung von Jahres-Abos gegenüber Verbrauchern; Kündigungsfrist.
12. Pflichtangaben vor der Bestellung (§ 312j Abs. 2 BGB, Art. 246a § 1 EGBGB): Laufzeit, Verlängerung, Preis nach Testphase, Mindestlaufzeit, Zahlungsmittel – sind sie im Bestellschritt (App und Stripe) vollständig und „unmittelbar vor“ der Bestellung?
13. Preisangaben (PAngV): „inkl. USt“ am Preis; Darstellung für Besucher außerhalb der EU; „Jährlich −X %“ als Preisermäßigung (§ 11 PAngV); Team „pro Sitz“.
14. Nachweis: Speicherung von Zustimmungen (Zeit, Fassung, Nutzer) – wie lange und welche Daten? Stand B4: `consents` (Wortlaut, Hash, Fassung, Konto, Zeit, Tarif) und `contract_requests`; sie hängen am Konto und verschwinden bei der Kontolöschung. Aufbewahrung gegen Art. 17 DSGVO abwägen. Weg und offene Punkte der Kündigung/des Widerrufs ohne Login: `kuendigung-widerruf.md`.
15. § 36 VSBG: Erklärung zur Streitbeilegung; OS-Plattform ist abgeschaltet (seit 20.07.2025).
16. AGB-Inhalt: Haftungsklausel einschließlich Datenverlust, Änderungsklausel (BGH XI ZR 26/20), Rechtswahl bei weltweitem Angebot, Free-Tarif als digitales Produkt (§§ 327 ff. BGB, Änderungen nach § 327r BGB).

### C. Datenschutz

17. Marktdaten-Abruf direkt aus dem Browser bei Binance/Bybit/OKX beim Start (mit Preconnect in `index.html`), ohne vorherige Auswahl: Rechtsgrundlage, Drittland, Information in der Erklärung. Muss die Voreinstellung der Weg über den eigenen Server sein?
18. EU-US Data Privacy Framework (EuG T-553/23 vom 03.09.2025, Rechtsmittel C-703/25 P anhängig): Reicht DPF-Stützung für Supabase, Netlify, Stripe, Resend, Twilio, Anthropic oder zusätzlich SCC? Region der Datenbank (EU) festlegen.
19. Rollen (Verantwortlicher/Auftragsverarbeiter) von Stripe; Verträge (AVV) mit allen; Aufbewahrungsfristen.
20. Telefon-Alarme: Einwilligung, Nummernprüfung, Gesprächsprotokoll, Zustellung (geplant, Paket C2): Anforderungen aus TKG/UWG § 7 bei Anrufen (Dienstanruf, nicht Werbung)?
21. KI-Funktionen: Übermittlung von Screenshots und Strategietexten an Anthropic (Drittland, Inhalte Dritter, Kontostände); Transparenzpflicht bei KI-Interaktion nach Art. 50 KI-Verordnung (gilt nach den Quellen ab 02.08.2026, Stand prüfen) für die optionale LLM-Formulierung des Coach.
22. Lokale Speicherung: Sind rein kosmetische Merker (Einführung gesehen, Animation je Sitzung, `sessionStorage`) „unbedingt erforderlich“ (§ 25 Abs. 2 Nr. 2 TDDDG), oder genügt Information? Kein Banner geplant.
23. Community/Ranglisten (Einwilligung, k ≥ 10): reicht das als Anonymisierung?
24. Altersgrenze (18?) und ihre Durchsetzung; Art. 8 DSGVO; Datenschutzbeauftragter nötig?
25. Fehlerberichte (Opt-in) und Sicherheitsprotokoll (pseudonyme IP): Speicherdauer festlegen.

### D. Wettbewerb, Marken, Steuern, Sonstiges

26. Partnerlinks: Wortlaut, Platzierung und Voreinstellung „aus“ ausreichend (§ 5a Abs. 4 UWG, § 6 DDG)? Provisionen/Guthaben an Nutzer für Empfehlungen (Referral): Kennzeichnung, Steuer.
27. Markennennung (TradingView, Binance …) und Aussage „keine Partnerschaft“; Lizenz der Marktdatenquellen für kommerzielle Weitergabe (Yahoo Finance inoffiziell, Binance-API-Bedingungen); TradingView-Bedingungen für Webhook/MCP.
28. Steuern: OSS-Registrierung, Stripe Tax ein/aus, US Sales Tax je Bundesstaat (Wayfair-Schwellen), UK-/Schweizer MwSt.
29. Barrierefreiheitsstärkungsgesetz (BFSG, seit 28.06.2025): Gilt es für den Dienst im elektronischen Geschäftsverkehr; Kleinstunternehmen-Ausnahme; Erklärung zur Barrierefreiheit?
30. Marketing-Begriffe wie „Wal-Karte“, „Top-Trader“ und Erfolgsversprechen in Texten: irreführend nach § 5 UWG? Gibt es Aussagen, die Performance suggerieren?
31. Impressum: Rechtsform, Aufsichtsbehörde (nur falls erlaubnispflichtig – hängt an A), zweiter Kommunikationsweg.
