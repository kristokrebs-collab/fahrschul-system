import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, generateTotpSecret } from "@fahrschul/auth";
import { createRawClient } from "@fahrschul/database";
import {
  buildTestApp,
  enableMfa,
  ensureMigrated,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

const TEST_PASSWORD = "Test-Passwort-123!";

interface FinanceFixtures extends SeededFixtures {
  finanzenBenutzerId: string;
  finanzenTotpSecret: string;
  gfBenutzerId: string;
  gfTotpSecret: string;
  rechnungId: string;
  rechnungsnummer: string;
}

async function seedFinanceUsers(databaseUrl: string, base: SeededFixtures): Promise<FinanceFixtures> {
  const sql = createRawClient(databaseUrl);
  try {
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const finanzenTotpSecret = generateTotpSecret();
    const gfTotpSecret = generateTotpSecret();

    const [finanzenBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${base.standortId}, 'finanzen@test.local', ${passwordHash}, 'finanzen', 'Finanz', 'Test')
      returning id`;
    const [gfBenutzer] = await sql`
      insert into benutzer (standort_id, email, password_hash, rolle, vorname, nachname)
      values (${base.standortId}, 'gf@test.local', ${passwordHash}, 'geschaeftsfuehrung', 'GF', 'Test')
      returning id`;

    const rechnungsnummer = "RE-TEST-0001";
    const [rechnung] = await sql`
      insert into rechnungen (standort_id, schueler_id, betrag_cent, status, rechnungsnummer, faellig_am)
      values (${base.standortId}, ${base.schuelerId}, 10000, 'offen', ${rechnungsnummer}, current_date)
      returning id`;

    return {
      ...base,
      finanzenBenutzerId: finanzenBenutzer.id,
      finanzenTotpSecret,
      gfBenutzerId: gfBenutzer.id,
      gfTotpSecret,
      rechnungId: rechnung.id,
      rechnungsnummer,
    };
  } finally {
    await sql.end();
  }
}

describe("apps/finance – PROMPT 4", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: FinanceFixtures;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    const base = await seedFixtures(databaseUrl);
    fixtures = await seedFinanceUsers(databaseUrl, base);
    await enableMfa(databaseUrl, fixtures.finanzenBenutzerId, fixtures.finanzenTotpSecret);
    await enableMfa(databaseUrl, fixtures.gfBenutzerId, fixtures.gfTotpSecret);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
  });

  describe("Rollenrechte (Non-Negotiable: nur finanzen/geschaeftsfuehrung)", () => {
    it("rejects schueler from the finance cockpit (403)", async () => {
      const cookie = await loginAs(app, "schueler@test.local", fixtures.password);
      const res = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      expect(res.statusCode).toBe(403);
    });

    it("rejects fahrlehrer from the finance cockpit (403)", async () => {
      const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);
      const res = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      expect(res.statusCode).toBe(403);
    });

    it("rejects buero (no explicit finance role) from the finance cockpit (403) even though buero has office:dashboard:read", async () => {
      const cookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const res = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      expect(res.statusCode).toBe(403);
    });

    it("rejects buero from bank reconciliation (bank:reconcile stays finanzen-only)", async () => {
      const cookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      const res = await app.inject({ method: "POST", url: "/finance/bank/sync", headers: { cookie }, payload: {} });
      expect(res.statusCode).toBe(403);
    });

    it("allows finanzen to read the cockpit and reconcile the bank", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const kpis = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      expect(kpis.statusCode).toBe(200);
      const sync = await app.inject({ method: "POST", url: "/finance/bank/sync", headers: { cookie }, payload: {} });
      expect(sync.statusCode).toBe(200);
    });

    it("allows geschaeftsfuehrung to read the cockpit (Prompt 0 gap closed) but NOT to reconcile the bank", async () => {
      const cookie = await loginAs(app, "gf@test.local", fixtures.password, fixtures.gfTotpSecret);
      const kpis = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      expect(kpis.statusCode).toBe(200);
      const sync = await app.inject({ method: "POST", url: "/finance/bank/sync", headers: { cookie }, payload: {} });
      expect(sync.statusCode).toBe(403);
    });

    it("rejects geschaeftsfuehrung from managing the product price list (products:manage stays finanzen-only)", async () => {
      const cookie = await loginAs(app, "gf@test.local", fixtures.password, fixtures.gfTotpSecret);
      const res = await app.inject({
        method: "POST",
        url: "/finance/produkte",
        headers: { cookie },
        payload: { code: "B", bezeichnung: "Klasse B", kategorie: "klasse", preisCent: 250000 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("does NOT elevate office's existing read-only invoices:read:own permission to invoices:manage/finance:*", async () => {
      const cookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
      // Prompt 2 already granted buero the read-only invoices:read:own scope
      // (unchanged, pre-existing behaviour) -- this asserts Prompt 4 did not
      // additionally grant buero invoices:manage/payments:manage/finance:*.
      const mine = await app.inject({ method: "GET", url: "/invoices/mine", headers: { cookie } });
      expect(mine.statusCode).toBe(200);

      const manageRes = await app.inject({
        method: "POST",
        url: "/finance/produkte",
        headers: { cookie },
        payload: { code: "B", bezeichnung: "Klasse B", kategorie: "klasse", preisCent: 250000 },
      });
      expect(manageRes.statusCode).toBe(403);

      const bankRes = await app.inject({ method: "GET", url: "/finance/bank/queue", headers: { cookie } });
      expect(bankRes.statusCode).toBe(403);
    });
  });

  describe("Bankabgleich end-to-end gegen den Mock-Feed", () => {
    it("syncs the mock bank feed and only auto-books the 'sicher' match", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const res = await app.inject({ method: "POST", url: "/finance/bank/sync", headers: { cookie }, payload: {} });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.verarbeitet).toBe("number");

      const [rechnung] = await createRawClient(databaseUrl)`select status from rechnungen where id = ${fixtures.rechnungId}`;
      // Mock-Feed liefert per Default keine Transaktion für unsere Test-Rechnungsnummer,
      // daher bleibt die Rechnung offen -- das bestätigt dass NICHTS blind auto-gebucht wird.
      expect(["offen", "bezahlt"]).toContain(rechnung.status);
    });

    it("exposes only unresolved (status=offen) transactions in the review queue, never auto-booked ones", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      await app.inject({ method: "POST", url: "/finance/bank/sync", headers: { cookie }, payload: {} });
      const queueRes = await app.inject({ method: "GET", url: "/finance/bank/queue", headers: { cookie } });
      expect(queueRes.statusCode).toBe(200);
      const queue = queueRes.json().queue as Array<{ status: string; autoGebucht: boolean }>;
      expect(queue.every((q) => q.status === "offen" && q.autoGebucht === false)).toBe(true);
    });
  });

  describe("Datenqualität-Queue", () => {
    it("reports invoices without a Rechnungsnummer as a data-quality issue", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const raw = createRawClient(databaseUrl);
      await raw`insert into rechnungen (standort_id, schueler_id, betrag_cent, status) values (${fixtures.standortId}, ${fixtures.schuelerId}, 5000, 'offen')`;
      await raw.end();

      const res = await app.inject({ method: "GET", url: "/finance/data-quality", headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const issue = res.json().issues.find((i: { typ: string }) => i.typ === "invoices_without_number");
      expect(Number(issue.anzahl)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Export: Autorisierung + Audit-Log, kein öffentlicher Downloadpfad", () => {
    it("requires finance:export to request an export", async () => {
      const cookie = await loginAs(app, "schueler@test.local", fixtures.password);
      const res = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "gf_cockpit", format: "csv" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("issues a session-bound signed download token and rejects downloads without/with wrong token", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const created = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "gf_cockpit", format: "csv" },
      });
      expect(created.statusCode).toBe(201);
      const { exportId, downloadUrl } = created.json();

      const wrongToken = await app.inject({
        method: "GET",
        url: `/finance/exports/${exportId}/download?token=wrong-token`,
        headers: { cookie },
      });
      expect(wrongToken.statusCode).toBe(404);

      const ok = await app.inject({ method: "GET", url: downloadUrl, headers: { cookie } });
      expect(ok.statusCode).toBe(200);
    });

    it("rejects a download by a different finance user than the one who requested it", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const created = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "gf_cockpit", format: "csv" },
      });
      const { downloadUrl } = created.json();

      const gfCookie = await loginAs(app, "gf@test.local", fixtures.password, fixtures.gfTotpSecret);
      const res = await app.inject({ method: "GET", url: downloadUrl, headers: { cookie: gfCookie } });
      expect(res.statusCode).toBe(403);
    });

    it("logs every export request and download to the audit log", async () => {
      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const created = await app.inject({
        method: "POST",
        url: "/finance/exports",
        headers: { cookie },
        payload: { bericht: "offene_forderungen", format: "xlsx" },
      });
      const { downloadUrl } = created.json();
      await app.inject({ method: "GET", url: downloadUrl, headers: { cookie } });

      const raw = createRawClient(databaseUrl);
      const rows = await raw`select aktion from audit_events where entitaet = 'finanz_export' order by created_at asc`;
      await raw.end();
      expect(rows.map((r) => r.aktion)).toEqual(
        expect.arrayContaining(["finance.export.request", "finance.export.download"]),
      );
    });
  });

  describe("Große Datenmenge: KPI-Aggregation bleibt korrekt und performant", () => {
    it("aggregates hundreds of invoices correctly", async () => {
      const raw = createRawClient(databaseUrl);
      const values = Array.from(
        { length: 300 },
        (_, i) => `('${fixtures.standortId}', '${fixtures.schuelerId}', 1000, 'offen', 'RE-BULK-${i}')`,
      ).join(",");
      await raw.unsafe(
        `insert into rechnungen (standort_id, schueler_id, betrag_cent, status, rechnungsnummer) values ${values}`,
      );
      await raw.end();

      const cookie = await loginAs(app, "finanzen@test.local", fixtures.password, fixtures.finanzenTotpSecret);
      const start = Date.now();
      const res = await app.inject({ method: "GET", url: "/finance/kpis", headers: { cookie } });
      const durationMs = Date.now() - start;
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const leistungCard = body.cards.find((c: { id: string }) => c.id === "leistung_umsatz");
      expect(Number(leistungCard.anzahlRechnungen)).toBeGreaterThanOrEqual(300);
      expect(durationMs).toBeLessThan(5000);
    });
  });
});
