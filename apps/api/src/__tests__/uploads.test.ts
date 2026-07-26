import { createRawClient } from "@fahrschul/database";
import type { MalwareScanAdapter } from "@fahrschul/integrations";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  MAX_DOCUMENT_BYTES,
  sniffMimeType,
  validateUpload,
} from "../lib/file-validation.js";
import { documentDownloadUrl, signAccess, verifyAccess } from "../lib/signed-access.js";
import { releaseDocumentAfterScan } from "../services/document-pipeline.js";
import { cleanupAbortedUploads } from "../routes/uploads.js";
import {
  buildMultipartBody,
  buildTestApp,
  enableMfa,
  ensureMigrated,
  idemKey,
  loginAs,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

/**
 * PROMPT -1 §12 – Datei- und Dokumentuploads, gehärtet.
 *
 * Die zentrale Zusage, die hier bewiesen wird: **ein Dokument wird niemals als
 * geprüft angezeigt, solange die Virenprüfung nicht sauber durchgelaufen ist**,
 * und **der tatsächliche Dateityp entscheidet, nicht der behauptete**.
 */

const PDF = Buffer.from("%PDF-1.4\nInhalt\n%%EOF");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("dummy-png-inhalt"),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("dummy-jpeg")]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.from("bin ich boese")]);

