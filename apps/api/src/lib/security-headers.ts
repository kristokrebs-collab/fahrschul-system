/**
 * PROMPT -1 §17 – Content Security Policy und die übrigen Sicherheitskopfzeilen.
 *
 * ## Warum die CSP hier die WICHTIGSTE Maßnahme ist
 *
 * Phase 2 speichert lokale Entwürfe AES-256-GCM-verschlüsselt (Schlüssel je
 * Gerät+Benutzer). Das schützt gegen Speicherinspektion, Backups und
 * Support-Exporte – und ausdrücklich NICHT gegen XSS: Code, der in der Seite
 * läuft, hat denselben Schlüsselzugriff wie die App. Diese Lücke steht in
 * docs/sync-architecture.md („Entwurfsverschlüsselung schützt nicht gegen
 * XSS – der Seam für §17 ist vorhanden, aber nicht verdrahtet"). Die CSP ist
 * genau dieser Seam: sie verhindert, dass fremder Code überhaupt zur
 * Ausführung kommt.
 *
 * ## Die Politik – und warum sie mit vier Vite-Builds tatsächlich funktioniert
 *
 * Untersucht, nicht vermutet (`apps/<app>/dist/index.html`): Vite erzeugt für
 * diese Apps ausschließlich EXTERNE Ressourcen –
 * `<script type="module" crossorigin src="/assets/index-[hash].js">` und
 * `<link rel="stylesheet" href="/assets/index-[hash].css">`. Kein Inline-`<script>`,
 * kein `eval`. Deshalb braucht `script-src` **kein** `'unsafe-inline'` und
 * **kein** `'unsafe-eval'` – ein Escape-Ventil, das die CSP wertlos machen
 * würde, ist nicht nötig und ist auch nicht gesetzt.
 *
 * Zwei Ausnahmen sind begründet, nicht bequem:
 *
 *  1. **`style-src 'self' 'unsafe-inline'`.** Drei Dateien in `apps/finance`
 *     und `apps/student/src/components/Tacho.tsx` benutzen React
 *     `style={{…}}`, was zu INLINE-STYLE-ATTRIBUTEN wird. Ein Style-Attribut
 *     kann keinen Code ausführen; das Restrisiko ist CSS-basierte
 *     Datenexfiltration und Umgestaltung, nicht Skriptausführung. Der Preis
 *     für die Alternative (Nonce-Verwaltung im Vite-Build für vier Apps oder
 *     Umschreiben aller Inline-Styles) steht in keinem Verhältnis. Als
 *     Präzisierung wird zusätzlich `style-src-attr 'unsafe-inline'` und
 *     `style-src-elem 'self'` gesetzt: Inline-ATTRIBUTE erlaubt, ein
 *     eingeschleustes `<style>`-ELEMENT nicht.
 *  2. **`connect-src` enthält die API-Origin.** Ohne sie könnte die App den
 *     eigenen Server nicht erreichen (Frontend und API laufen auf
 *     verschiedenen Ports). Die Liste ist dieselbe wie die CORS-Allowlist,
 *     nur umgedreht – es gibt keine zweite Wahrheit.
 *
 * Der Rest ist die harte Grundhaltung: `default-src 'none'` (nichts ist
 * erlaubt, was nicht genannt ist), `object-src 'none'`,
 * `frame-ancestors 'none'` (kein Einbetten – das schließt die
 * `postMessage`-Brücke aus docs/security-risks.md #6 endgültig),
 * `base-uri 'none'`, `form-action 'self'`.
 *
 * ## Wo die CSP tatsächlich gesetzt wird
 *
 * Zwei Orte, weil es zwei Auslieferungen gibt:
 *  - **Die API** setzt sie auf ihre eigenen Antworten (`buildCspHeader` in
 *    `applySecurityHeaders`). Für JSON ist das fast wirkungslos, aber nicht
 *    umsonst: es verhindert, dass eine reflektierte Fehlermeldung in einem
 *    Browser als HTML interpretiert wird (zusammen mit
 *    `X-Content-Type-Options: nosniff`).
 *  - **Die vier Frontends** liefern sie über `<meta http-equiv>` in ihrer
 *    `index.html` aus, damit sie ohne einen konfigurierten Reverse Proxy
 *    wirkt. Das ist die schwächere Form (`frame-ancestors` und
 *    `report-uri` wirken per Meta-Tag nicht), deshalb steht die
 *    Kopfzeilen-Variante zusätzlich in docs/security-architecture.md als
 *    Deployment-Vorgabe.
 */

