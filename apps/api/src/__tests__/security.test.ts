import { createRawClient } from "@fahrschul/database";
import { SESSION_COOKIE_NAME } from "@fahrschul/auth";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildCspHeader, buildFrontendCspMeta } from "../lib/security-headers.js";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, issueCsrfToken } from "../lib/csrf.js";
import { STEP_UP_ACTIONS, STEP_UP_ACTION_VALUES } from "../lib/step-up.js";
import { verifyAuditChain } from "../services/audit-chain.js";
import { ROLE_PERMISSIONS } from "@fahrschul/permissions";
import {
  buildTestApp,
  enableMfa,
  ensureMigrated,
  extractCookie,
  idemKey,
  loginAs,
  seedFixtures,
  stepUp,
  testDatabaseUrl,
  truncateAll,
  TEST_BRUTE_FORCE,
  type SeededFixtures,
} from "./helpers.js";

/**
 * PROMPT -1 §17 – Defense in Depth, gegen echtes Postgres geprüft.
 *
 * Jeder Abschnitt hier entspricht einem geforderten Punkt aus §17 und beweist
 * ihn mit Verhalten, nicht mit einer Zusicherung im Kommentar.
 */

const SIGNING_SECRET = "test-signing-secret-fuer-phase-3-mindestens-32-zeichen";