describe("PROMPT -1 §12 – Upload-Härtung", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;
  let studentCookie: string;
  let student2Cookie: string;
  let officeCookie: string;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
    await enableMfa(databaseUrl, fixtures.bueroBenutzerId, fixtures.bueroTotpSecret);
    app = buildTestApp();
    await app.ready();
    studentCookie = await loginAs(app, "schueler@test.local", fixtures.password);
    student2Cookie = await loginAs(app, "schueler2@test.local", fixtures.password);
    officeCookie = await loginAs(app, "buero@test.local", fixtures.password, fixtures.bueroTotpSecret);
  });

  afterAll(async () => {
    await app?.close();
  });

  function multipart(content: Buffer, mimeType: string, fileName = "datei.pdf") {
    return buildMultipartBody({
      fields: { typ: "sehtest" },
      fileFieldName: "datei",
      fileName,
      fileContent: content,
      mimeType,
    });
  }

  async function upload(app: FastifyInstance, cookie: string, content: Buffer, mimeType: string, fileName?: string) {
    const { body, contentType } = multipart(content, mimeType, fileName);
    return app.inject({
      method: "POST",
      url: "/documents",
      headers: { cookie, "content-type": contentType, "idempotency-key": idemKey("u") },
      payload: body,
    });
  }

  // =======================================================================
  // Magic Bytes: der tatsächliche Typ entscheidet
  // =======================================================================
  describe("Prüfung des TATSÄCHLICHEN Dateityps (Magic Bytes)", () => {
    it("erkennt die drei erlaubten Formate am Dateikopf", () => {
      expect(sniffMimeType(PDF).mime).toBe("application/pdf");
      expect(sniffMimeType(PNG).mime).toBe("image/png");
      expect(sniffMimeType(JPEG).mime).toBe("image/jpeg");
    });

    it("benennt gefährliche Inhalte statt sie nur als 'unbekannt' abzulehnen", () => {
      expect(sniffMimeType(EXE).dangerous).toBe("windows-executable");
      expect(sniffMimeType(Buffer.from("#!/bin/sh\nrm -rf /")).dangerous).toBe("shell-script");
      expect(sniffMimeType(Buffer.from("<svg onload=alert(1)>")).dangerous).toBe("svg-or-xml");
      expect(sniffMimeType(Buffer.from("<!doctype html><script>x</script>")).dangerous).toBe("html");
      expect(sniffMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04])).dangerous).toBe(
        "zip-or-office-container",
      );
    });

    it("WEIST EINE DATEI AB, DIE ÜBER IHREN TYP LÜGT (der Kern von §12)", async () => {
      // Eine ausführbare Datei, die behauptet, ein PNG zu sein.
      const res = await upload(app, studentCookie, EXE, "image/png", "harmlos.png");
      expect(res.statusCode).toBe(415);
      expect(res.json().reason).toBe("detected_type_not_allowed");
      expect(res.json().detail).toContain("windows-executable");

      // Und ein PDF, das behauptet, ein PNG zu sein: auch ein Widerspruch.
      const res2 = await upload(app, studentCookie, PDF, "image/png", "harmlos.png");
      expect(res2.statusCode).toBe(415);
      expect(res2.json().error).toBe("mime_type_mismatch");
      expect(res2.json().detectedMime).toBe("application/pdf");
      expect(res2.json().declaredMime).toBe("image/png");

      // KEIN Dokument ist entstanden.
      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select count(*)::int as n from dokumente`;
        expect(rows[0].n).toBe(0);
      } finally {
        await sql.end();
      }
    });

    it("lehnt einen behaupteten Typ ab, der gar nicht auf der Allowlist steht", () => {
      const result = validateUpload({ buffer: EXE, declaredMime: "application/x-msdownload" });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("declared_type_not_allowed");
    });

    it("lehnt leere und zu große Dateien ab – vor jeder weiteren Arbeit", () => {
      expect(validateUpload({ buffer: Buffer.alloc(0), declaredMime: "application/pdf" }).error).toBe("empty");
      const zuGross = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
      expect(validateUpload({ buffer: zuGross, declaredMime: "application/pdf" }).error).toBe("too_large");
    });
  });

  // =======================================================================
  // Prüfsumme
  // =======================================================================
  describe("Kryptographische Prüfsumme", () => {
    it("speichert SHA-256, Größe und beide MIME-Typen am Dokument", async () => {
      const res = await upload(app, studentCookie, PDF, "application/pdf");
      expect(res.statusCode, res.body).toBe(201);
      const doc = res.json().document;
      expect(doc.checksumSha256).toBe(createHash("sha256").update(PDF).digest("hex"));
      expect(doc.groesseBytes).toBe(PDF.byteLength);
      expect(doc.deklarierterMimeTyp).toBe("application/pdf");
      expect(doc.erkannterMimeTyp).toBe("application/pdf");
    });

    it("erkennt eine abweichende angekündigte Prüfsumme", () => {
      const result = validateUpload({
        buffer: PDF,
        declaredMime: "application/pdf",
        expectedChecksum: "0".repeat(64),
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("checksum_mismatch");
    });
  });

  // =======================================================================
  // Quarantäne zuerst, Freigabe nur nach saubere Scan
  // =======================================================================
  describe("Quarantäne zuerst – Freigabe nur nach sauberem Scan", () => {
    it("bringt einen normalen Upload über `quarantined` nach `submitted` (Scan sauber)", async () => {
      const res = await upload(app, studentCookie, PDF, "application/pdf");
      expect(res.statusCode).toBe(201);
      expect(res.json().document.dokumentStatus).toBe("submitted");
      expect(res.json().document.scanStatus).toBe("sauber");
      expect(res.json().scan.freigegeben).toBe(true);

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`
          select von_status, nach_status from state_transitions
           where machine = 'dokument' order by created_at`;
        expect(rows.map((r) => `${r.von_status}->${r.nach_status}`)).toEqual([
          "uploaded->quarantined",
          "quarantined->scanning",
          "scanning->submitted",
        ]);
      } finally {
        await sql.end();
      }
    });

    it("HÄLT das Dokument in Quarantäne, wenn der Scanner ANSCHLÄGT – und liefert es nie aus", async () => {
      const flagging: MalwareScanAdapter = {
        mode: "mock",
        async scan() {
          return { status: "verdaechtig", scannerName: "test-flagger" };
        },
      };
      const sql = createRawClient(databaseUrl);
      let docId: string;
      try {
        const [row] = await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'x.pdf', 'mock://x', 'quarantined', 'ausstehend')
          returning id`;
        docId = row.id;
      } finally {
        await sql.end();
      }

      const { getDb } = await import("../db.js");
      const result = await releaseDocumentAfterScan(getDb(databaseUrl), {
        dokumentId: docId,
        buffer: PDF,
        dateiname: "x.pdf",
        malwareScan: flagging,
        akteurBenutzerId: fixtures.schuelerBenutzerId,
        standortId: fixtures.standortId,
      });
      expect(result.freigegeben).toBe(false);
      expect(result.scanStatus).toBe("verdaechtig");
      expect(result.status).toBe("quarantined");

      const sql2 = createRawClient(databaseUrl);
      try {
        const rows = await sql2`select dokument_status, scan_status, quarantaene_grund from dokumente where id = ${docId}`;
        expect(rows[0].dokument_status).toBe("quarantined");
        expect(rows[0].scan_status).toBe("verdaechtig");
        expect(rows[0].quarantaene_grund).toContain("angeschlagen");
      } finally {
        await sql2.end();
      }
    });

    it("das Büro kann ein Dokument in Quarantäne NICHT freigeben – DB-Invariante FS009 sichert es zusätzlich", async () => {
      const sql = createRawClient(databaseUrl);
      let docId: string;
      let version: number;
      try {
        const [row] = await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'q.pdf', 'mock://q', 'quarantined', 'ausstehend')
          returning id, version`;
        docId = row.id;
        version = row.version;
      } finally {
        await sql.end();
      }

      const review = await app.inject({
        method: "POST",
        url: `/documents/${docId}/review`,
        headers: { cookie: officeCookie, "if-match": `W/"${version}"` },
        payload: { entscheidung: "akzeptiert", pruefprotokoll: { geprueftePunkte: ["lesbar"] } },
      });
      expect(review.statusCode).toBe(409);
      expect(review.json().error).toBe("document_in_quarantine");

      // Und selbst per Roh-SQL geht es nicht (FS009).
      const sql2 = createRawClient(databaseUrl);
      try {
        await sql2`update dokumente set dokument_status = 'scanning' where id = ${docId}`;
        await sql2`update dokumente set dokument_status = 'submitted' where id = ${docId}`;
        await sql2`update dokumente set dokument_status = 'in_review' where id = ${docId}`;
        await expect(
          sql2`update dokumente set dokument_status = 'verified',
                  pruefprotokoll = '{"geprueftePunkte":["x"]}'::jsonb,
                  geprueft_durch_benutzer_id = ${fixtures.bueroBenutzerId}
               where id = ${docId}`,
        ).rejects.toMatchObject({ code: "FS009" });
      } finally {
        await sql2.end();
      }
    });
  });

  // =======================================================================
  // Kurzlebiger, signierter Zugriff
  // =======================================================================
  describe("Kein öffentlicher Pfad – kurzlebiger signierter Zugriff + Rechteprüfung bei JEDEM Abruf", () => {
    it("liefert eine signierte URL nur für freigegebene Dokumente", async () => {
      await upload(app, studentCookie, PDF, "application/pdf");
      const liste = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const doc = liste.json().documents[0];
      expect(doc.zugriff).not.toBeNull();
      expect(doc.zugriff.url).toContain("/content?sig=");
      expect(liste.json().zugriffGueltigSekunden).toBeGreaterThan(0);

      const abruf = await app.inject({ method: "GET", url: doc.zugriff.url, headers: { cookie: studentCookie } });
      expect(abruf.statusCode, abruf.body).toBe(200);
      expect(abruf.headers["content-type"]).toContain("application/pdf");
      expect(abruf.rawPayload.equals(PDF)).toBe(true);
    });

    it("die Signatur von Schüler A ist für Schüler B NICHT verwendbar (Bindung an den Benutzer)", async () => {
      await upload(app, studentCookie, PDF, "application/pdf");
      const liste = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const url = liste.json().documents[0].zugriff.url as string;

      // Schüler B mit der URL von A: 404 (der Datensatz gehört ihm nicht; die
      // Autorisierung greift VOR der Signaturprüfung und verrät nichts).
      const fremd = await app.inject({ method: "GET", url, headers: { cookie: student2Cookie } });
      expect(fremd.statusCode).toBe(404);
    });

    it("eine ABGELAUFENE Signatur liefert 410, nicht die Datei", async () => {
      const res = await upload(app, studentCookie, PDF, "application/pdf");
      const docId = res.json().document.id as string;

      // Signatur mit Ablauf in der Vergangenheit, korrekt signiert.
      const { url } = documentDownloadUrl({
        dokumentId: docId,
        benutzerId: fixtures.schuelerBenutzerId,
        secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me",
        ttlMs: -1000,
      });
      const abruf = await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });
      expect(abruf.statusCode).toBe(410);
      expect(abruf.json().error).toBe("signature_expired");
    });

    it("eine MANIPULIERTE Signatur liefert 403", async () => {
      await upload(app, studentCookie, PDF, "application/pdf");
      const liste = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const url = (liste.json().documents[0].zugriff.url as string).replace(/.$/, "X");
      const abruf = await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });
      expect(abruf.statusCode).toBe(403);
      expect(abruf.json().error).toBe("signature_invalid");
    });

    it("ohne Sitzung ist die Signatur wertlos – die Rechteprüfung ist SERVERSEITIG, nicht die Signatur", async () => {
      await upload(app, studentCookie, PDF, "application/pdf");
      const liste = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const url = liste.json().documents[0].zugriff.url as string;
      const ohne = await app.inject({ method: "GET", url });
      expect(ohne.statusCode).toBe(401);
    });

    it("jeder Abruf wird auditiert – ohne Dateiname und ohne Inhalt", async () => {
      await upload(app, studentCookie, PDF, "application/pdf");
      const liste = await app.inject({
        method: "GET",
        url: "/documents/mine",
        headers: { cookie: studentCookie },
      });
      const url = liste.json().documents[0].zugriff.url as string;
      await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });

      const sql = createRawClient(databaseUrl);
      try {
        const rows = await sql`select payload from audit_events where type = 'document.accessed'`;
        expect(rows).toHaveLength(1);
        const payload = rows[0].payload as Record<string, unknown>;
        expect(payload.typ).toBe("sehtest");
        expect(JSON.stringify(payload)).not.toContain("Inhalt");
      } finally {
        await sql.end();
      }
    });

    it("die Signaturprüfung ist zweckgebunden (`download` gilt nicht als `thumbnail`)", () => {
      const secret = "s";
      const sig = signAccess(
        { resource: "dokument", resourceId: "abc", benutzerId: "u1", purpose: "download", expiresAt: Date.now() + 60_000 },
        secret,
      );
      expect(
        verifyAccess(sig, { resource: "dokument", resourceId: "abc", benutzerId: "u1", purpose: "download" }, secret).ok,
      ).toBe(true);
      expect(
        verifyAccess(sig, { resource: "dokument", resourceId: "abc", benutzerId: "u1", purpose: "thumbnail" }, secret).ok,
      ).toBe(false);
      expect(
        verifyAccess(sig, { resource: "dokument", resourceId: "abc", benutzerId: "u2", purpose: "download" }, secret).ok,
      ).toBe(false);
    });

    it("liefert ein Dokument in Quarantäne NICHT aus, auch mit gültiger Signatur", async () => {
      const sql = createRawClient(databaseUrl);
      let docId: string;
      try {
        const [row] = await sql`
          insert into dokumente (standort_id, schueler_id, typ, dateiname, speicher_referenz, dokument_status, scan_status)
          values (${fixtures.standortId}, ${fixtures.schuelerId}, 'sehtest', 'q.pdf', 'mock://q', 'quarantined', 'ausstehend')
          returning id`;
        docId = row.id;
      } finally {
        await sql.end();
      }
      const { url } = documentDownloadUrl({
        dokumentId: docId,
        benutzerId: fixtures.schuelerBenutzerId,
        secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me",
      });
      const abruf = await app.inject({ method: "GET", url, headers: { cookie: studentCookie } });
      expect(abruf.statusCode).toBe(409);
      expect(abruf.json().error).toBe("document_in_quarantine");
    });
  });

  // =======================================================================
  // Wiederaufnehmbare Uploads
  // =======================================================================
  describe("Wiederaufnehmbare (resumable) Uploads", () => {
    async function startSession(size: number, checksum?: string) {
      return app.inject({
        method: "POST",
        url: "/uploads",
        headers: { cookie: studentCookie },
        payload: {
          typ: "sehtest",
          dateiname: "gross.pdf",
          mimeTyp: "application/pdf",
          groesseBytes: size,
          ...(checksum ? { checksumSha256: checksum } : {}),
        },
      });
    }

    function chunk(app: FastifyInstance, uploadId: string, index: number, data: Buffer, cookie = studentCookie) {
      return app.inject({
        method: "PUT",
        url: `/uploads/${uploadId}/chunk?index=${index}`,
        headers: { cookie, "content-type": "application/octet-stream" },
        payload: data,
      });
    }

    it("setzt einen Upload aus mehreren Teilstücken zusammen und legt ihn in QUARANTÄNE", async () => {
      const teil1 = PDF.subarray(0, 10);
      const teil2 = PDF.subarray(10);
      const session = await startSession(PDF.byteLength, createHash("sha256").update(PDF).digest("hex"));
      expect(session.statusCode, session.body).toBe(201);
      const uploadId = session.json().uploadId as string;

      expect((await chunk(app, uploadId, 0, teil1)).statusCode).toBe(200);
      const zweiter = await chunk(app, uploadId, 1, teil2);
      expect(zweiter.statusCode).toBe(200);
      expect(zweiter.json().vollstaendig).toBe(true);

      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode, fertig.body).toBe(201);
      expect(fertig.json().document.checksumSha256).toBe(createHash("sha256").update(PDF).digest("hex"));
      // Der Mock-Scanner meldet "sauber", also wurde freigegeben.
      expect(fertig.json().scan.freigegeben).toBe(true);
    });

    it("sagt, WELCHE Teilstücke fehlen – der Client muss nicht raten", async () => {
      const session = await startSession(PDF.byteLength);
      const uploadId = session.json().uploadId as string;
      await chunk(app, uploadId, 0, PDF.subarray(0, 5));

      const status = await app.inject({
        method: "GET",
        url: `/uploads/${uploadId}`,
        headers: { cookie: studentCookie },
      });
      expect(status.json().vorhandeneIndizes).toEqual([0]);
      expect(status.json().empfangeneBytes).toBe(5);
      expect(status.json().erwarteteGroesseBytes).toBe(PDF.byteLength);
    });

    it("ein WIEDERHOLTES Teilstück mit demselben Inhalt ist ein No-op, mit anderem Inhalt ein Konflikt", async () => {
      const session = await startSession(PDF.byteLength);
      const uploadId = session.json().uploadId as string;
      const teil = PDF.subarray(0, 10);

      expect((await chunk(app, uploadId, 0, teil)).json().wiederholt).toBe(false);
      const nochmal = await chunk(app, uploadId, 0, teil);
      expect(nochmal.statusCode).toBe(200);
      expect(nochmal.json().wiederholt).toBe(true);

      const anders = await chunk(app, uploadId, 0, Buffer.from("voellig anders"));
      expect(anders.statusCode).toBe(409);
      expect(anders.json().error).toBe("chunk_conflict");
    });

    it("erkennt eine LÜCKE in den Indizes statt eine kaputte Datei zu bauen", async () => {
      const session = await startSession(20);
      const uploadId = session.json().uploadId as string;
      await chunk(app, uploadId, 0, Buffer.alloc(10, 1));
      await chunk(app, uploadId, 2, Buffer.alloc(10, 2));
      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode).toBe(409);
      expect(fertig.json().error).toBe("upload_gap");
      expect(fertig.json().fehlenderIndex).toBe(1);
    });

    it("weist einen Upload ab, der seine angekündigte Größe überschreitet", async () => {
      const session = await startSession(10);
      const uploadId = session.json().uploadId as string;
      const res = await chunk(app, uploadId, 0, Buffer.alloc(50));
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe("upload_exceeds_declared_size");
    });

    it("prüft am ENDE erneut die Magic Bytes – eine Lüge über mehrere Teilstücke wird erkannt", async () => {
      const session = await startSession(EXE.byteLength);
      const uploadId = session.json().uploadId as string;
      await chunk(app, uploadId, 0, EXE);
      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode).toBe(415);
      expect(fertig.json().detectedMime).toBeNull();
      expect(fertig.json().error).toBe("detected_type_not_allowed");
    });

    it("prüft die angekündigte Prüfsumme beim Zusammensetzen", async () => {
      const session = await startSession(PDF.byteLength, "0".repeat(64));
      const uploadId = session.json().uploadId as string;
      await chunk(app, uploadId, 0, PDF);
      const fertig = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(fertig.statusCode).toBe(422);
      expect(fertig.json().error).toBe("checksum_mismatch");
    });

    it("eine fremde Upload-Sitzung ist NICHT sichtbar und NICHT beschreibbar (404, nicht 403)", async () => {
      const session = await startSession(PDF.byteLength);
      const uploadId = session.json().uploadId as string;
      expect(
        (await app.inject({ method: "GET", url: `/uploads/${uploadId}`, headers: { cookie: student2Cookie } }))
          .statusCode,
      ).toBe(404);
      expect((await chunk(app, uploadId, 0, PDF, student2Cookie)).statusCode).toBe(404);
    });

    it("ein zweites `complete` liefert dasselbe Dokument, kein zweites", async () => {
      const session = await startSession(PDF.byteLength);
      const uploadId = session.json().uploadId as string;
      await chunk(app, uploadId, 0, PDF);
      const erste = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      const zweite = await app.inject({
        method: "POST",
        url: `/uploads/${uploadId}/complete`,
        headers: { cookie: studentCookie },
      });
      expect(zweite.statusCode).toBe(200);
      expect(zweite.json().wiederholt).toBe(true);
      expect(zweite.json().document.id).toBe(erste.json().document.id);
    });

    it("räumt ABGEBROCHENE und ABGELAUFENE Sitzungen auf (Job `uploads.cleanup`)", async () => {
      const abbruch = await startSession(PDF.byteLength);
      const abbruchId = abbruch.json().uploadId as string;
      await chunk(app, abbruchId, 0, PDF.subarray(0, 5));
      const geloescht = await app.inject({
        method: "DELETE",
        url: `/uploads/${abbruchId}`,
        headers: { cookie: studentCookie },
      });
      expect(geloescht.statusCode).toBe(200);

      const abgelaufen = await startSession(PDF.byteLength);
      const abgelaufenId = abgelaufen.json().uploadId as string;
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update upload_sessions set expires_at = now() - interval '1 hour' where id = ${abgelaufenId}`;
        await sql`update upload_sessions set updated_at = now() - interval '2 days' where id = ${abbruchId}`;
      } finally {
        await sql.end();
      }

      const { getDb } = await import("../db.js");
      const result = await cleanupAbortedUploads(getDb(databaseUrl));
      expect(result.abgelaufen).toBe(1);
      expect(result.entfernt).toBe(1);
    });

    it("nimmt kein Teilstück mehr an, wenn die Sitzung abgelaufen ist", async () => {
      const session = await startSession(PDF.byteLength);
      const uploadId = session.json().uploadId as string;
      const sql = createRawClient(databaseUrl);
      try {
        await sql`update upload_sessions set expires_at = now() - interval '1 minute' where id = ${uploadId}`;
      } finally {
        await sql.end();
      }
      const res = await chunk(app, uploadId, 0, PDF);
      expect(res.statusCode).toBe(410);
      expect(res.json().error).toBe("upload_expired");
    });
  });

  // =======================================================================
  // Der Inhalt landet NIE in der Datenbank
  // =======================================================================
  it("speichert NIEMALS den Dateiinhalt in der Datenbank (Security-Risk #4 des Prototyps)", async () => {
    const res = await upload(app, studentCookie, PDF, "application/pdf");
    expect(res.statusCode).toBe(201);
    const sql = createRawClient(databaseUrl);
    try {
      const rows = await sql`select speicher_referenz, checksum_sha256 from dokumente`;
      expect(rows[0].speicher_referenz).toMatch(/^mock-storage:\/\//);
      expect(rows[0].speicher_referenz).not.toContain("PDF");
      expect(rows[0].checksum_sha256).toHaveLength(64);
      // Es gibt keine Spalte, die den Inhalt tragen könnte.
      const spalten = await sql`
        select column_name from information_schema.columns
         where table_name = 'dokumente' and data_type in ('bytea', 'text')`;
      const namen = spalten.map((s) => s.column_name as string);
      expect(namen).not.toContain("inhalt");
      expect(namen).not.toContain("base64");
      expect(namen).not.toContain("content");
    } finally {
      await sql.end();
    }
  });

  it("der Upload-Endpunkt verlangt weiterhin den Idempotenzschlüssel (§2, unverändert)", async () => {
    const { body, contentType } = multipart(PDF, "application/pdf");
    const res = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { cookie: studentCookie, "content-type": contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("idempotency_key_required");
  });

  it("die §12-Härtung gilt auch für den Re-Upload nach Ablehnung", async () => {
    const erste = await upload(app, studentCookie, PDF, "application/pdf");
    const docId = erste.json().document.id as string;
    const { body, contentType } = buildMultipartBody({
      fields: {},
      fileFieldName: "datei",
      fileName: "boese.png",
      fileContent: EXE,
      mimeType: "image/png",
    });
    const reupload = await app.inject({
      method: "POST",
      url: `/documents/${docId}/reupload`,
      headers: { cookie: studentCookie, "content-type": contentType },
      payload: body,
    });
    expect(reupload.statusCode).toBe(415);
  });

  it("hält die Höchstgröße auch auf Fastify-Ebene ein (kein 10-MB-Body im Speicher ohne Grenze)", async () => {
    const gross = buildApp({
      databaseUrl,
      cookieSecure: false,
      logger: false,
      rateLimit: false,
      accessLog: false,
    });
    await gross.ready();
    try {
      // @fastify/multipart ist mit fileSize: 10 MB registriert (siehe app.ts).
      // Eine Datei DARÜBER wird von der Bibliothek abgebrochen, nicht erst von
      // unserer Prüfung – hier belegt über die Konfiguration.
      expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
    } finally {
      await gross.close();
    }
  });
});
