/**
 * The one list of environment variables (C4 Betrieb): name, purpose, whether it is required, where it lives, and what the
 * app does WITHOUT it. `docs/ENV.md` is written from this list (a test keeps both equal), `scripts/releaseCheck.mjs` and the
 * operator endpoint `/api/v1/ops/status` read it. PURE DATA + two evaluators: no imports (the script loads this file with
 * Node's type stripping, the function bundles it), no secrets, never a value – only names.
 *
 * Honesty rule: a missing variable is "nicht eingerichtet" – never silently "frei", never a default that unlocks something.
 */

export type EnvScope = "functions" | "client" | "build";
/** `must`: nothing works without it · `feature`: one feature needs it (the group says which) · `optional`: tuning, safe default. */
export type EnvNeed = "must" | "feature" | "optional";

export interface EnvVar {
  name: string;
  /** What it is for (one line). */
  purpose: string;
  need: EnvNeed;
  scope: EnvScope;
  /** Secret = Netlify "secret" flag, never in the repo, never in a log. */
  secret: boolean;
  /** Group id (`ENV_GROUPS`). */
  group: string;
  /** What happens without it. */
  without: string;
  /** Not read by any code yet (a package that is still to come). The release check lists it, the code audit skips it. */
  planned?: boolean;
}

export interface EnvGroup {
  id: string;
  label: string;
  /** Which features / functions stand on it. */
  serves: string;
  /** Every one of these must be set for the group to count as "eingerichtet" (names only). */
  all: string[];
  /** …and at least one name of each inner list (e.g. one Stripe price). */
  anyOf?: string[][];
  /** The group is part of the core: without it the release check fails. */
  core?: boolean;
}

export const ENV_GROUPS: readonly EnvGroup[] = [
  { id: "supabase", label: "Konto & Cloud (Supabase)", serves: "Login, Sync, Konto, jede Funktion mit Anmeldung", all: ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"], core: true },
  { id: "site", label: "Adresse der Seite", serves: "Links in E-Mails, Weiterleitungen, Proxy-Rückfall", all: ["SITE_ORIGIN"], core: true },
  { id: "billing", label: "Abos (Stripe)", serves: "Kaufstrecke, Kundenportal, Webhook, Tarif-Freischaltung", all: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], anyOf: [["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY", "STRIPE_PRICE_PREMIUM_MONTHLY", "STRIPE_PRICE_PREMIUM_YEARLY", "STRIPE_PRICE_TEAM_MONTHLY", "STRIPE_PRICE_TEAM_YEARLY"]] },
  { id: "exchange", label: "Börsen-Sync", serves: "Börsen-Verbindung (Schlüssel verschlüsselt speichern), Sync, Cron", all: ["EXCHANGE_ENC_KEY_V1"] },
  { id: "mail", label: "E-Mail-Alarm (Resend)", serves: "E-Mail-Alarm bei geschlossener App, Test-Mail", all: ["RESEND_API_KEY", "ALERT_FROM"] },
  { id: "phone", label: "Telefon-Alarm (Twilio)", serves: "Anruf-Alarm, Testanruf, Nummernprüfung (SMS-Code), Status-Rückmeldung von Twilio", all: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "TWILIO_VERIFY_SERVICE_SID"] },
  { id: "tvmcp", label: "TradingView-MCP-Verbindung", serves: "Verbindung pro Nutzer (OAuth 2.1 mit PKCE, nur lesend) in Einstellungen → Verbindungen; braucht außerdem SITE_ORIGIN und EXCHANGE_ENC_KEY_V1", all: ["TV_MCP_CLIENT_ID"] },
  { id: "ai", label: "KI (Anthropic)", serves: "Coach-Formulierung, Screenshot-Import, Strategie-Übersetzer, Assistent", all: ["ANTHROPIC_API_KEY"] },
  { id: "sec", label: "SEC EDGAR", serves: "Quartalszahlen, DCF, Thesen-Monitor", all: ["SEC_USER_AGENT"] },
  { id: "ops", label: "Betreiber-Status", serves: "/api/v1/ops/status", all: ["OPS_TOKEN"] },
];

const v = (x: EnvVar): EnvVar => x;

