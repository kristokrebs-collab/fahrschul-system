---
name: website-security-audit
description: Nutze diesen Skill vor Deployments oder bei Security-Reviews für Webapps, Cloudflare, APIs, Zugriffsrechte und Abhängigkeiten.
---

# Website- und Cloudflare-Sicherheitsaudit

**Kategorie:** security

## Leitlinien
Nur ausdrücklich autorisierte Zielsysteme prüfen. Keine aktiven Angriffstests, Schwachstellenscans gegen Fremdsysteme oder produktive Änderungen ohne Berechtigung.
## Ablauf
1. Scope, Hosting, Framework, Auth-System, Datenklassifikation, Bedrohungsmodell und Backups ermitteln.
2. SAST/Dependency/Secret-Checks und Konfigurationsreview: SQL/NoSQL Injection, XSS, CSRF, SSRF, IDOR/BOLA, AuthZ, Session, Rate-Limits, CORS, Webhooks, Uploads, Logs.
3. TLS/HSTS/CSP/Cookie-Flags, Cloudflare WAF/Rate Limiting/Bot-Regeln und Origin-Schutz kontrollieren, soweit verfügbar.
4. Secrets nie ausgeben; kompromittierte Schlüssel zur Rotation markieren, nichts automatisch rotieren ohne Freigabe.
5. Befunde nach Risiko/Beleg/Datei/Schweregrad ordnen und sichere Korrekturen vorschlagen.
6. Nach Fixes Tests wiederholen; Audit ist keine Garantie für absolute Sicherheit.
## Ergebnis
Finding-Tabelle (Schwere, Auswirkung, Nachweis, Fix, Verifikation), Open Issues, Release-Gate.
## Quellen
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Security](https://developers.cloudflare.com/security/)

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