export interface CspOptions {
  /** Origins, die der Browser für `fetch`/`EventSource` erreichen darf. */
  connectSrc: readonly string[];
  /** true = zusätzlich `upgrade-insecure-requests` + HSTS. */
  https: boolean;
  /** Nur berichten statt blocken – für eine Einführungsphase. */
  reportOnly?: boolean;
  reportUri?: string | null;
}

export function buildCspHeader(options: CspOptions): string {
  const connect = ["'self'", ...options.connectSrc].join(" ");
  const directives = [
    "default-src 'none'",
    // Vite-Builds: ausschließlich externe Modul-Skripte von derselben Origin.
    "script-src 'self'",
    "script-src-attr 'none'",
    // Siehe Modulkommentar, Ausnahme 1.
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    // data: für die in den Apps verwendeten Inline-SVG/Platzhalterbilder.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  if (options.https) directives.push("upgrade-insecure-requests");
  if (options.reportUri) directives.push(`report-uri ${options.reportUri}`);
  return directives.join("; ");
}

/**
 * Die CSP-Variante für die `<meta http-equiv>`-Auslieferung in den vier
 * Frontends. `frame-ancestors` ist dort wirkungslos und wird deshalb
 * weggelassen, statt eine Wirkung zu behaupten.
 */
export function buildFrontendCspMeta(connectSrc: readonly string[]): string {
  return buildCspHeader({ connectSrc, https: false })
    .split("; ")
    .filter((d) => !d.startsWith("frame-ancestors") && !d.startsWith("report-uri"))
    .join("; ");
}

export interface SecurityHeaderOptions extends CspOptions {
  /** HSTS nur bei echtem HTTPS – sonst sperrt man sich lokal aus. */
  hstsSeconds?: number;
}

/**
 * Die vollständige Kopfzeilenmenge. Jede Zeile hat einen Grund:
 *
 *  - `X-Content-Type-Options: nosniff` – ein JSON-Fehler darf nicht als HTML
 *    interpretiert werden.
 *  - `Referrer-Policy: no-referrer` – ein Download-Link mit Token in der Query
 *    (finance-Export, Dokument-Signatur) darf den Token nicht an eine fremde
 *    Seite weitergeben. Das ist hier kein Formalismus, sondern schützt genau
 *    die §12-Signatur-URLs.
 *  - `X-Frame-Options: DENY` – Altbrowser-Äquivalent zu `frame-ancestors`.
 *  - `Cross-Origin-Opener-Policy` / `-Resource-Policy` – trennt den
 *    Browsing-Context, verhindert Cross-Origin-Lesezugriffe auf Antworten.
 *  - `Permissions-Policy` – die App braucht keine Kamera/Mikrofon/Geolocation.
 *    (Das Sprachprotokoll in apps/instructor arbeitet mit diktiertem TEXT,
 *    nicht mit Mikrofonaufnahme – siehe packages/integrations/transcription.)
 *  - `Cache-Control: no-store` für API-Antworten – personenbezogene Antworten
 *    dürfen nicht in einem Proxy- oder Browsercache landen.
 */
export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    [options.reportOnly ? "content-security-policy-report-only" : "content-security-policy"]:
      buildCspHeader(options),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-site",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
    "x-permitted-cross-domain-policies": "none",
  };
  if (options.https) {
    const seconds = options.hstsSeconds ?? 63072000; // 2 Jahre
    headers["strict-transport-security"] = `max-age=${seconds}; includeSubDomains`;
  }
  return headers;
}

/** Antworten, die NICHT gecacht werden dürfen (alles außer /health). */
export const NO_STORE_HEADERS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  pragma: "no-cache",
};