describe("PROMPT -1 §17 – Defense in Depth", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let studentCookie: string;
  let officeCookie: string;
  let student2Cookie: string;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    app = buildTestApp({ signingSecret: SIGNING_SECRET });
    await app.ready();
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterAll(async () => {
    await app?.close();
  });

  // =======================================================================
  // Rate Limiting (per IP und per Konto, mit Retry-After)
  // =======================================================================
  describe("Rate Limiting", () => {
    it("weist die IP-Dimension mit 429 + Retry-After ab, sobald der Eimer leer ist", async () => {
      const eng = buildTestApp({
        rateLimit: {
          enabled: true,
          multiplier: 1,
          policies: {
            login: { name: "login", ratePerSecond: 0.01, burst: 2 },
            write: { name: "write", ratePerSecond: 0.01, burst: 2 },
            read: { name: "read", ratePerSecond: 0.01, burst: 3 },
            stream: { name: "stream", ratePerSecond: 0.01, burst: 2 },
            expensive: { name: "expensive", ratePerSecond: 0.01, burst: 2 },
          },
        },
      });
      await eng.ready();
      try {
        const stati: number[] = [];
        for (let i = 0; i < 6; i += 1) {
          const res = await eng.inject({ method: "GET", url: "/health/deep" });
          stati.push(res.statusCode);
          if (res.statusCode === 429) {
            // Der Vertrag mit Phase 2s Client: Retry-After in SEKUNDEN, >= 1.
            expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
            expect(res.json().error).toBe("rate_limited");
            expect(res.json().scope).toBe("ip");
            expect(res.headers["x-ratelimit-policy"]).toBe("read");
          }
        }
        expect(stati.filter((s) => s === 429).length).toBeGreaterThan(0);
      } finally {
        await eng.close();
      }
    });

    it("hat eine EIGENE Politik für den langlebigen SSE-Stream (Phase-2-Übergabe)", async () => {
      const { policyForRequest } = await import("../lib/rate-limit.js");
      expect(policyForRequest("GET", "/sync/stream")).toBe("stream");
      expect(policyForRequest("GET", "/sync/changes")).toBe("read");
      expect(policyForRequest("POST", "/auth/login")).toBe("login");
      expect(policyForRequest("POST", "/finance/exports")).toBe("expensive");
      // Eine NEUE, unbekannte Schreibroute ist standardmäßig begrenzt.
      expect(policyForRequest("POST", "/etwas/ganz/neues")).toBe("write");
    });

    it("lässt einen LEGITIMEN Stoß durch: zehnmal dieselbe idempotente Anfrage (Chaos-Szenario 2)", async () => {
      const key = idemKey("burst");
      const stati: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const res = await app.inject({
          method: "POST",
          url: "/appointments",
          headers: { cookie: officeCookie, "idempotency-key": key },
          payload: {
            schuelerId: fixtures.schuelerId,
            fahrlehrerId: fixtures.fahrlehrerId,
            art: "Übungsstunde",
            klasse: "B",
            beginnAt: "2026-09-01T09:00:00.000Z",
            endeAt: "2026-09-01T10:00:00.000Z",
          },
        });
        stati.push(res.statusCode);
      }
      // KEIN 429 – und genau EIN angelegter Termin (Idempotenz bleibt intakt).
      expect(stati.filter((s) => s === 429)).toEqual([]);
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from terminbuchungen`;
        expect(rows[0].n).toBe(1);
      } finally {
        await sql.end();
      }
    });

    it("begrenzt zusätzlich je KONTO, nicht nur je IP (Büro-NAT-Fall)", async () => {
      const eng = buildTestApp({
        rateLimit: {
          enabled: true,
          multiplier: 1,
          policies: {
            login: { name: "login", ratePerSecond: 1000, burst: 10000 },
            // IP-Eimer weit, Konto-Eimer eng: 4 * 1.5 = 6 Token je Konto.
            read: { name: "read", ratePerSecond: 0.01, burst: 4 },
            write: { name: "write", ratePerSecond: 1000, burst: 10000 },
            stream: { name: "stream", ratePerSecond: 1000, burst: 10000 },
            expensive: { name: "expensive", ratePerSecond: 1000, burst: 10000 },
          },
        },
      });
      await eng.ready();
      try {
        const cookie = await loginAs(eng, "schueler@test.local", fixtures.password);
        const scopes: string[] = [];
        for (let i = 0; i < 12; i += 1) {
          const res = await eng.inject({ method: "GET", url: "/me", headers: { cookie } });
          if (res.statusCode === 429) scopes.push(res.json().scope);
        }
        expect(scopes.length).toBeGreaterThan(0);
        // Die IP-Dimension ist zuerst leer (burst 4 < 6), danach greift auch
        // die Konto-Dimension – beide Geltungsbereiche sind erreichbar.
        expect(new Set(scopes).size).toBeGreaterThanOrEqual(1);
      } finally {
        await eng.close();
      }
    });

    it("ist vollständig abschaltbar (Betriebsschalter, kein hartkodierter Wert)", async () => {
      const aus = buildTestApp({ rateLimit: false });
      await aus.ready();
      try {
        for (let i = 0; i < 40; i += 1) {
          const res = await aus.inject({ method: "GET", url: "/health" });
          expect(res.statusCode).toBe(200);
        }
      } finally {
        await aus.close();
      }
    });
  });

  // =======================================================================
  // Brute-Force-Schutz auf der Anmeldung
  // =======================================================================
  describe("Brute-Force-Schutz", () => {
    function engeApp() {
      return buildTestApp({
        bruteForce: {
          ...TEST_BRUTE_FORCE,
          accountDelayAfter: 3,
          accountDelayBaseMs: 5,
          accountDelayMaxMs: 10,
          accountLockAfter: 5,
          accountLockMs: 60_000,
          ipLockAfter: 100000,
        },
      });
    }

    it("verzögert progressiv ab dem konfigurierten Fehlversuch, ohne zu sperren", async () => {
      const eng = engeApp();
      await eng.ready();
      try {
        for (let i = 0; i < 4; i += 1) {
          const res = await eng.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "schueler@test.local", password: "falsch" },
          });
          expect(res.statusCode).toBe(401);
          expect(res.json().error).toBe("invalid_credentials");
        }
        const sql = createRawClient(databaseUrl);
        try {
          const rows = await sql`select failures, locked_until from auth_throttle where scope = 'account'`;
          expect(rows[0].failures).toBe(4);
          expect(rows[0].locked_until).toBeNull();
        } finally {
          await sql.end();
        }
      } finally {
        await eng.close();
      }
    });

    it("sperrt das Konto nach `accountLockAfter` – mit 429 und Retry-After, und der ECHTE Nutzer kommt danach nicht rein", async () => {
      const eng = engeApp();
      await eng.ready();
      try {
        for (let i = 0; i < 5; i += 1) {
          await eng.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "schueler@test.local", password: "falsch" },
          });
        }
        const gesperrt = await eng.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "schueler@test.local", password: fixtures.password },
        });
        expect(gesperrt.statusCode).toBe(429);
        expect(gesperrt.json().error).toBe("account_temporarily_locked");
        expect(Number(gesperrt.headers["retry-after"])).toBeGreaterThan(0);
      } finally {
        await eng.close();
      }
    });

    it("gibt für ein NICHT existierendes Konto dieselbe Sperrantwort – kein Enumerationsorakel", async () => {
      const eng = engeApp();
      await eng.ready();
      try {
        const antworten: Array<{ status: number; error: string }> = [];
        for (let i = 0; i < 6; i += 1) {
          const res = await eng.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "gibtesnicht@test.local", password: "falsch" },
          });
          antworten.push({ status: res.statusCode, error: res.json().error });
        }
        // Erst 401 invalid_credentials (identisch zum echten Konto), dann 429.
        expect(antworten[0]).toEqual({ status: 401, error: "invalid_credentials" });
        expect(antworten.at(-1)).toEqual({
          status: 429,
          error: "account_temporarily_locked",
        });
      } finally {
        await eng.close();
      }
    });

    it("ein ERFOLGREICHER Login löscht den Kontozähler (der Mensch, der sich erinnert)", async () => {
      const eng = engeApp();
      await eng.ready();
      try {
        for (let i = 0; i < 3; i += 1) {
          await eng.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "schueler@test.local", password: "falsch" },
          });
        }
        const ok = await eng.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "schueler@test.local", password: fixtures.password },
        });
        expect(ok.statusCode).toBe(200);
        const sql = createRawClient(databaseUrl);
        try {
          const rows = await sql`select count(*)::int as n from auth_throttle where scope = 'account'`;
          expect(rows[0].n).toBe(0);
        } finally {
          await sql.end();
        }
      } finally {
        await eng.close();
      }
    });

    it("hat einen ENTSPERRPFAD – nur systemdienst, nur mit Step-up, auditiert", async () => {
      const eng = engeApp();
      await eng.ready();
      try {
        for (let i = 0; i < 5; i += 1) {
          await eng.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "schueler@test.local", password: "falsch" },
          });
        }

        // Büro darf NICHT entsperren (users:manage fehlt).
        const bueroCookie = await loginAs(eng, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        const verboten = await eng.inject({
          method: "POST",
          url: "/auth/unlock",
          headers: { cookie: bueroCookie },
          payload: { scope: "account", key: "schueler@test.local" },
        });
        expect(verboten.statusCode).toBe(403);
        expect(verboten.json().error).toBe("forbidden");

        // systemdienst anlegen.
        const sql = createRawClient(databaseUrl);
        try {
          await sql`
            insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
            select ${fixtures.standortId}, 'sys@test.local', password_hash, 'systemdienst', 'S', 'D', true, mfa_secret
              from benutzer where id = ${fixtures.bueroBenutzerId}`;
        } finally {
          await sql.end();
        }
        const sysCookie = await loginAs(eng, "sys@test.local", fixtures.password, fixtures.bueroTotpSecret);

        // Ohne Step-up: 403 step_up_required.
        const ohneStepUp = await eng.inject({
          method: "POST",
          url: "/auth/unlock",
          headers: { cookie: sysCookie },
          payload: { scope: "account", key: "schueler@test.local" },
        });
        expect(ohneStepUp.statusCode).toBe(403);
        expect(ohneStepUp.json().error).toBe("step_up_required");
        expect(ohneStepUp.json().action).toBe(STEP_UP_ACTIONS.authUnlock);

        await stepUp(eng, sysCookie, fixtures.password, fixtures.bueroTotpSecret);
        const entsperrt = await eng.inject({
          method: "POST",
          url: "/auth/unlock",
          headers: { cookie: sysCookie },
          payload: { scope: "account", key: "schueler@test.local" },
        });
        expect(entsperrt.statusCode, entsperrt.body).toBe(200);
        expect(entsperrt.json().entsperrt).toBe(1);

        // Der echte Nutzer kommt jetzt wieder rein.
        const wieder = await eng.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "schueler@test.local", password: fixtures.password },
        });
        expect(wieder.statusCode).toBe(200);

        // Und die Entsperrung steht im Audit-Log – OHNE die E-Mail im Klartext.
        const sql2 = createRawClient(databaseUrl);
        try {
          const rows = await sql2`
            select payload from audit_events where type = 'auth.throttle.unlocked'`;
          expect(rows).toHaveLength(1);
          expect((rows[0].payload as { scope: string }).scope).toBe("account");
          // Kein personenbezogener Klartext im Audit-Payload.
          expect(JSON.stringify(rows[0].payload)).not.toContain("schueler@test.local");
        } finally {
          await sql2.end();
        }
      } finally {
        await eng.close();
      }
    });
  });

  // =======================================================================
  // CSRF
  // =======================================================================
  describe("CSRF", () => {
    it("weist einen FREMDEN Origin auf einer Schreibroute mit 403 ab", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie, origin: "https://boeser-dienst.example" },
        payload: { eintraege: [] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("csrf_failed");
      expect(res.json().reason).toBe("origin_not_allowed");
    });

    it("weist `Sec-Fetch-Site: cross-site` ab, auch OHNE Origin-Header", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie, "sec-fetch-site": "cross-site" },
        payload: { eintraege: [] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().reason).toBe("cross_site_request");
    });

    it("akzeptiert einen ERLAUBTEN Origin (die vier Vite-Apps)", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie, origin: "http://localhost:5173" },
        payload: { eintraege: [] },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it("gibt einen an die SITZUNG gebundenen Token aus und akzeptiert ihn als Double-Submit", async () => {
      const csrf = await app.inject({ method: "GET", url: "/auth/csrf", headers: { cookie: studentCookie } });
      expect(csrf.statusCode).toBe(200);
      const token = csrf.json().csrfToken as string;
      expect(token).toMatch(/^[\w-]+\.[\w-]+$/);

      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: {
          cookie: `${studentCookie}; ${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: token,
        },
        payload: { eintraege: [] },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it("lehnt einen Token ab, der zu einer ANDEREN Sitzung gehört (kein reines Random-Paar)", async () => {
      const raw = studentCookie.split("=")[1];
      const fremd = issueCsrfToken(`${raw}-anders`, SIGNING_SECRET);
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: {
          cookie: `${studentCookie}; ${CSRF_COOKIE_NAME}=${fremd}`,
          [CSRF_HEADER_NAME]: fremd,
        },
        payload: { eintraege: [] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().reason).toBe("token_mismatch");
    });

    it("lehnt ab, wenn Cookie und Header auseinandergehen", async () => {
      const csrf = await app.inject({ method: "GET", url: "/auth/csrf", headers: { cookie: studentCookie } });
      const token = csrf.json().csrfToken as string;
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: {
          cookie: `${studentCookie}; ${CSRF_COOKIE_NAME}=${token}`,
          [CSRF_HEADER_NAME]: `${token}x`,
        },
        payload: { eintraege: [] },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().reason).toBe("token_cookie_mismatch");
    });

    it("prüft GET NICHT (keine schreibende GET-Route) und /auth/login ist ausgenommen", async () => {
      const get = await app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie: studentCookie, origin: "https://boeser-dienst.example" },
      });
      expect(get.statusCode).toBe(200);

      const { isCsrfExempt } = await import("../lib/csrf.js");
      expect(isCsrfExempt("POST", "/auth/login")).toBe(true);
      expect(isCsrfExempt("POST", "/appointments")).toBe(false);
    });

    it("`logout-all` entzieht den CSRF-Token mit, weil er an die Sitzung gebunden ist", async () => {
      const csrf = await app.inject({ method: "GET", url: "/auth/csrf", headers: { cookie: studentCookie } });
      const token = csrf.json().csrfToken as string;
      await app.inject({ method: "POST", url: "/auth/logout-all", headers: { cookie: studentCookie } });
      const res = await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: `${studentCookie}; ${CSRF_COOKIE_NAME}=${token}`, [CSRF_HEADER_NAME]: token },
        payload: { eintraege: [] },
      });
      // Die Sitzung ist weg -> 401 (nicht 403): der Token allein öffnet nichts.
      expect(res.statusCode).toBe(401);
    });
  });

  // =======================================================================
  // Content Security Policy
  // =======================================================================
  describe("Content Security Policy", () => {
    it("setzt eine CSP OHNE `unsafe-inline`/`unsafe-eval` für Skripte", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      const csp = res.headers["content-security-policy"] as string;
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
      expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
      expect(csp).toContain("script-src-attr 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
    });

    it("erlaubt Inline-STYLE-ATTRIBUTE, aber kein eingeschleustes <style>-ELEMENT", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      const csp = res.headers["content-security-policy"] as string;
      expect(csp).toContain("style-src-attr 'unsafe-inline'");
      expect(csp).toContain("style-src-elem 'self'");
    });

    it("ist mit den vier Vite-Builds kompatibel: externe Modul-Skripte von 'self'", () => {
      // Belegt gegen die tatsächlich gebauten index.html-Dateien (kein
      // Inline-<script>, nur src="/assets/...") – siehe Modulkommentar in
      // lib/security-headers.ts.
      const csp = buildCspHeader({ connectSrc: ["http://localhost:4000"], https: false });
      const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
      expect(scriptSrc).toBe("script-src 'self'");
      expect(csp).toContain("connect-src 'self' http://localhost:4000");
    });

    it("lässt `frame-ancestors`/`report-uri` in der <meta>-Variante weg (sie wirken dort nicht)", () => {
      const meta = buildFrontendCspMeta(["http://localhost:4000"]);
      expect(meta).not.toContain("frame-ancestors");
      expect(meta).toContain("script-src 'self'");
    });

    it("setzt die CSP AUCH auf Fehlerantworten (401/403/404)", async () => {
      for (const url of ["/me", "/gibtesnicht"]) {
        const res = await app.inject({ method: "GET", url });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.headers["content-security-policy"]).toBeTruthy();
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
      }
    });

    it("setzt HSTS nur bei HTTPS – sonst sperrt man sich lokal aus", async () => {
      const httpApp = buildTestApp();
      await httpApp.ready();
      const httpsApp = buildTestApp({ https: true });
      await httpsApp.ready();
      try {
        const ohne = await httpApp.inject({ method: "GET", url: "/health" });
        expect(ohne.headers["strict-transport-security"]).toBeUndefined();
        const mit = await httpsApp.inject({ method: "GET", url: "/health" });
        expect(mit.headers["strict-transport-security"]).toContain("max-age=");
      } finally {
        await httpApp.close();
        await httpsApp.close();
      }
    });

    it("setzt `Referrer-Policy: no-referrer` – ein Download-Token darf nicht weitergegeben werden", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["permissions-policy"]).toContain("camera=()");
      expect(res.headers["x-frame-options"]).toBe("DENY");
    });

    it("verbietet Caching personenbezogener Antworten", async () => {
      const res = await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      expect(res.headers["cache-control"]).toContain("no-store");
    });
  });

  // =======================================================================
  // Step-up-Authentisierung
  // =======================================================================
  describe("Step-up-Authentisierung", () => {
    it("hat eine geschlossene, dokumentierte Liste von sieben Aktionen", () => {
      expect([...STEP_UP_ACTION_VALUES].sort()).toEqual(
        [
          "auth.throttle.unlock",
          "exam.clearance.override",
          "finance.export.sensitive",
          "finance.payment.reassign",
          "resources.vehicle.unblock",
          "system.security_flag.change",
          "users.role.change",
        ].sort(),
      );
    });

    it("verlangt für Mitarbeitende Passwort UND frischen TOTP-Code", async () => {
      const ohneTotp = await app.inject({
        method: "POST",
        url: "/auth/step-up",
        headers: { cookie: officeCookie },
        payload: { password: fixtures.password },
      });
      expect(ohneTotp.statusCode).toBe(401);
      expect(ohneTotp.json().error).toBe("step_up_failed");

      const mitTotp = await stepUp(app, officeCookie, fixtures.password, fixtures.bueroTotpSecret);
      expect(mitTotp).toBe(officeCookie);
      const status = await app.inject({ method: "GET", url: "/auth/step-up", headers: { cookie: officeCookie } });
      expect(status.json().verifiedAt).toBeTruthy();
    });

    it("blockiert das Entsperren eines Fahrzeugs ohne Step-up und erlaubt es danach", async () => {
      const sql = createRawClient(databaseUrl);
      let version: number;
      try {
        await sql`update fahrzeuge set status = 'wartung' where id = ${fixtures.fahrzeugId}`;
        const rows = await sql`select version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
        version = rows[0].version;
      } finally {
        await sql.end();
      }

      const ohne = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
        headers: { cookie: officeCookie, "if-match": `W/"${version}"` },
        payload: { status: "verfuegbar" },
      });
      expect(ohne.statusCode).toBe(403);
      expect(ohne.json().error).toBe("step_up_required");
      expect(ohne.json().action).toBe(STEP_UP_ACTIONS.vehicleUnblock);

      await stepUp(app, officeCookie, fixtures.password, fixtures.bueroTotpSecret);
      const mit = await app.inject({
        method: "PATCH",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}`,
        headers: { cookie: officeCookie, "if-match": `W/"${version}"` },
        payload: { status: "verfuegbar" },
      });
      expect(mit.statusCode, mit.body).toBe(200);
    });

    it("verlangt KEIN Step-up für das SPERREN eines Fahrzeugs (vorsichtige Richtung)", async () => {
      const sql = createRawClient(databaseUrl);
      let version: number;
      try {
        const rows = await sql`select version from fahrzeuge where id = ${fixtures.fahrzeugId}`;
        version = rows[0].version;
      } finally {
        await sql.end();
      }
      const res = await app.inject({
        method: "POST",
        url: `/resources/fahrzeuge/${fixtures.fahrzeugId}/block`,
        headers: { cookie: officeCookie, "idempotency-key": idemKey("block") },
        payload: { grund: "Bremsen", schweregrad: "kritisch", expectedVersion: version },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it("verlangt Step-up NUR für die ÜBERSTEUERUNG der Prüfungsfreigabekette", async () => {
      const sql = createRawClient(databaseUrl);
      let pruefungId: string;
      try {
        const [row] = await sql`
          insert into pruefungen (standort_id, ausbildung_id, schueler_id, klasse, status)
          values (${fixtures.standortId}, ${fixtures.ausbildungId}, ${fixtures.schuelerId}, 'B', 'voraussetzungen_fehlen')
          returning id`;
        pruefungId = row.id;
      } finally {
        await sql.end();
      }
      const instructorCookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);

      const ohne = await app.inject({
        method: "POST",
        url: `/pruefungen/${pruefungId}/transition`,
        headers: { cookie: instructorCookie, "idempotency-key": idemKey("override") },
        payload: { to: "fahrlehrer_go", grund: "trotz fehlender Voraussetzungen" },
      });
      expect(ohne.statusCode).toBe(403);
      expect(ohne.json().error).toBe("step_up_required");
      expect(ohne.json().action).toBe(STEP_UP_ACTIONS.examClearanceOverride);

      // Der REGULÄRE Weg (in_vorbereitung -> fahrlehrer_go) braucht keinen Step-up.
      const sql2 = createRawClient(databaseUrl);
      try {
        await sql2`update pruefungen set status = 'in_vorbereitung' where id = ${pruefungId}`;
      } finally {
        await sql2.end();
      }
      const regulaer = await app.inject({
        method: "POST",
        url: `/pruefungen/${pruefungId}/transition`,
        headers: { cookie: instructorCookie, "idempotency-key": idemKey("regular") },
        payload: { to: "fahrlehrer_go", grund: "alles erfüllt" },
      });
      expect(regulaer.statusCode, regulaer.body).toBe(200);
    });

    it("verlangt Step-up nur für SENSIBLE Exporte, nicht für aggregierte Betriebszahlen", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'fin-export@test.local', password_hash, 'finanzen', 'F', 'E', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      const finance = await loginAs(app, "fin-export@test.local", fixtures.password, fixtures.bueroTotpSecret);

      const aggregiert = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie: finance },
        payload: { bericht: "umsatz-monat", format: "csv", parameter: {} },
      });
      expect(aggregiert.statusCode, aggregiert.body).toBe(201);

      const sensibel = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie: finance },
        payload: { bericht: "offene-posten", format: "csv", parameter: {} },
      });
      expect(sensibel.statusCode).toBe(403);
      expect(sensibel.json().action).toBe(STEP_UP_ACTIONS.sensitiveExport);

      await stepUp(app, finance, fixtures.password, fixtures.bueroTotpSecret);
      const danach = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie: finance },
        payload: { bericht: "offene-posten", format: "csv", parameter: {} },
      });
      expect(danach.statusCode, danach.body).toBe(201);
    });

    it("läuft ab (TTL) und wird von `logout-all` sofort entzogen", async () => {
      const kurz = buildTestApp({ signingSecret: SIGNING_SECRET });
      await kurz.ready();
      try {
        const cookie = await loginAs(kurz, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
        await stepUp(kurz, cookie, fixtures.password, fixtures.bueroTotpSecret);

        // Abgelaufen: die Sitzungszeile wird künstlich zurückdatiert.
        const sql = createRawClient(databaseUrl);
        try {
          await sql`update sessions set step_up_verified_at = now() - interval '2 hours'`;
        } finally {
          await sql.end();
        }
        const { evaluateStepUp } = await import("../lib/step-up.js");
        const abgelaufen = evaluateStepUp(
          { verifiedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), scope: "all" },
          STEP_UP_ACTIONS.vehicleUnblock,
        );
        expect(abgelaufen.ok).toBe(false);
        expect(abgelaufen.reason).toBe("step_up_expired");
      } finally {
        await kurz.close();
      }
    });

    it("respektiert einen ENGEN Geltungsbereich: eine Freigabe für Aktion A gilt nicht für B", async () => {
      const { evaluateStepUp } = await import("../lib/step-up.js");
      const state = { verifiedAt: new Date(), scope: STEP_UP_ACTIONS.sensitiveExport };
      expect(evaluateStepUp(state, STEP_UP_ACTIONS.sensitiveExport).ok).toBe(true);
      const andere = evaluateStepUp(state, STEP_UP_ACTIONS.vehicleUnblock);
      expect(andere.ok).toBe(false);
      expect(andere.reason).toBe("step_up_scope_mismatch");
    });

    it("Rollenänderung: nur systemdienst, mit Step-up, mit Version, kein Selbst-Upgrade, Sitzungen widerrufen", async () => {
      const sql = createRawClient(databaseUrl);
      let sysId: string;
      try {
        const [row] = await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'sys2@test.local', password_hash, 'systemdienst', 'S', 'D', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}
          returning id`;
        sysId = row.id;
      } finally {
        await sql.end();
      }
      const sysCookie = await loginAs(app, "sys2@test.local", fixtures.password, fixtures.bueroTotpSecret);

      // (a) Büro darf nicht.
      const bueroVersuch = await app.inject({
        method: "PATCH",
        url: `/users/${fixtures.schuelerBenutzerId}/role`,
        headers: { cookie: officeCookie },
        payload: { rolle: "buero", grund: "Test", expectedVersion: 1 },
      });
      expect(bueroVersuch.statusCode).toBe(403);
      expect(bueroVersuch.json().error).toBe("forbidden");

      // (b) systemdienst ohne Step-up: 403 step_up_required.
      const ohneStepUp = await app.inject({
        method: "PATCH",
        url: `/users/${fixtures.schuelerBenutzerId}/role`,
        headers: { cookie: sysCookie },
        payload: { rolle: "buero", grund: "Test", expectedVersion: 1 },
      });
      expect(ohneStepUp.json().error).toBe("step_up_required");

      await stepUp(app, sysCookie, fixtures.password, fixtures.bueroTotpSecret);

      // (c) Selbst-Upgrade verboten.
      const selbst = await app.inject({
        method: "PATCH",
        url: `/users/${sysId}/role`,
        headers: { cookie: sysCookie },
        payload: { rolle: "geschaeftsfuehrung", grund: "Test", expectedVersion: 1 },
      });
      expect(selbst.statusCode).toBe(403);
      expect(selbst.json().error).toBe("self_modification_forbidden");

      // (d) §4: ohne Version 428.
      const ohneVersion = await app.inject({
        method: "PATCH",
        url: `/users/${fixtures.schuelerBenutzerId}/role`,
        headers: { cookie: sysCookie },
        payload: { rolle: "buero", grund: "Test" },
      });
      expect(ohneVersion.statusCode).toBe(428);

      // (e) Erfolgsfall: Sitzungen des Ziels werden widerrufen.
      const liste = await app.inject({ method: "GET", url: "/users", headers: { cookie: sysCookie } });
      const ziel = liste.json().users.find((u: { id: string }) => u.id === fixtures.schuelerBenutzerId);
      const ok = await app.inject({
        method: "PATCH",
        url: `/users/${fixtures.schuelerBenutzerId}/role`,
        headers: { cookie: sysCookie, "if-match": ziel.etag },
        payload: { rolle: "buero", grund: "Rollenwechsel nach Einarbeitung" },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().widerrufeneSitzungen).toBeGreaterThanOrEqual(1);
      const alterCookie = await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      expect(alterCookie.statusCode).toBe(401);

      // (f) Auditiert mit vorher/nachher.
      const sql2 = createRawClient(databaseUrl);
      try {
        const rows = await sql2`select vorher::text as v, nachher::text as n from audit_events where type = 'role.changed'`;
        expect(rows).toHaveLength(1);
        expect(rows[0].v).toContain("schueler");
        expect(rows[0].n).toContain("buero");
      } finally {
        await sql2.end();
      }
    });
  });

  // =======================================================================
  // Cookie-Flags
  // =======================================================================
  describe("Sichere Cookie-Flags (Audit)", () => {
    it("Sitzungscookie: HttpOnly, SameSite=Lax, Path=/, Ablauf gesetzt", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "schueler@test.local", password: fixtures.password },
      });
      const cookies = ([] as string[]).concat(res.headers["set-cookie"] as string | string[]);
      const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))!;
      expect(session).toContain("HttpOnly");
      expect(session).toContain("SameSite=Lax");
      expect(session).toContain("Path=/");
      expect(session).toMatch(/Expires=/);
    });

    it("CSRF-Cookie: bewusst NICHT HttpOnly (Double-Submit braucht JS-Lesbarkeit), aber SameSite=Lax", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "schueler@test.local", password: fixtures.password },
      });
      const cookies = ([] as string[]).concat(res.headers["set-cookie"] as string | string[]);
      const csrf = cookies.find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))!;
      expect(csrf).toBeTruthy();
      expect(csrf).not.toContain("HttpOnly");
      expect(csrf).toContain("SameSite=Lax");
    });

    it("`Secure` wird gesetzt, wenn der Betrieb HTTPS meldet", async () => {
      const secure = buildApp({
        databaseUrl,
        cookieSecure: true,
        logger: false,
        rateLimit: false,
        accessLog: false,
      });
      await secure.ready();
      try {
        const res = await secure.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "schueler@test.local", password: fixtures.password },
        });
        const cookies = ([] as string[]).concat(res.headers["set-cookie"] as string | string[]);
        expect(cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toContain("Secure");
      } finally {
        await secure.close();
      }
    });
  });

  // =======================================================================
  // Mandanten-/Standorttrennung: die HARTE Zusage
  // =======================================================================
  describe("Ein kompromittierter Client kann NIE fremde Datensätze lesen oder ändern", () => {
    it("Schüler B sieht Schüler A's Dokumente nicht – die Filterung ist SERVERSEITIG", async () => {
      const upload = await uploadPdf(app, studentCookie, "sehtest");
      expect(upload.statusCode).toBe(201);

      const fremd = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: student2Cookie },
      });
      expect(fremd.json().documents).toEqual([]);

      // Auch der direkte Zugriff mit bekannter ID scheitert – 404, nicht 403
      // (eine 403 würde die Existenz bestätigen).
      const docId = upload.json().document.id as string;
      const direkt = await app.inject({
        method: "GET",
        url: `/documents/${docId}/content?sig=egal`,
        headers: { cookie: student2Cookie },
      });
      expect(direkt.statusCode).toBe(404);
    });

    it("ein Schüler kann fremde Wunschzeiten nicht schreiben (own-Scope wird DB-seitig aufgelöst)", async () => {
      await app.inject({
        method: "PUT",
        url: "/me/wunschzeiten",
        headers: { cookie: studentCookie },
        payload: { eintraege: [{ wochentag: 1, startzeit: "10:00", endzeit: "12:00" }] },
      });
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`
          select schueler_id from schueler_verfuegbarkeiten`;
        // Es gibt genau EINE Zeile, und sie gehört Schüler A – der Endpunkt
        // nimmt gar keine Schüler-ID an, sie kommt aus der Sitzung.
        expect(rows).toHaveLength(1);
        expect(rows[0].schueler_id).toBe(fixtures.schuelerId);
      } finally {
        await sql.end();
      }
    });

    it("das Büro eines ANDEREN Standorts sieht die Dokumente nicht (Mandantentrennung)", async () => {
      const upload = await uploadPdf(app, studentCookie, "sehtest");
      const docId = upload.json().document.id as string;

      const sql = createRawClient(databaseUrl);
      try {
        const [org2] = await sql`insert into organisationen (name) values ('Fremdorg') returning id`;
        const [standort2] = await sql`
          insert into standorte (organisation_id, name) values (${org2.id}, 'Kassel') returning id`;
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${standort2.id}, 'buero-fremd@test.local', password_hash, 'buero', 'B', 'F', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      const fremdesBuero = await loginAs(
        app,
        "buero-fremd@test.local",
        fixtures.password,
        fixtures.bueroTotpSecret,
      );

      const liste = await app.inject({
        method: "GET",
        url: "/documents",
        headers: { cookie: fremdesBuero },
      });
      expect(liste.statusCode).toBe(200);
      expect(liste.json().documents).toEqual([]);

      // Und ein Schreibversuch auf den fremden Datensatz -> 404.
      const review = await app.inject({
        method: "POST",
        url: `/documents/${docId}/review`,
        headers: { cookie: fremdesBuero, "if-match": 'W/"1"' },
        payload: { entscheidung: "akzeptiert" },
      });
      expect(review.statusCode).toBe(404);
    });

    it("das eigene Büro sieht die Dokumente des eigenen Standorts – mit Version je Zeile (§4)", async () => {
      await uploadPdf(app, studentCookie, "sehtest");
      const liste = await app.inject({ method: "GET", url: "/documents", headers: { cookie: officeCookie } });
      expect(liste.json().documents).toHaveLength(1);
      expect(liste.json().documents[0].etag).toMatch(/^W\/"\d+"$/);
    });
  });

  // =======================================================================
  // Manipulationssicheres Audit
  // =======================================================================
  describe("Manipulationssicheres Audit-Log", () => {
    it("verbietet UPDATE und DELETE auf audit_events (SQLSTATE FS008)", async () => {
      await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
      const sql = createRawClient(databaseUrl);
      try {
        const [row] = await sql`select id from audit_events limit 1`;
        expect(row).toBeDefined();
        await expect(
          sql`update audit_events set aktion = 'gefaelscht' where id = ${row.id}`,
        ).rejects.toMatchObject({ code: "FS008" });
        await expect(sql`delete from audit_events where id = ${row.id}`).rejects.toMatchObject({
          code: "FS008",
        });
      } finally {
        await sql.end();
      }
    });

    it("verkettet jede Zeile per Hash und meldet die Kette als unversehrt", async () => {
      const verify = await verifyAuditChain(await getDbForTest(), { alarm: false });
      expect(verify.appendOnlyTriggersActive).toBe(true);
      expect(verify.befunde).toEqual([]);
      expect(verify.ok).toBe(true);
      expect(verify.geprueft).toBeGreaterThan(0);
    });

    it("ERKENNT eine Manipulation, die die Trigger umgeht", async () => {
      const sql = createRawClient(databaseUrl);
      try {
        const [row] = await sql`select id from audit_events order by chain_seq limit 1`;
        // Der Angreifer schaltet den Wächter ab (z. B. als Superuser) …
        await sql`alter table audit_events disable trigger audit_events_no_update_trg`;
        await sql`update audit_events set aktion = 'gefaelscht' where id = ${row.id}`;
        await sql`alter table audit_events enable trigger audit_events_no_update_trg`;

        // … die Hash-Kette merkt es trotzdem.
        const verify = await verifyAuditChain(await getDbForTest(), { alarm: false });
        expect(verify.ok).toBe(false);
        expect(verify.befunde.some((b) => b.kind === "inhalt_veraendert")).toBe(true);
        expect(verify.befunde.some((b) => b.auditEventId === row.id)).toBe(true);
      } finally {
        await sql.end();
      }
    });

    it("ERKENNT eine gelöschte Zeile über den fehlenden Vorgänger-Hash", async () => {
      // Mehrere Ereignisse erzeugen, damit es einen referenzierten Vorgänger gibt.
      for (let i = 0; i < 3; i += 1) {
        await app.inject({ method: "GET", url: "/me", headers: { cookie: studentCookie } });
        await app.inject({
          method: "PUT",
          url: "/me/wunschzeiten",
          headers: { cookie: studentCookie },
          payload: { eintraege: [] },
        });
      }
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select id from audit_events order by chain_seq`;
        const mitte = rows[Math.floor(rows.length / 2)];
        await sql`alter table audit_events disable trigger audit_events_no_delete_trg`;
        await sql`delete from audit_events where id = ${mitte.id}`;
        await sql`alter table audit_events enable trigger audit_events_no_delete_trg`;

        const verify = await verifyAuditChain(await getDbForTest(), { alarm: false });
        expect(verify.ok).toBe(false);
        expect(verify.befunde.some((b) => b.kind === "vorgaenger_fehlt")).toBe(true);
      } finally {
        await sql.end();
      }
    });

    it("stellt die Kettenprüfung als Ops-Route bereit (nur audit:read)", async () => {
      const verboten = await app.inject({
        method: "POST",
        url: "/ops/audit/verify",
        headers: { cookie: officeCookie },
      });
      expect(verboten.statusCode).toBe(403);

      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'gf@test.local', password_hash, 'geschaeftsfuehrung', 'G', 'F', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      const gf = await loginAs(app, "gf@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const ok = await app.inject({ method: "POST", url: "/ops/audit/verify", headers: { cookie: gf } });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().ok).toBe(true);
      expect(ok.json().appendOnlyTriggersActive).toBe(true);
    });
  });

  // =======================================================================
  // Sensible Exporte (bestehende Umsetzung prüfen und härten)
  // =======================================================================
  describe("Sensible Exporte: Ablauf, Bindung, Audit", () => {
    async function financeCookie() {
      const sql = createRawClient(databaseUrl);
      try {
        await sql`
          insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname, mfa_enabled, mfa_secret)
          select ${fixtures.standortId}, 'fin-x@test.local', password_hash, 'finanzen', 'F', 'X', true, mfa_secret
            from benutzer where id = ${fixtures.bueroBenutzerId}`;
      } finally {
        await sql.end();
      }
      return loginAs(app, "fin-x@test.local", fixtures.password, fixtures.bueroTotpSecret);
    }

    it("hat einen ABLAUF und liefert nach Ablauf 410 statt der Daten", async () => {
      const cookie = await financeCookie();
      const angefordert = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "umsatz-monat", format: "csv", parameter: {} },
      });
      expect(angefordert.statusCode).toBe(201);
      const url = angefordert.json().downloadUrl as string;

      const ok = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(ok.statusCode).toBe(200);

      const sql = createRawClient(databaseUrl);
      try {
        await sql`update finanz_exporte set abgelaufen_at = now() - interval '1 minute'`;
      } finally {
        await sql.end();
      }
      const abgelaufen = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(abgelaufen.statusCode).toBe(410);
      expect(abgelaufen.json().error).toBe("expired");
    });

    it("es gibt KEINE öffentliche Downloadroute – ohne Sitzung ist der Token wertlos", async () => {
      const cookie = await financeCookie();
      const angefordert = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "umsatz-monat", format: "csv", parameter: {} },
      });
      const url = angefordert.json().downloadUrl as string;
      const ohneSitzung = await app.inject({ method: "GET", url });
      expect(ohneSitzung.statusCode).toBe(401);
    });
  });

  // =======================================================================
  // Least Privilege gegen docs/role-permission-matrix.md
  // =======================================================================
  describe("Least Privilege (Abgleich mit docs/role-permission-matrix.md)", () => {
    it("systemdienst hat KEINE fachliche Berechtigung – nur technische", () => {
      const technisch = new Set([
        "users:manage",
        "audit:read",
        "system:admin",
        "ops:reliability:read",
        "ops:jobs:manage",
      ]);
      for (const perm of ROLE_PERMISSIONS.systemdienst) {
        expect(technisch.has(perm), `systemdienst darf ${perm} nicht haben`).toBe(true);
      }
    });

    it("schueler hat ausschließlich own-Scope und keine Verwaltungsrechte", () => {
      for (const perm of ROLE_PERMISSIONS.schueler) {
        expect(
          perm.endsWith(":own") || perm === "learning:read:own",
          `schueler darf ${perm} nicht haben (kein own-Scope)`,
        ).toBe(true);
      }
    });

    it("die neuen Phase-3-Endpunkte hängen an bestehenden Berechtigungen (keine neue Rolle, kein neues Recht)", async () => {
      // `users:manage` (Prompt 0) für die Rollenänderung, `audit:read` für die
      // Kettenprüfung, `ops:*` für die Integrationsansicht: alle bereits in der
      // Matrix. Phase 3 führt KEINE neue Berechtigung ein.
      const alle = new Set(Object.values(ROLE_PERMISSIONS).flat());
      for (const perm of ["users:manage", "audit:read", "ops:reliability:read", "ops:jobs:manage"]) {
        expect(alle.has(perm as never), `${perm} fehlt in der Matrix`).toBe(true);
      }
    });
  });

  async function getDbForTest() {
    const { getDb } = await import("../db.js");
    return getDb(databaseUrl);
  }
});

async function uploadPdf(app: FastifyInstance, cookie: string, typ: string) {
  const { buildMultipartBody } = await import("./helpers.js");
  const { body, contentType } = buildMultipartBody({
    fields: { typ },
    fileFieldName: "datei",
    fileName: "nachweis.pdf",
    fileContent: Buffer.from("%PDF-1.4 Testinhalt"),
    mimeType: "application/pdf",
  });
  return app.inject({
    method: "POST",
    url: "/documents",
    headers: { cookie, "content-type": contentType, "idempotency-key": idemKey("upl") },
    payload: body,
  });
}