export const ENV_SPEC: readonly EnvVar[] = [
  // ── Supabase
  v({ name: "VITE_SUPABASE_URL", purpose: "Projekt-Adresse für den Browser (öffentlich)", need: "must", scope: "client", secret: false, group: "supabase", without: "Die App läuft nur lokal: kein Login, kein Sync, Konto-Seite sagt „Cloud nicht eingerichtet“." }),
  v({ name: "VITE_SUPABASE_PUBLISHABLE_KEY", purpose: "Veröffentlichbarer Schlüssel (sb_publishable_…) für den Browser", need: "must", scope: "client", secret: false, group: "supabase", without: "Wie oben: nur lokal." }),
  v({ name: "VITE_SUPABASE_OAUTH_PROVIDERS", purpose: "Komma-Liste der Anmelde-Anbieter (google,github,apple,discord)", need: "optional", scope: "client", secret: false, group: "supabase", without: "Kein Knopf „Mit … anmelden“; Passwort und Magic Link bleiben." }),
  v({ name: "SUPABASE_URL", purpose: "Projekt-Adresse für die Server-Funktionen", need: "must", scope: "functions", secret: false, group: "supabase", without: "Jede Funktion mit Anmeldung antwortet 500 „Der Server ist nicht vollständig eingerichtet.“" }),
  v({ name: "SUPABASE_SECRET_KEY", purpose: "Service-Schlüssel (sb_secret_…) – umgeht RLS, nur in Funktionen", need: "must", scope: "functions", secret: true, group: "supabase", without: "Wie oben; auch Export, Löschen, Backups und Raten-Begrenzung laufen nicht." }),
  // ── Site
  v({ name: "SITE_ORIGIN", purpose: "Öffentliche Adresse der Seite (https://…, ohne Schrägstrich am Ende): Links in E-Mails und Bestätigungs-Mails, Rücksprung-Adressen der Kaufstrecke (mit gesetzter Variable wird jeder andere Ursprung abgelehnt – kein offener Redirect), Binance-Proxy-Rückfall des Alarm-Crons, Zieladresse des TradingView-Assistenten, Rücksprung der TradingView-MCP-Verbindung (<SITE_ORIGIN>/api/v1/connections/tradingview/mcp/callback, bei TradingView genau so eintragen) und Ziel der Twilio-Status-Rückmeldung", need: "must", scope: "functions", secret: false, group: "site", without: "Rücksprung nach dem Bezahlen und Links in E-Mails nehmen den Ursprung der Anfrage; der Binance-Proxy-Rückfall des Alarm-Crons ist aus; der TradingView-Assistent nimmt die Adresse, unter der die Seite gerade geöffnet ist; die TradingView-MCP-Verbindung startet nicht; Anrufe gehen, der Status kommt nur über das Nachfragen bei Twilio (alle 5 Minuten)." }),
  // ── Stripe
  v({ name: "STRIPE_SECRET_KEY", purpose: "Stripe-Schlüssel (sk_… / rk_…): Checkout-Sitzung, Portal, Preise", need: "feature", scope: "functions", secret: true, group: "billing", without: "„Zahlungen sind noch nicht eingerichtet“: `billing-status` meldet `enabled: false`, `billing-checkout` antwortet 503 – kein Fake-Kauf; alle Funktionen sind frei zugänglich (Betreiber-Entscheidung, siehe Konto-Seite)." }),
  v({ name: "STRIPE_WEBHOOK_SECRET", purpose: "Signatur-Geheimnis des Stripe-Webhooks (whsec_…); NUR der Webhook schaltet einen Tarif frei", need: "feature", scope: "functions", secret: true, group: "billing", without: "Der Webhook antwortet 503 und lehnt jede Meldung ab: bezahlte Tarife werden nie freigeschaltet; die Ergebnisseite bleibt bei „Wir warten noch auf die Bestätigung von Stripe“." }),
  v({ name: "STRIPE_PRICE_PRO_MONTHLY", purpose: "Preis-ID Pro, monatlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "STRIPE_PRICE_PRO_YEARLY", purpose: "Preis-ID Pro, jährlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "STRIPE_PRICE_PREMIUM_MONTHLY", purpose: "Preis-ID Premium, monatlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "STRIPE_PRICE_PREMIUM_YEARLY", purpose: "Preis-ID Premium, jährlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "STRIPE_PRICE_TEAM_MONTHLY", purpose: "Preis-ID Team je Sitz, monatlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "STRIPE_PRICE_TEAM_YEARLY", purpose: "Preis-ID Team je Sitz, jährlich", need: "feature", scope: "functions", secret: false, group: "billing", without: "Dieser Tarif/Intervall ist nicht kaufbar." }),
  v({ name: "TRIAL_DAYS", purpose: "Länge der Testphase in Tagen (Standard 14); die Bestellübersicht nennt den Preis NACH der Testphase und das Datum der ersten Zahlung", need: "optional", scope: "functions", secret: false, group: "billing", without: "14 Tage." }),
  v({ name: "STRIPE_TRIAL_CARDLESS", purpose: "Testphase ohne Karte (true/false, Standard false)", need: "optional", scope: "functions", secret: false, group: "billing", without: "Testphase nur mit Zahlungsmittel." }),
  v({ name: "STRIPE_AUTOMATIC_TAX", purpose: "Stripe Tax im Checkout (true/false, Standard false; Betreiberentscheidung mit dem Steuerberater, docs/RECHT/preisangaben.md): Anschrift Pflicht, Steuer-ID abfragbar", need: "optional", scope: "functions", secret: false, group: "billing", without: "Die Bestellübersicht sagt „Stripe Tax ist beim Betreiber nicht eingeschaltet“; mit `true`: „Steuer wird im nächsten Schritt von Stripe berechnet“. Nie ein erfundener Betrag." }),
  v({ name: "REFERRAL_TRIAL_DAYS", purpose: "Testphase über einen Einladungslink in Tagen (Standard 30)", need: "optional", scope: "functions", secret: false, group: "billing", without: "30 Tage." }),
  v({ name: "REFERRAL_REWARD_CENTS", purpose: "Gutschrift je zahlendem Geworbenen in Cent (Standard 1000)", need: "optional", scope: "functions", secret: false, group: "billing", without: "1000 Cent." }),
  v({ name: "REFERRAL_HOLD_DAYS", purpose: "Tage, die eine Empfehlungs-Gutschrift wartet, bevor sie auf das Stripe-Guthaben kommt (Standard 14): in dieser Zeit kommt eine Erstattung oder Rückbuchung der ersten Zahlung noch an; danach schreibt `billing-reconcile` sie gut. Eine Gutschrift gibt es nur für eine echte Zahlung mindestens in Höhe der Gutschrift", need: "optional", scope: "functions", secret: false, group: "billing", without: "14 Tage." }),
  v({ name: "ALLOW_UNGATED", purpose: "`true` = in PRODUKTION dürfen alle Funktionen ohne Stripe-Einrichtung frei laufen (Telefon, SMS, KI, Hintergrund-Sync, Teams). Ohne diese Variable sperrt eine Produktion ohne Stripe-Schlüssel oder Preis-IDs ZU (jedes Konto zählt als Free) – statt für alle kostenlos zu werden. Nur für Betreiber, die bewusst gar nichts verkaufen und die Kosten selbst tragen; in Vorschau-Deploys und lokal ist alles ohnehin frei", need: "optional", scope: "functions", secret: false, group: "billing", without: "Produktion ohne Stripe: geschlossen (Free-Rechte für alle); `ops-status` meldet es." }),
  // ── Exchange
  v({ name: "EXCHANGE_ENC_KEY_V1", purpose: "AES-256-Schlüssel (base64, 32 Byte, `openssl rand -base64 32`): verschlüsselt die Börsen-API-Schlüssel (Bitunix und Binance; je Nutzer und Verbindung gebunden), die Telefonnummer des Telefon-Alarms (AES-GCM) und die Token der TradingView-MCP-Verbindung; weitere Versionen V2… für die Rotation (höhere Versionsnummer)", need: "feature", scope: "functions", secret: true, group: "exchange", without: "503 „Der Börsen-Sync ist auf diesem Server noch nicht eingerichtet.“ – es wird kein Börsen-Schlüssel gespeichert; das Telefon ist nicht möglich (503 phone_unavailable); die TradingView-MCP-Verbindung scheitert mit „nicht eingerichtet“." }),
  v({ name: "SYNC_CRON_ENABLED", purpose: "Geplanter Börsen-Sync alle 30 Minuten an/aus (`false` stoppt ihn)", need: "optional", scope: "functions", secret: false, group: "exchange", without: "An (sofern ein Tarif den Abgleich enthält)." }),
  v({ name: "BINANCE_EGRESS_IP", purpose: "Die FESTE ausgehende IP-Adresse der Server-Funktionen (z. B. über einen Proxy/VPN mit fester Adresse); der Dialog zeigt sie als IP-Whitelist-Eintrag für den Binance-Key", need: "optional", scope: "functions", secret: false, group: "binance", without: "Der Dialog erklärt den Weg „Key ohne IP-Bindung, nur Leserechte“ (Netlify-Funktionen haben keine feste Adresse); Keys mit Auszahlungs-, Transfer- oder Handelsrecht werden immer abgelehnt." }),
  v({ name: "BINANCE_SPOT_BASE", purpose: "Alternative Basisadresse (https://…, ohne Pfad) der Binance-Spot-API, z. B. ein Proxy in einer erlaubten Region (HTTP 451 aus manchen Ländern, u. a. USA)", need: "optional", scope: "functions", secret: false, group: "binance", without: "https://api.binance.com" }),
  v({ name: "BINANCE_FUTURES_BASE", purpose: "Dasselbe für die USDⓈ-M-Futures-API", need: "optional", scope: "functions", secret: false, group: "binance", without: "https://fapi.binance.com" }),
  // ── Mail
  v({ name: "RESEND_API_KEY", purpose: "Resend-Schlüssel für Alarm-Mails (auch der vier Alarme) und für die Bestätigungs-Mails zu Kündigung (§ 312k BGB) und Widerruf (§ 356a BGB) ohne Login", need: "feature", scope: "functions", secret: true, group: "mail", without: "Der Alarm-Cron tut nichts, die App zeigt „Einrichtung nötig“, kein Testmail; Kündigung/Widerruf ohne Login: die Erklärung wird gespeichert, die Seite sagt „E-Mail-Versand nicht eingerichtet“ und verspricht keine Mail (ausgeführt wird dann nur bei angemeldeter Person)." }),
  v({ name: "ALERT_FROM", purpose: "Absender („Name <alarm@deine-domain>“, Domain bei Resend geprüft)", need: "feature", scope: "functions", secret: false, group: "mail", without: "Wie RESEND_API_KEY." }),
  v({ name: "ALERTS_CRON_ENABLED", purpose: "Zeitplan der vier Alarme (`alerts-cron`, alle 5 Minuten) an/aus; `0` schaltet ihn ab", need: "optional", scope: "functions", secret: false, group: "alerts", without: "An." }),
  // ── Phone (C2)
  v({ name: "TWILIO_ACCOUNT_SID", purpose: "Twilio-Konto (AC…) für Anrufe und Nummernprüfung", need: "feature", scope: "functions", secret: false, group: "phone", without: "Kein Telefon-Alarm: „Einrichtung nötig“, kein Testanruf; E-Mail und Browser laufen weiter." }),
  v({ name: "TWILIO_AUTH_TOKEN", purpose: "Zugriff auf Twilio; prüft auch die Signatur der Status-Rückmeldung (/api/v1/alerts/twilio/status)", need: "feature", scope: "functions", secret: true, group: "phone", without: "Wie TWILIO_ACCOUNT_SID; die Status-Rückmeldung antwortet 503." }),
  v({ name: "TWILIO_FROM", purpose: "Absendernummer (E.164, Twilio-Nummer oder verifizierte Anrufer-ID)", need: "feature", scope: "functions", secret: false, group: "phone", without: "Wie TWILIO_ACCOUNT_SID." }),
  v({ name: "TWILIO_VERIFY_SERVICE_SID", purpose: "Twilio-Verify-Dienst (VA…): schickt und prüft den SMS-Code der Nummernprüfung", need: "feature", scope: "functions", secret: false, group: "phone", without: "Keine Nummer lässt sich bestätigen, also wird nie angerufen („Einrichtung nötig“)." }),
  v({ name: "ALERT_PHONE_DAILY_MAX", purpose: "Kostenbremse: Anrufe pro Tag über ALLE Konten (Standard 50)", need: "optional", scope: "functions", secret: false, group: "alerts", without: "50; danach „Kostenbremse des Servers für heute erreicht“ im Zustellprotokoll." }),
  v({ name: "ALERT_PHONE_USER_DAILY_MAX", purpose: "Anrufe pro Konto und Tag, Testanrufe eingerechnet (Standard 5)", need: "optional", scope: "functions", secret: false, group: "alerts", without: "5." }),
  v({ name: "ALERT_SMS_DAILY_MAX", purpose: "Kostenbremse: Bestätigungs-SMS (Twilio Verify) pro Tag über ALLE Konten (Standard 100); schützt vor SMS-Pumping", need: "optional", scope: "functions", secret: false, group: "alerts", without: "100; danach „Für heute sind keine weiteren Bestätigungs-SMS mehr möglich“." }),
  v({ name: "PHONE_ALLOWED_COUNTRIES", purpose: "Länder-Vorwahlen, an die Codes und Anrufe gehen (Komma-Liste, z. B. `49,43,41`); Premium- und Sondernummern sind immer gesperrt", need: "optional", scope: "functions", secret: false, group: "phone", without: "Standardliste: Deutschland, Österreich, Schweiz, übrige EU / EWR, Vereinigtes Königreich, USA und Kanada (+1 ohne die Karibik-Vorwahlen)." }),
  v({ name: "PHONE_HASH_KEY", purpose: "Eigener, NIE gedrehter Schlüssel (`openssl rand -base64 32`) für den Hash der Telefonnummer („eine bestätigte Nummer pro Nummer“). Setzen, BEVOR ein alter `EXCHANGE_ENC_KEY_V<n>` entfernt wird: bisher hing der Hash am ältesten Verschlüsselungsschlüssel", need: "optional", scope: "functions", secret: true, group: "phone", without: "Der Hash nutzt den ältesten `EXCHANGE_ENC_KEY_V<n>` (altes Verhalten); wird der entfernt, ändern sich alle Hashes." }),
  v({ name: "AI_DAILY_MAX", purpose: "Kostenbremse: KI-Aufrufe (Coach, Screenshot-Import, Strategie-Übersetzer, Assistent) pro Tag über ALLE Konten (Standard 2000)", need: "optional", scope: "functions", secret: false, group: "alerts", without: "2000; danach „Die KI hat heute ihr Tageskontingent erreicht“." }),
  // ── TradingView MCP (B3)
  v({ name: "TV_MCP_CLIENT_ID", purpose: "OAuth-Client-ID der App bei TradingView (Betreiber-Einrichtung; ob ein Betreiber dort für dieses Produkt registrieren darf, ist nicht belegt – siehe Hinweise unten)", need: "feature", scope: "functions", secret: false, group: "tvmcp", without: "Die Karte zeigt „Einrichtung nötig (Betreiber)“, nichts wird gestartet." }),
  v({ name: "TV_MCP_CLIENT_SECRET", purpose: "Nur für einen vertraulichen OAuth-Client", need: "optional", scope: "functions", secret: true, group: "tvmcp", without: "Öffentlicher Client mit PKCE." }),
  v({ name: "TV_MCP_URL", purpose: "Adresse des TradingView-MCP-Servers", need: "optional", scope: "functions", secret: false, group: "tvmcp", without: "https://mcp.tradingview.com/mcp" }),
  v({ name: "TV_MCP_SCOPES", purpose: "Angeforderte OAuth-Scopes", need: "optional", scope: "functions", secret: false, group: "tvmcp", without: "mcp:read mcp:tools" }),
  // ── AI
  v({ name: "ANTHROPIC_API_KEY", purpose: "Anthropic-Schlüssel (nur Server)", need: "feature", scope: "functions", secret: true, group: "ai", without: "Coach-Formulierung, Screenshot-Import per KI, Strategie-Übersetzer und Assistent melden „nicht verfügbar“; die App rechnet alles andere lokal." }),
  v({ name: "COACH_MODEL", purpose: "Modell des Coachs (Standard claude-opus-5-5)", need: "optional", scope: "functions", secret: false, group: "ai", without: "Standardmodell." }),
  v({ name: "ROUTER_MODEL", purpose: "Modell des Assistenten-Routers", need: "optional", scope: "functions", secret: false, group: "ai", without: "Standardmodell." }),
  v({ name: "VISION_MODEL", purpose: "Modell des Screenshot-Imports (Standard = COACH_MODEL)", need: "optional", scope: "functions", secret: false, group: "ai", without: "COACH_MODEL." }),
  // ── SEC
  v({ name: "SEC_USER_AGENT", purpose: "Kontakt im User-Agent („Name kontakt@domain“) – die SEC verlangt ihn", need: "feature", scope: "functions", secret: false, group: "sec", without: "Die SEC-Funktionen melden „Einrichtung nötig“ und rufen die SEC nicht auf." }),
  // ── Ops / tuning
  v({ name: "OPS_TOKEN", purpose: "Betreiber-Token für /api/v1/ops/status (mindestens 24 Zeichen, zufällig)", need: "feature", scope: "functions", secret: true, group: "ops", without: "Die Statusseite antwortet 503 „nicht eingerichtet“ und gibt nichts preis." }),
  v({ name: "IP_HASH_PEPPER", purpose: "Geheimer Schlüssel (Version 1) für IP-Pseudonyme in Audit-Log und Raten-Begrenzung, für den gesalzenen Hash der E-Mail-Adresse in `contract_requests`, für die Wiederherstellungscodes der Zwei-Faktor-Anmeldung und für die Testphasen-Sperre (openssl rand -base64 32). PFLICHT in Produktion: ohne ihn gibt es dort keine neuen Wiederherstellungscodes, und `ops-status` meldet „unvollständig“", need: "must", scope: "functions", secret: true, group: "supabase", without: "Der Schlüssel wird aus SUPABASE_SECRET_KEY abgeleitet (nur zum Prüfen alter Codes); in Produktion gibt es keine neuen Wiederherstellungscodes." }),
  v({ name: "IP_HASH_PEPPER_V2", purpose: "Zweite Version des Pepper-Schlüssels (Rotation; `…_V3` bis `…_V9` ebenso): neue Hashes und Codes nutzen die höchste vorhandene Version, ältere bleiben zum Prüfen gültig – die alte Version erst entfernen, wenn kein Wiederherstellungscode und keine Testphasen-Sperre damit mehr gebraucht wird", need: "optional", scope: "functions", secret: true, group: "supabase", without: "Version 1 (`IP_HASH_PEPPER`) bleibt der Schlüssel." }),
  v({ name: "LOG_SAMPLE_RATE", purpose: "Anteil gespeicherter Fehlerberichte, 0–1 (Standard 1)", need: "optional", scope: "functions", secret: false, group: "supabase", without: "Alle Berichte (nur mit Einwilligung des Nutzers)." }),
  // ── Emergency switches (C4)
  v({ name: "KILL_SYNC", purpose: "Notfall-Schalter: Cloud-Sync und Börsen-Sync aus (true)", need: "optional", scope: "functions", secret: false, group: "switches", without: "Aus (Sync läuft)." }),
  v({ name: "KILL_CALLS", purpose: "Notfall-Schalter: keine Telefon-Anrufe (true)", need: "optional", scope: "functions", secret: false, group: "switches", without: "Aus (Anrufe erlaubt, sobald Twilio eingerichtet ist)." }),
  v({ name: "KILL_AI", purpose: "Notfall-Schalter: keine KI-Aufrufe (true)", need: "optional", scope: "functions", secret: false, group: "switches", without: "Aus (KI läuft, sobald ein Schlüssel da ist)." }),
  v({ name: "KILL_CHECKOUT", purpose: "Notfall-Schalter: Kaufstrecke zu (true) – neue Käufe gehen nicht, bestehende Abos und das Kundenportal bleiben", need: "optional", scope: "functions", secret: false, group: "switches", without: "Aus (Kauf läuft, sobald Stripe eingerichtet ist)." }),
  v({ name: "KILL_MAIL", purpose: "Notfall-Schalter: kein E-Mail-Versand (true) – Alarm-Mails, Test-Mails und die Bestätigungs-Mails zu Kündigung und Widerruf", need: "optional", scope: "functions", secret: false, group: "switches", without: "Aus (Mails gehen, sobald Resend eingerichtet ist)." }),
  // ── Legal (client)
  v({ name: "VITE_LEGAL_OPERATOR", purpose: "Impressum: Name/Firma des Anbieters (öffentlich, landet im Bundle; auch für die Functions der Kaufstrecke in Netlify setzen: Scope Builds UND Functions)", need: "optional", scope: "client", secret: false, group: "legal", without: "Markierter Platzhalter „[Platzhalter: VITE_LEGAL_OPERATOR]“, nichts wird erfunden; ohne Betreiber + Anschrift + E-Mail (oder eine Impressum-URL) bleibt die Kaufstrecke gesperrt (`purchase_closed`)." }),
  v({ name: "VITE_LEGAL_ADDRESS", purpose: "Impressum: Anschrift (Zeilen mit | getrennt)", need: "optional", scope: "client", secret: false, group: "legal", without: "Markierter Platzhalter; Kaufstrecke gesperrt (siehe VITE_LEGAL_OPERATOR)." }),
  v({ name: "VITE_LEGAL_EMAIL", purpose: "Impressum: Kontakt-E-Mail", need: "optional", scope: "client", secret: false, group: "legal", without: "Markierter Platzhalter; Kaufstrecke gesperrt (siehe VITE_LEGAL_OPERATOR)." }),
  v({ name: "VITE_LEGAL_PHONE", purpose: "Impressum: Telefon (zweiter Kommunikationsweg, empfohlen)", need: "optional", scope: "client", secret: false, group: "legal", without: "Markierter Platzhalter in den Entwürfen; im Impressum entfällt die Zeile." }),
  v({ name: "VITE_LEGAL_REPRESENTATIVE", purpose: "Impressum: vertretungsberechtigte Person (je Rechtsform)", need: "optional", scope: "client", secret: false, group: "legal", without: "Platzhalter in den Entwürfen, im Impressum keine Zeile." }),
  v({ name: "VITE_LEGAL_REGISTER", purpose: "Impressum: Registergericht und -nummer (je Rechtsform)", need: "optional", scope: "client", secret: false, group: "legal", without: "Wie VITE_LEGAL_REPRESENTATIVE." }),
  v({ name: "VITE_LEGAL_VAT_ID", purpose: "Impressum: USt-IdNr. (falls vorhanden)", need: "optional", scope: "client", secret: false, group: "legal", without: "Wie VITE_LEGAL_REPRESENTATIVE." }),
  v({ name: "VITE_LEGAL_RESPONSIBLE", purpose: "Impressum: Verantwortlicher für den Inhalt (§ 18 MStV, je Inhalt)", need: "optional", scope: "client", secret: false, group: "legal", without: "Wie VITE_LEGAL_REPRESENTATIVE." }),
  v({ name: "VITE_LEGAL_IMPRESSUM_URL", purpose: "Eigene Impressum-Seite (https oder Pfad dieser Site; ersetzt die In-App-Seite und die Pflicht für Betreiber/Anschrift/E-Mail)", need: "optional", scope: "client", secret: false, group: "legal", without: "In-App-Impressum aus den Betreiberdaten." }),
  v({ name: "VITE_LEGAL_DATENSCHUTZ_URL", purpose: "Eigene Datenschutzerklärung (Pflicht zum Verkaufen)", need: "optional", scope: "client", secret: false, group: "legal", without: "Der Entwurf aus docs/RECHT/datenschutz.md, markiert „Entwurf – Prüfung durch Anwalt nötig“, plus Hinweis auf die Variable; Kaufstrecke gesperrt." }),
  v({ name: "VITE_LEGAL_AGB_URL", purpose: "Eigene AGB (Pflicht zum Verkaufen)", need: "optional", scope: "client", secret: false, group: "legal", without: "Entwurf docs/RECHT/agb.md, markiert; Kaufstrecke gesperrt." }),
  v({ name: "VITE_LEGAL_WIDERRUF_URL", purpose: "Eigene Widerrufsbelehrung", need: "optional", scope: "client", secret: false, group: "legal", without: "Steht sie in den AGB (AGB-URL gesetzt): Hinweis darauf; sonst Entwurf docs/RECHT/widerruf.md, markiert." }),
  v({ name: "VITE_LEGAL_DRAFTS_REVIEWED", purpose: "`true` = der Betreiber erklärt, dass ein Anwalt die In-App-Entwürfe (docs/RECHT/) geprüft hat; blendet die Entwurfs-Leiste aus. Die App prüft die Erklärung nicht", need: "optional", scope: "client", secret: false, group: "legal", without: "Die Leiste „Entwurf – Prüfung durch Anwalt nötig“ steht über jedem Entwurf." }),
  v({ name: "VITE_SHOWROOM", purpose: "`1` = Showroom-Build (Paket S, docs/SHOWROOM.md): Mock-Backend im Browser, Demo-Banner, „Neu in dieser Version“. Setzen nur die npm-Skripte `build:showroom` und `build:showroom:deploy` (Netlify: nur Kontext deploy-preview) – nie in Produktion, nie im Netlify-Menü", need: "optional", scope: "build", secret: false, group: "site", without: "Normaler Build: kein Showroom-Code im Bundle (Test `showroom.bundle`)." }),
  // ── Partner links (client, public)
  v({ name: "VITE_PARTNER_TRADINGVIEW_REF", purpose: "Vollständiger https-Link des TradingView-Partnerprogramms (öffentlich, KEIN Geheimnis; Einrichtung und Kennzeichnung in docs/PARTNERLINKS.md). Heute leer lassen: der Betreiber hat noch keine Partnerkonten", need: "optional", scope: "client", secret: false, group: "partner", without: "Kein Partnerlink, der Dialog sieht aus wie ohne." }),
  v({ name: "VITE_PARTNER_BINANCE_REF", purpose: "Dasselbe für Binance", need: "optional", scope: "client", secret: false, group: "partner", without: "Wie oben." }),
  v({ name: "VITE_PARTNER_BITUNIX_REF", purpose: "Dasselbe für Bitunix", need: "optional", scope: "client", secret: false, group: "partner", without: "Wie oben." }),
  // ── Listed in .env.example, not read by code yet
  v({ name: "HYBLOCK_API_KEY", purpose: "Hyblock (optional, derzeit nicht gelesen)", need: "optional", scope: "functions", secret: true, group: "legal", without: "Hyblock-Werte werden von Hand eingetragen.", planned: true }),
  v({ name: "HYBLOCK_BASE_URL", purpose: "Hyblock (optional, derzeit nicht gelesen)", need: "optional", scope: "functions", secret: false, group: "legal", without: "Wie HYBLOCK_API_KEY.", planned: true }),
  v({ name: "HYBLOCK_AUTH_HEADER", purpose: "Hyblock (optional, derzeit nicht gelesen)", need: "optional", scope: "functions", secret: false, group: "legal", without: "Wie HYBLOCK_API_KEY.", planned: true }),
];

/** Group ids that exist only in the spec's tail (no setup state of their own). */
export const GROUP_LABELS: Readonly<Record<string, string>> = {
  alerts: "Vier Alarme: Zeitplan & Kostenbremse",
  binance: "Binance-Anbindung (alles optional)",
  partner: "Partnerlinks (Client, öffentlich)",
  switches: "Notfall-Schalter",
  legal: "Rechtliches & Sonstiges (Client)",
  ...Object.fromEntries(ENV_GROUPS.map((g) => [g.id, g.label])),
};

/** Function files and what each needs – the answer to "which function works with which variable?". */
export interface FunctionEnv {
  /** File name in `netlify/functions` (without extension). */
  fn: string;
  route: string;
  /** Group ids that must be "eingerichtet" for the function to do its job (`supabase` is implied for everything with a login). */
  groups: string[];
  /** Emergency switch that stops it. */
  switch?: "sync" | "calls" | "ai" | "checkout" | "mail";
}

export const FUNCTION_ENV: readonly FunctionEnv[] = [
  { fn: "account-export", route: "/api/v1/account/export", groups: ["supabase"] },
  { fn: "account-delete", route: "/api/v1/account/delete", groups: ["supabase"] },
  { fn: "account-backups", route: "/api/v1/account/backups", groups: ["supabase"] },
  { fn: "account-mfa-recovery", route: "/api/v1/account/mfa-recovery", groups: ["supabase"] },
  { fn: "audit", route: "/api/v1/audit", groups: ["supabase"] },
  { fn: "log", route: "/api/v1/log", groups: ["supabase"] },
  { fn: "backup-nightly", route: "(täglich)", groups: ["supabase"] },
  { fn: "billing-reconcile", route: "(täglich)", groups: ["supabase", "billing"] },
  { fn: "billing-status", route: "/api/v1/billing/status", groups: ["supabase"] },
  { fn: "billing-checkout", route: "/api/v1/billing/checkout", groups: ["supabase", "billing", "site"], switch: "checkout" },
  { fn: "billing-portal", route: "/api/v1/billing/portal", groups: ["supabase", "billing"] },
  { fn: "billing-code", route: "/api/v1/billing/code", groups: ["supabase", "billing"] },
  { fn: "billing-referral", route: "/api/v1/billing/referral", groups: ["supabase", "billing"] },
  { fn: "billing-contract", route: "/api/v1/billing/contract (+ /confirm)", groups: ["supabase", "mail", "site"], switch: "mail" },
  { fn: "stripe-webhook", route: "/api/v1/stripe/webhook", groups: ["supabase", "billing"] },
  { fn: "exchange-connect", route: "/api/v1/exchange/connect", groups: ["supabase", "exchange"], switch: "sync" },
  { fn: "exchange-disconnect", route: "/api/v1/exchange/disconnect", groups: ["supabase", "exchange"] },
  { fn: "exchange-sync", route: "/api/v1/exchange/sync", groups: ["supabase", "exchange"], switch: "sync" },
  { fn: "exchange-positions", route: "/api/v1/exchange/positions", groups: ["supabase", "exchange"], switch: "sync" },
  { fn: "exchange-backfill-background", route: "/api/v1/exchange/backfill", groups: ["supabase", "exchange"], switch: "sync" },
  { fn: "exchange-sync-cron", route: "(alle 30 Min)", groups: ["supabase", "exchange"], switch: "sync" },
  { fn: "alert-watch-cron", route: "(alle 5 Min)", groups: ["supabase", "mail", "site"], switch: "mail" },
  { fn: "alert-test", route: "/api/v1/alerts/test", groups: ["supabase", "mail"], switch: "mail" },
  // the four alarms (C2). `alerts-cron` also dials calls (stopped by KILL_CALLS: those deliveries are logged "übersprungen: Notschalter", e-mail goes on)
  { fn: "alerts-cron", route: "(alle 5 Min)", groups: ["supabase", "mail", "site"], switch: "mail" },
  { fn: "alerts-prefs", route: "/api/v1/alerts/prefs", groups: ["supabase"] },
  { fn: "alerts-feed", route: "/api/v1/alerts/feed", groups: ["supabase"] },
  { fn: "alerts-email-test", route: "/api/v1/alerts/email-test", groups: ["supabase", "mail"], switch: "mail" },
  { fn: "alerts-phone", route: "/api/v1/alerts/phone", groups: ["supabase", "phone", "exchange"], switch: "calls" },
  { fn: "alerts-twilio-status", route: "/api/v1/alerts/twilio/status", groups: ["supabase", "phone", "site"] },
  { fn: "coach-ask", route: "/api/v1/coach/ask", groups: ["supabase", "ai"], switch: "ai" },
  { fn: "shot-extract", route: "/api/v1/shot-extract", groups: ["supabase", "ai"], switch: "ai" },
  { fn: "strategy-compile", route: "/api/v1/strategy/compile", groups: ["supabase", "ai"], switch: "ai" },
  { fn: "assistant-route", route: "/api/v1/assistant/route", groups: ["supabase", "ai"], switch: "ai" },
  { fn: "sec-facts", route: "/api/v1/sec/facts", groups: ["supabase", "sec"] },
  { fn: "sec-filings", route: "/api/v1/sec/filings", groups: ["supabase", "sec"] },
  { fn: "hooks-tradingview", route: "/api/v1/hooks/tradingview/:token", groups: ["supabase"] },
  { fn: "signals-receive", route: "/api/v1/signals/:token", groups: ["supabase"] },
  { fn: "connections-tradingview", route: "/api/v1/connections/tradingview", groups: ["supabase", "site"] },
  { fn: "connections-tradingview-mcp", route: "/api/v1/connections/tradingview/mcp", groups: ["supabase", "tvmcp", "site", "exchange"] },
  { fn: "trades-api", route: "/api/v1/trades", groups: ["supabase"] },
  { fn: "social-share", route: "/api/v1/social/share", groups: ["supabase"] },
  { fn: "social-shared", route: "/api/v1/social/shared/:token", groups: ["supabase"] },
  { fn: "social-groups", route: "/api/v1/social/groups", groups: ["supabase"] },
  { fn: "social-leaderboard", route: "/api/v1/social/leaderboard", groups: ["supabase"] },
  { fn: "social-aggregate", route: "(täglich)", groups: ["supabase"] },
  { fn: "feedback", route: "/api/v1/feedback", groups: ["supabase"] },
  { fn: "ops-status", route: "/api/v1/ops/status", groups: ["ops"] },
  { fn: "ops-flags", route: "/api/v1/flags", groups: [] },
  // public data: no key, no account (the rate limit falls back to a per-instance counter without a database)
  { fn: "congress-index", route: "/api/v1/congress/index", groups: [] },
  { fn: "congress-ptr", route: "/api/v1/congress/ptr", groups: [] },
  { fn: "industry-daily", route: "/api/v1/industry/daily", groups: [] },
  { fn: "klines-proxy", route: "/api/v1/klines", groups: [] },
  { fn: "stock-bars", route: "/api/v1/stocks/bars", groups: [] },
  { fn: "stock-news", route: "/api/v1/stocks/news", groups: [] },
  { fn: "stock-quote", route: "/api/v1/stocks/quote", groups: [] },
  { fn: "stock-symbols", route: "/api/v1/stocks/symbols", groups: [] },
];

export type SetupState = "eingerichtet" | "teilweise" | "nicht eingerichtet";

export interface GroupStatus {
  id: string;
  label: string;
  serves: string;
  state: SetupState;
  /** Names that are missing (never values). */
  missing: string[];
  core: boolean;
}

const nonEmpty = (get: (n: string) => string | undefined, n: string): boolean => {
  const x = get(n);
  return typeof x === "string" && x.trim() !== "";
};

/** Setup state of one group from a name → value reader (only presence is looked at). */
export function groupStatus(g: EnvGroup, get: (name: string) => string | undefined): GroupStatus {
  const missing = g.all.filter((n) => !nonEmpty(get, n));
  const anyMissing = (g.anyOf ?? []).filter((names) => !names.some((n) => nonEmpty(get, n))).map((names) => names.join(" oder "));
  const setCount = g.all.length - missing.length + (g.anyOf ?? []).length - anyMissing.length;
  const total = g.all.length + (g.anyOf ?? []).length;
  const state: SetupState = setCount === total ? "eingerichtet" : setCount === 0 ? "nicht eingerichtet" : "teilweise";
  return { id: g.id, label: g.label, serves: g.serves, state, missing: [...missing, ...anyMissing], core: !!g.core };
}

export interface FunctionStatus {
  fn: string;
  route: string;
  state: SetupState;
  /** Group ids that are not (fully) set up. */
  blockedBy: string[];
  /** The emergency switch for this function is ON. */
  switchedOff: boolean;
}

/** Overall verdict – "bereit" only when every core group is complete; anything else says what is open. Never "alles frei" on missing input. */
export type Verdict = "bereit" | "unvollständig" | "nicht eingerichtet";

export interface EnvReport {
  verdict: Verdict;
  groups: GroupStatus[];
  functions: FunctionStatus[];
  /** Emergency switches that are ON. */
  switches: Record<"sync" | "calls" | "ai" | "checkout" | "mail", boolean>;
  /** Names set in the environment that the spec does not know (typos like STRIPE_SECRET_KY). Names only. */
  unknown: string[];
  /** Problems of a PRODUCTION deploy (`CONTEXT=production`) that are no missing group but a wrong state – German sentences, names only. Never "bereit" while one stands. */
  production: string[];
}

const truthy = (x: string | undefined): boolean => ["1", "true", "yes", "on"].includes((x ?? "").trim().toLowerCase());

/** Edit distance (small strings only). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/**
 * Names that look like a typo of one of ours (edit distance ≤ 2 from a known name, but not a known name): a typo is the
 * commonest reason a variable "does not work". Names that merely share a prefix (`ANTHROPIC_BASE_URL` of the SDK) are not
 * flagged.
 */
function looksLikeTypo(name: string, known: readonly string[]): boolean {
  if (known.includes(name) || /^EXCHANGE_ENC_KEY_V[1-9]$/.test(name) || name.length < 6) return false;
  return known.some((k) => Math.abs(k.length - name.length) <= 2 && distance(name, k) <= 2);
}

export function evaluateEnv(get: (name: string) => string | undefined, present: readonly string[] = []): EnvReport {
  const groups = ENV_GROUPS.map((g) => groupStatus(g, get));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const switches = { sync: truthy(get("KILL_SYNC")), calls: truthy(get("KILL_CALLS")), ai: truthy(get("KILL_AI")), checkout: truthy(get("KILL_CHECKOUT")), mail: truthy(get("KILL_MAIL")) };
  const functions: FunctionStatus[] = FUNCTION_ENV.map((f) => {
    const blockedBy = f.groups.filter((id) => byId.get(id)?.state !== "eingerichtet");
    const state: SetupState = blockedBy.length === 0 ? "eingerichtet" : blockedBy.length === f.groups.length ? "nicht eingerichtet" : "teilweise";
    return { fn: f.fn, route: f.route, state, blockedBy, switchedOff: f.switch ? switches[f.switch] : false };
  });
  const core = groups.filter((g) => g.core);
  const coreOk = core.every((g) => g.state === "eingerichtet");
  const coreNone = core.every((g) => g.state === "nicht eingerichtet");
  // a half-set group (one Stripe key without the webhook secret) is a mistake, not "off": it is never "bereit"
  const partial = groups.some((g) => g.state === "teilweise");
  // Runde 11: states of a PRODUCTION deploy that are never fine – the app would run open (no Stripe) or without the one long-lived secret
  const production: string[] = [];
  if (get("CONTEXT") === "production") {
    const billing = byId.get("billing");
    if (billing && billing.state !== "eingerichtet" && !truthy(get("ALLOW_UNGATED"))) {
      production.push("Zahlungen sind in Produktion nicht (vollständig) eingerichtet: die Server-Funktionen laufen GESCHLOSSEN (jedes Konto zählt als Free; Telefon, SMS, KI und Hintergrund-Sync sind zu). Stripe einrichten – oder bewusst `ALLOW_UNGATED=true` setzen.");
    }
    if (!nonEmpty(get, "IP_HASH_PEPPER") && ![2, 3, 4, 5, 6, 7, 8, 9].some((v) => nonEmpty(get, `IP_HASH_PEPPER_V${v}`))) {
      production.push("IP_HASH_PEPPER fehlt: ohne ihn gibt es in Produktion keine neuen Wiederherstellungscodes für die Zwei-Faktor-Anmeldung.");
    }
  }
  const verdict: Verdict = coreOk && !partial && !production.length ? "bereit" : coreNone && !partial && !production.length ? "nicht eingerichtet" : "unvollständig";
  const names = ENV_SPEC.map((e) => e.name);
  const unknown = present.filter((n) => looksLikeTypo(n, names)).sort();
  return { verdict, groups, functions, switches, unknown, production };
}
