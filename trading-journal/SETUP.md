# Einrichtung – Trading-Journal mit Cloud, Abos und Börsen-Sync

Diese Anleitung bringt das Journal Schritt für Schritt von „läuft lokal im Browser“ zu „läuft auf Netlify mit Login,
Sync, Abos und Bitunix-Sync“. Jeder Schritt ist für sich nützlich: ohne Supabase bleibt die App rein lokal (alles im
Browser, keine Konten), ohne Stripe gibt es Login und Sync ohne Bezahlschranke, ohne `EXCHANGE_ENC_KEY_V1` bleibt der
CSV-Import der Weg für Börsen-Trades. Die App sagt in jedem dieser Fälle ehrlich, was fehlt.

| Baustein | wofür | ohne ihn |
|---|---|---|
| Netlify | Website (`/` persönlich, `/teilen/` Teilen-Ausgabe), Functions unter `/api/v1/…`, geplante Jobs | – |
| Supabase (EU) | Login, 2FA, Sync zwischen Geräten, Backups, Screenshots, Community | App bleibt lokal, Konto/Preise/Community ausgeblendet |
| Stripe | Abos (Pro, Premium, Team), Testphase, Kundenportal, Empfehlungen | alle Funktionen frei, keine Preise/Abos |
| Bitunix (nur Lesen) | Trades kommen von selbst ins Journal | CSV-Import (neun Formate) |
| Anthropic (optional) | „Mit KI formulieren“ im Coach (nur berechnete Fakten werden gesendet) | Coach formuliert selbst |

> Zeitbedarf: ca. 60–90 Minuten für alles. Reihenfolge einhalten – die Supabase-Werte müssen vor dem Build in Netlify
> stehen, weil Vite sie beim Bauen in die App schreibt.

---

## 0. Voraussetzungen

- Node **22** (wie auf Netlify, `NODE_VERSION = "22"` in `netlify.toml`), npm 10.
- Konten: GitHub (Repo), Netlify, Supabase, Stripe; für den Börsen-Sync ein Bitunix-Konto.
- Optional: [Supabase CLI](https://supabase.com/docs/guides/cli), [Stripe CLI](https://docs.stripe.com/stripe-cli),
  [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`netlify dev` für Functions lokal), `openssl`.

Lokal starten (ohne Cloud):

```bash
cd trading-journal
npm ci
npm run dev          # http://localhost:5173 – rein lokal, solange .env.local keine Supabase-Werte hat
```

Prüfbefehle (dieselben wie in der CI): `npm run typecheck && npm run lint && npm test && npm run build && npm run build:share`.

---

## 1. Netlify-Site anlegen

1. Netlify → **Add new site → Import an existing project** → GitHub → dieses Repository.
2. Build-Einstellungen **nicht** von Hand setzen – `netlify.toml` im Repo-Root regelt alles:
   Basisverzeichnis `trading-journal`, Befehl `npm ci && npm run build && npm run build:share`, Ausgabe `dist`,
   Functions aus `trading-journal/netlify/functions`, Node 22, Sicherheits-Header (CSP) und die Binance-Weiterleitungen.
3. Ersten Deploy laufen lassen. Ergebnis: die lokale App unter `https://<deine-site>.netlify.app` (noch ohne Konto).
4. Die Adresse notieren – sie wird gleich als **Site-URL** gebraucht (`SITE_ORIGIN`, Supabase-Redirects, Stripe-Webhook).
   Eigene Domain? Dann jetzt unter **Domain management** verbinden und überall diese Domain verwenden.

---

## 2. Supabase-Projekt

1. [supabase.com](https://supabase.com) → **New project**, Region **Central EU (Frankfurt)**, starkes DB-Passwort
   (im Passwortmanager ablegen).
2. **Organization → Legal Documents**: den Auftragsverarbeitungsvertrag (DPA/AVV) abschließen (DSGVO).
3. **Project Settings → API Keys** notieren:
   - **Project URL** (`https://<ref>.supabase.co`) → `VITE_SUPABASE_URL` **und** `SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) → `VITE_SUPABASE_PUBLISHABLE_KEY` (öffentlich, landet im Bundle)
   - **Secret key** (`sb_secret_…`) → `SUPABASE_SECRET_KEY` (**nur** für die Functions, niemals mit `VITE_`-Präfix)

### 2.1 Migrationen 0001 → 0006

Die Dateien liegen in `trading-journal/supabase/migrations/` und werden **genau einmal, in dieser Reihenfolge**
ausgeführt (nie eine angewendete Migration ändern – Änderungen kommen als neue Datei):

| Datei | Inhalt |
|---|---|
| `0001_core.sql` | Profile, Journal-Dokumente (+ Realtime), Rate-Limits, Audit-Log, Fehlerberichte, Börsen-Verbindungen, 2FA-Regel, Buckets `screenshots` / `backups` |
| `0002_billing.sql` | Stripe-Kunden, Abos, Team-Plätze, Empfehlungscodes, Gutschriften, Webhook-Idempotenz |
| `0003_exchange.sql` | Sync-Läufe, Sync-Cursor, API-Tokens, `upsert_synced_trade(s)` |
| `0004_social.sql` | Gruppen, Mitglieder, Pseudonyme, Einladungen, Reviews, Kommentare, Ziele, Teilen-Links, Bestenlisten (k ≥ 10) |
| `0005_mfa_everywhere.sql` | 2FA-Regel überall: mit aktiver 2FA sieht eine Sitzung ohne Code-Eingabe weder Screenshots noch Audit-Log, Abo-, Teilen-, Token- oder Community-Daten |
| `0006_sync_schedule.sql` | Faire Warteschlange für den automatischen Börsen-Sync (`next_sync_at`, `sync_failures`): fehlschlagende oder nicht mehr berechtigte Verbindungen blockieren zahlende Trader nicht mehr |

**Variante A – SQL-Editor (ohne CLI):** Supabase → **SQL Editor → New query** → Inhalt von `0001_core.sql` einfügen →
**Run** → „Success“ abwarten. Dann `0002` bis `0006` genauso.

**Variante B – CLI:**

```bash
cd trading-journal
supabase login
supabase link --project-ref <ref>
supabase db push            # wendet supabase/migrations/* in Reihenfolge an
```

**Kontrolle danach:**

- **Table Editor**: u. a. `profiles`, `journal_docs`, `subscriptions`, `sync_runs`, `groups` sind da, überall „RLS enabled“.
- **Storage**: Buckets `screenshots` und `backups`, beide **privat**, und unter **Storage → Policies** vier Regeln
  „screenshots: read / insert / update / delete own“ (nur der eigene Ordner `<auth.uid()>/…`). Auf Supabase legt
  0001 beides an. Fehlt etwas: Buckets von Hand anlegen (Name exakt, „Public bucket“ aus) und die vier Policies aus
  `0001_core.sql` (Abschnitt „Storage“) im SQL-Editor nachziehen. `backups` bekommt **keine** Client-Policy.
- **Database → Publications → `supabase_realtime`**: `journal_docs` ist enthalten (sonst hier anhaken).

### 2.2 Auth

**Authentication → URL Configuration**

- **Site URL**: `https://<deine-site>.netlify.app` (bzw. die eigene Domain)
- **Redirect URLs**: `https://<deine-site>.netlify.app/`, `https://<deine-site>.netlify.app/teilen/` und für
  Deploy-Previews `https://*--<deine-site>.netlify.app/**`; für lokale Tests zusätzlich `http://localhost:5173/`.

**Authentication → Sign In / Providers**

- E-Mail aktiv lassen („Confirm email“ an). Für den Echtbetrieb einen eigenen SMTP-Server eintragen
  (**Authentication → Emails → SMTP Settings**) – der eingebaute Versand ist stark begrenzt.
- Optional OAuth (Google, GitHub, Apple, Discord): Provider hier aktivieren und dieselben Namen kommagetrennt in
  `VITE_SUPABASE_OAUTH_PROVIDERS` eintragen (z. B. `google,github`). Nur eingetragene Provider zeigen einen Knopf.

**Authentication → Multi-Factor**: **TOTP** aktivieren. Sobald jemand 2FA einrichtet, verlangen Journal und
Börsen-Verbindungen eine 2FA-Sitzung (Regel aus 0001).

**Authentication → Emails → Templates**: Bestätigung, Magic Link, Passwort zurücksetzen und E-Mail-Änderung auf
Deutsch übersetzen (die App selbst ist komplett deutsch).

---

## 3. Umgebungsvariablen in Netlify

Netlify → **Site configuration → Environment variables → Add a variable**. Zwei Arten, streng getrennt:

- `VITE_*` sind **öffentlich** und werden beim **Build** in die App geschrieben → Scope **Builds** (nicht als
  „secret“ markieren, sonst schlägt Netlifys Secret-Scan beim Build an, weil der Wert absichtlich im Bundle steht).
- Alles andere sind **Server-Geheimnisse** → Scope **Functions**, „Contains secret values“ an, **nie** mit `VITE_`.

| Variable | Wert | Scope |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | Builds |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Builds |
| `VITE_SUPABASE_OAUTH_PROVIDERS` | optional, z. B. `google,github` | Builds |
| `VITE_LEGAL_*` | Impressum-Daten und Links zu Datenschutz / AGB / Widerruf – siehe 4.2 | Builds |
| `SUPABASE_URL` | Project URL (gleicher Wert) | Functions |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Functions, secret |
| `SITE_ORIGIN` | `https://<deine-site>.netlify.app` (ohne `/` am Ende) | Functions |
| `STRIPE_SECRET_KEY` | `sk_test_…` (Schritt 4) | Functions, secret |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (Schritt 4) | Functions, secret |
| `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY` | `price_…` | Functions |
| `STRIPE_PRICE_PREMIUM_MONTHLY` / `_YEARLY` | `price_…` | Functions |
| `STRIPE_PRICE_TEAM_MONTHLY` / `_YEARLY` | `price_…` (pro Platz) | Functions |
| `TRIAL_DAYS` | optional, Standard `14` | Functions |
| `STRIPE_TRIAL_CARDLESS` | optional `true` = Testphase ohne Karte (Standard `false`) | Functions |
| `STRIPE_AUTOMATIC_TAX` | optional `true` = Stripe Tax im Checkout (Standard `false`) | Functions |
| `REFERRAL_TRIAL_DAYS` | optional, Standard `30` | Functions |
| `REFERRAL_REWARD_CENTS` | optional, Standard `1000` (10 €) | Functions |
| `EXCHANGE_ENC_KEY_V1` | `openssl rand -base64 32` (Schritt 5) | Functions, secret |
| `SYNC_CRON_ENABLED` | optional `false` stoppt den 30-Minuten-Sync | Functions |
| `LOG_SAMPLE_RATE` | optional `0`–`1`, Anteil gespeicherter Fehlerberichte (Standard `1`) | Functions |
| `IP_HASH_PEPPER` | empfohlen, `openssl rand -base64 32`: geheimer Schlüssel der IP-Pseudonyme in Audit-Log und Rate-Limits (HMAC). Ohne ihn wird er aus `SUPABASE_SECRET_KEY` abgeleitet; die rohe IP wird nie gespeichert | Functions, secret |
| `ANTHROPIC_API_KEY` | optional, KI-Formulierung im Coach (Premium). Ohne Schlüssel verkauft die Preisseite keinen „KI-Coach“: Premium-Highlight, Vergleichstabelle und Upgrade-Dialog lassen ihn weg (`billing/status` meldet `coachAi: false`) | Functions, secret |
| `COACH_MODEL` | optional, Standard `claude-opus-5-5` | Functions |

`.env.example` listet dieselben Namen (ein Test stellt sicher, dass dort jede Variable steht, die App oder Functions
lesen). Die `HYBLOCK_*`-Zeilen sind reserviert und werden derzeit von keiner Function gelesen.

Danach: **Deploys → Trigger deploy → Clear cache and deploy site.** Erst dieser neue Build enthält die Supabase-Werte.

**Kontrolle:** Seite neu laden → in der Kopfzeile erscheint „Anmelden“, in der Navigation (Menü bzw. ⌘K) gibt es
**Konto**, **Preise** und **Community**. Registrieren, Bestätigungsmail anklicken, anmelden, einen Trade anlegen, auf einem zweiten Gerät
anmelden – der Trade kommt dort ohne Neuladen an (Realtime). In Supabase steht er in `journal_docs`.

---

## 4. Stripe (zuerst im Testmodus)

Solange `STRIPE_SECRET_KEY` fehlt, meldet der Server „Zahlungen sind noch nicht eingerichtet“ – dann gibt es keine
Bezahlschranke, alle Funktionen sind frei. **Sobald Stripe eingerichtet ist, gelten die Pläne aus
`src/billing/plans.ts`** (Free sieht bei Analyse-Pro, Risiko, Coach, Berichten, Labor, Wachstum und Cockpit die
Upgrade-Karte).

1. Stripe-Dashboard, oben **Testmodus** einschalten.
2. **Produktkatalog → Produkt hinzufügen**, je ein Produkt mit zwei wiederkehrenden Preisen (EUR, inkl. MwSt.;
   die Listenpreise der App stehen in `LIST_PRICES` – die Preisseite zeigt aber immer die echten Stripe-Preise):

   | Produkt | monatlich | jährlich | Variablen |
   |---|---|---|---|
   | Pro | 12 € | 120 € | `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY` |
   | Premium | 24 € | 240 € | `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY` |
   | Team | 19 € **pro Platz** | 190 € **pro Platz** | `STRIPE_PRICE_TEAM_MONTHLY`, `STRIPE_PRICE_TEAM_YEARLY` |

   Team: Preismodell „pro Einheit“ (die App schickt die Anzahl Plätze, 2–50). Die sechs `price_…`-IDs kopieren.
3. **Entwickler → API-Schlüssel**: geheimer Schlüssel `sk_test_…` → `STRIPE_SECRET_KEY`.
4. **Entwickler → Webhooks → Endpunkt hinzufügen**: URL `https://<deine-site>.netlify.app/api/v1/stripe/webhook`,
   Ereignisse:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
   `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`.
   Signatur-Geheimnis `whsec_…` → `STRIPE_WEBHOOK_SECRET`.
5. **Einstellungen → Billing → Kundenportal**: Kündigung erlauben (zum Periodenende, mit Gründen),
   Zahlungsmethode ändern, Rechnungsverlauf, **Abo wechseln zwischen den sechs Preisen** (der Knopf „Wechseln“ in der
   App springt genau dorthin). Links zu AGB und Datenschutz eintragen.
6. Optional: **Gutscheine / Aktionscodes** anlegen (die Preisseite prüft Codes live), **Steuern** (Stripe Tax, dann
   `STRIPE_AUTOMATIC_TAX=true`), Rechnungseinstellungen (deutsche Rechnungen, Firmendaten).
7. Variablen in Netlify eintragen (Schritt 3) und neu deployen.

**Test:** In der App **Preise** → bei Pro **14 Tage gratis testen** → Stripe-Checkout mit Testkarte `4242 4242 4242 4242`,
beliebiges künftiges Datum, beliebige Prüfziffer. Zurück in der App zeigt **Konto** den Plan Pro mit laufender Testphase. Im
Stripe-Dashboard hat der Webhook mit **200** geantwortet; in Supabase steht das Abo in `subscriptions`, der Plan in
`profiles.plan`.

Webhooks lokal testen (Functions über die Netlify CLI):

```bash
cd trading-journal
netlify dev                                   # App + Functions auf http://localhost:8888
stripe listen --forward-to localhost:8888/api/v1/stripe/webhook
# das ausgegebene whsec_… als STRIPE_WEBHOOK_SECRET in .env eintragen, netlify dev neu starten
stripe trigger checkout.session.completed
```

Eigenen Zugang ohne Abo (z. B. für den Betreiber), im SQL-Editor:

```sql
update profiles set plan = 'premium' where id = '<user-uuid>';   -- bleibt, bis ein Webhook für diesen Nutzer ihn neu setzt
```

### 4.1 Affiliates verwalten (SQL, es gibt dafür keine Admin-Seite in der App)

Jeder Nutzer bekommt unter **Konto → Empfehlen** einen Code (er entsteht beim ersten Öffnen der Karte). Ein normaler
Code bringt dem Werbenden eine einmalige Gutschrift auf seine Stripe-Rechnung (`REFERRAL_REWARD_CENTS`). Zum Affiliate
wird ein Code erst, wenn der Betreiber eine Provision setzt – dann bucht der Webhook für jede bezahlte Rechnung der
geworbenen Kunden 12 Monate lang eine Provision als `pending` in `affiliate_ledger` (Beträge in Cent). Ausgezahlt wird
außerhalb der App; danach markierst du die Einträge als bezahlt. Alles im Supabase-SQL-Editor:

```sql
-- Affiliate freischalten (Provision in Prozent, erlaubt: über 0 bis 50)
update referral_codes set commission_pct = 25 where code = 'ABCD2345';

-- offene Provisionen je Affiliate (in Euro)
select c.code, l.referrer_id, l.currency, count(*) as rechnungen, sum(l.amount) / 100.0 as offen
from affiliate_ledger l join referral_codes c on c.user_id = l.referrer_id
where l.kind = 'commission' and l.status = 'pending'
group by c.code, l.referrer_id, l.currency
order by offen desc;

-- nach der Auszahlung als bezahlt markieren
update affiliate_ledger set status = 'paid'
where referrer_id = '<user-uuid>' and kind = 'commission' and status = 'pending';

-- eine Provision zu einer erstatteten Rechnung stornieren
update affiliate_ledger set status = 'void' where stripe_invoice_id = 'in_…' and kind = 'commission';

-- Affiliate wieder zum normalen Empfehlungscode machen
update referral_codes set commission_pct = null where code = 'ABCD2345';
```

Der Affiliate sieht seine Provisionen (offen / bezahlt) selbst in der Karte **Empfehlen**. Wer eine Oberfläche mit
Auszahlungen braucht, kann statt dessen einen externen Affiliate-Dienst mit Stripe-Anbindung nutzen – der ist in der App
nicht eingebaut.

**Live gehen:** dieselben Produkte, Preise, Webhook und Portal-Einstellungen im Live-Modus anlegen, `sk_live_…`,
das neue `whsec_…` und die Live-`price_…`-IDs in Netlify eintragen, neu deployen. Vorher Impressum, AGB, Widerruf und
Datenschutzerklärung bereitstellen und eintragen (Abschnitt 4.2).

### 4.2 Rechtliches (Impressum, Datenschutz, AGB, Widerruf)

Die App erfindet weder Betreiber noch Anschrift, Steuernummer oder Rechtstexte. Sie zeigt nur, was du als Betreiber
in Netlify unter **Environment variables** (Scope **Builds**, öffentlich – keine Geheimnisse) einträgst, und markiert
alles Fehlende sichtbar als **„Platzhalter – vom Betreiber auszufüllen“**. Nach jeder Änderung neu deployen (Vite
übernimmt `VITE_*` beim Build).

| Variable | Pflicht | Inhalt |
|---|---|---|
| `VITE_LEGAL_OPERATOR` | ja* | Name bzw. Firma des Anbieters |
| `VITE_LEGAL_ADDRESS` | ja* | ladungsfähige Anschrift, Zeilen mit `|` getrennt, z. B. `Musterstraße 1|12345 Musterstadt` |
| `VITE_LEGAL_EMAIL` | ja* | Kontakt-E-Mail |
| `VITE_LEGAL_PHONE` | nein | Telefon |
| `VITE_LEGAL_REPRESENTATIVE` | je nach Rechtsform | vertretungsberechtigte Person (z. B. Geschäftsführer) |
| `VITE_LEGAL_REGISTER` | je nach Rechtsform | Registergericht und -nummer |
| `VITE_LEGAL_VAT_ID` | falls vorhanden | Umsatzsteuer-ID |
| `VITE_LEGAL_RESPONSIBLE` | je nach Inhalt | Verantwortlicher für den Inhalt |
| `VITE_LEGAL_IMPRESSUM_URL` | nein | eigene Impressum-Seite statt der App-Ansicht (*dann entfallen die drei Pflichtfelder) |
| `VITE_LEGAL_DATENSCHUTZ_URL` | ja | deine Datenschutzerklärung (https-Link oder Pfad auf dieser Site) |
| `VITE_LEGAL_AGB_URL` | ja | deine AGB |
| `VITE_LEGAL_WIDERRUF_URL` | nein | eigene Widerrufsbelehrung; ohne sie verweist die App auf die AGB |

Wo die Links erscheinen: im Footer jeder Seite, auf **Konto**, im Rechtshinweis der **Preise**, bei der Registrierung
(Pflicht-Häkchen „Ich akzeptiere die AGB und habe die Datenschutzerklärung gelesen“ – auch vor einer Registrierung über
Google & Co.) und vor jedem Stripe-Checkout (Pflicht-Häkchen zu AGB, Widerrufsbelehrung und Datenschutzerklärung im
Upgrade-Dialog). Direkte Links für Stripe, E-Mails oder die Website: `https://<deine-site>/?rechtliches=impressum`
(ebenso `datenschutz`, `agb`, `widerruf`). In Stripe unter **Einstellungen → Öffentliche Details** die Links zu AGB und
Datenschutz eintragen. Innerhalb von claude.ai (persönliches Journal) wird nichts verkauft – dort bleiben die Links aus.

Die Texte selbst (Datenschutzerklärung mit Supabase/Netlify/Stripe/Binance als Empfänger, AGB mit Laufzeit und Kündigung,
Widerrufsbelehrung für digitale Abos, ggf. AVV) musst du als Betreiber erstellen bzw. von einem Anwalt oder
Rechtstext-Dienst prüfen lassen – die App liefert dafür keine Vorlage, die als fertig gelten könnte.

---

## 5. Börsen-Sync mit Bitunix (nur Lesen)

### 5.1 Server vorbereiten

```bash
openssl rand -base64 32
```

Ergebnis als `EXCHANGE_ENC_KEY_V1` (Scope Functions, secret) eintragen und neu deployen. Damit werden API-Schlüssel
und -Geheimnis AES-256-GCM-verschlüsselt gespeichert; der Browser sieht nach dem Verbinden nur noch die letzten vier
Zeichen. **Diesen Schlüssel nie verlieren oder ändern** – ohne ihn sind gespeicherte Verbindungen unlesbar.
Rotation: `EXCHANGE_ENC_KEY_V2` zusätzlich anlegen und neu deployen. Alte Verbindungen werden weiter entschlüsselt
und mit V2 neu verschlüsselt – sofort bei jedem Sync und jeder Positionsabfrage, alle übrigen (auch ungültige oder
pausierte) durch den 30-Minuten-Job, 50 pro Lauf. Im Function-Log von `exchange-sync-cron` steht danach
`"keys":{"rotated":…,"failed":…,"remaining":…}`; erst bei `"remaining":0` darf `EXCHANGE_ENC_KEY_V1` entfernt werden.
`failed` zählt Verbindungen, die sich nicht entschlüsseln lassen (Schlüssel fehlt) – diese müssen neu verbunden werden.

### 5.2 API-Schlüssel bei Bitunix anlegen

1. Bitunix → Profil → **API-Verwaltung** → **API erstellen**.
2. Berechtigungen: **nur Lesen**. **Kein** Trading, **keine** Auszahlung, keine Übertragung.
3. **Keine IP-Bindung** – Netlify Functions haben keine festen IP-Adressen; mit Bindung lehnt Bitunix jeden Aufruf ab
   (die App meldet das als „IP-Bindung“).
4. API-Key und Secret Key kopieren (das Secret zeigt Bitunix nur einmal).

Der Server ruft ohnehin nur eine feste Liste von Lese-Endpunkten auf (`READ_PATHS` in
`netlify/functions/_lib/exchanges/bitunix.ts`) – selbst ein falsch berechtigter Schlüssel könnte über diesen Code keine
Order platzieren. Trotzdem: nur Lesen.

### 5.3 Verbinden und erster Probelauf

1. In der App anmelden → **Konto** → Karte **Börse** → **Bitunix verbinden**.
2. Key und Secret einfügen, Journal-Konto wählen (Makro / Scalp), „nur Lesen“ bestätigen → **Verbinden**. Der Server
   prüft den Schlüssel mit einem signierten Leseaufruf und zeigt das Guthaben.
3. Im folgenden Dialog **Erstimport** zuerst **Erst Probelauf** wählen (nicht gleich importieren; später jederzeit
   über **Probelauf** auf der Karte). Der Probelauf (`POST /api/v1/exchange/sync?dryRun=1`)
   zeigt, was im Journal landen würde, **ohne etwas zu speichern** und ohne den Sync-Stand zu bewegen.
4. Im Probelauf zwei, drei Positionen mit der **Positionshistorie in Bitunix** vergleichen:
   - **Zeiten**: Ein- und Ausstieg stimmen in deiner Zeitzone (der Server rechnet Bitunix-Millisekunden in die
     Zeitzone des Browsers um).
   - **Netto-P&L** = realisierter Gewinn − Gebühr + Funding. Die Zeile „Gebühren geprüft: Bitunix meldet den Gewinn ohne
     Gebühren (n Positionen nachgerechnet)“ zeigt, welche Konvention erkannt wurde; Gebühren werden nie doppelt abgezogen.
   - **Funding**: gezahltes Funding mindert den Gewinn, erhaltenes erhöht ihn.
   - **Ende des Zeitraums**: die jüngste geschlossene Position ist dabei.
   Weicht etwas ab: nicht importieren, sondern den Probelauf (Screenshot, ohne Schlüssel) an den Entwickler geben.
5. Passt alles: Zeitraum wählen (30 / 90 / 180 Tage, 1 Jahr) → **Erstimport starten**. Er läuft als Hintergrund-Function
   (`exchange-backfill-background`, bis 15 Minuten); die Karte zeigt den Fortschritt.
6. Ab jetzt synchronisiert `exchange-sync-cron` alle 30 Minuten (nur auf **veröffentlichten** Deploys, nicht in
   Previews), dazu „Jetzt synchronisieren“ in der App. Was die Börse nicht weiß (Setup, Stop, Gefühl), ergänzt der
   Karte **Zu prüfen** (importierte Trades ohne Setup, Stop oder Gefühl). Von Hand getippte Stops oder Notizen überschreibt der Sync nie.

**Kontrolle:** Netlify → **Logs → Functions** → `exchange-sync-cron` zeigt alle 30 Minuten einen Lauf; Supabase →
`sync_runs` enthält die Läufe mit Zählern (`fetched`, `inserted`, `updated`, `unchanged`) und ggf. einer deutschen
Fehlermeldung.

Ohne Bitunix: **Einstellungen → Daten → Backup importieren → CSV importieren** (oder **CSV importieren** auf der
Karte Börse) liest die Exporte von Bitunix, Binance, Bybit und weiteren Plattformen
(auch ganz ohne Cloud).

---

## 6. Geplante Functions und Logs

| Function | Zeitplan | Aufgabe |
|---|---|---|
| `exchange-sync-cron` | alle 30 min | Bitunix-Sync aller Verbindungen mit Auto-Sync (`SYNC_CRON_ENABLED=false` schaltet ab) |
| `backup-nightly` | täglich | Server-Backup jedes geänderten Journals nach `backups/<user>/<tag>.json`, 14 Tage aufbewahrt |
| `social-aggregate` | täglich | Bestenlisten-Schnappschüsse und Community-Verteilungen (nur Opt-ins, mindestens 10 Personen) |

Netlify → **Functions** listet sie mit „Scheduled“ und dem nächsten Lauf. Zeitpläne stehen im Code der Functions
(`export const config = { schedule }`), `netlify.toml` dokumentiert sie.

---

## 7. Sicherheit nach der Einrichtung

- **CSP enger stellen:** `netlify.toml` erlaubt `https://*.supabase.co` und `wss://*.supabase.co`, weil die
  Projekt-Ref nicht im Repo steht. Nach der Einrichtung beide Einträge (in `connect-src` und `img-src`) durch
  `https://<ref>.supabase.co` bzw. `wss://<ref>.supabase.co` ersetzen. Die CSP gilt nur auf Netlify – nach dem Deploy
  in der Browser-Konsole prüfen, dass keine „Content Security Policy“-Meldung erscheint (Login, Sync, Screenshot
  hochladen, Markt-Seite mit Live-Daten).
- **2FA** für das eigene Konto einrichten (Konto → Sicherheit).
- **Supabase → Auth → Rate Limits** prüfen; die Functions haben eigene Limits (`rate_hit()`).
- Geheimnisse nur in Netlify (Scope Functions) – nie in `VITE_*`, nie ins Repo. `.env` / `.env.local` sind
  git-ignoriert.

---

## 8. CI und Tests

`.github/workflows/ci.yml` (Repo-Root) läuft bei jedem Push und Pull Request:

- **check**: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run budget`
  (Größe der Erstladung, `scripts/bundleBudget.mjs`), `npm run build:share`.
- **e2e** (nur Pull Requests): installiert Chromium (`npx playwright install --with-deps chromium`) und führt die
  Playwright-Specs gegen den Produktions-Build (`vite preview`) aus – mobil und Desktop. Zwei Server: der normale Build
  (ohne Cloud, Port 4173) und eine Cloud-Ausgabe gegen den Supabase-Mock der Tests (`npm run build:e2e-cloud`, Port 4174)
  für Konto, Preise, Börse und Community.

Lokal:

```bash
npm run e2e -- --project=mobile --project=desktop   # baut alles und startet vite preview auf :4173 und :4174
# gegen schon laufende Preview-Server:
PW_BASE_URL=http://127.0.0.1:4173 PW_CLOUD_BASE_URL=http://127.0.0.1:4174 \
  npx playwright test tests/e2e/pages.spec.ts --project=mobile --project=desktop
```

Die Specs laufen ohne echtes Supabase / Stripe / Bitunix (Netzwerk wird in den Tests nachgebildet). Den echten
Durchstich (Schritte 3–5) einmal von Hand mit Testkonten prüfen.
