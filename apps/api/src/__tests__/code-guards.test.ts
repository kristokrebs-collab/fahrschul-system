import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * PROMPT -1 §17 – die WÄCHTER, damit drei bereits erreichte Zusagen nicht
 * unbemerkt zurückfallen können.
 *
 * Die Prompt-5-Review hat festgestellt, dass es keine SQL-String-Verkettung
 * gibt und dass zod überall benutzt wird. Beides war eine MOMENTAUFNAHME. Ohne
 * einen automatischen Wächter genügt ein einziger neuer Endpunkt, um es
 * zurückzudrehen – und niemand merkt es. Diese Datei ist der Wächter.
 *
 * Warum ein Test und keine ESLint-Regel? Weil es in diesem Repository keine
 * ESLint-Konfiguration gibt (kein Linter in der Toolchain). Eine neue
 * Lint-Abhängigkeit hätte in dieser Umgebung keinen CI-Lauf, der sie
 * ausführt – ein Test läuft mit `pnpm -r test` garantiert mit. Der Preis: die
 * Prüfung ist eine Textanalyse, keine AST-Analyse. Sie ist deshalb bewusst
 * konservativ (sie schlägt bei Verdacht an und verlangt eine bewusste
 * Ausnahme) statt clever.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..");
const REPO = join(SRC, "..", "..", "..");

function alleDateien(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      alleDateien(full, filter, out);
      continue;
    }
    if (filter(full)) out.push(full);
  }
  return out;
}

const QUELLDATEIEN = alleDateien(
  SRC,
  (p) => p.endsWith(".ts") && !p.includes("__tests__"),
);

/** Zeilen ohne Kommentare – ein Muster in einem Kommentar ist kein Befund. */
function codeZeilen(inhalt: string): Array<{ nr: number; text: string }> {
  const zeilen = inhalt.split("\n");
  const out: Array<{ nr: number; text: string }> = [];
  let inBlock = false;
  for (let i = 0; i < zeilen.length; i += 1) {
    let text = zeilen[i];
    if (inBlock) {
      const ende = text.indexOf("*/");
      if (ende === -1) continue;
      text = text.slice(ende + 2);
      inBlock = false;
    }
    const blockStart = text.indexOf("/*");
    if (blockStart !== -1) {
      const ende = text.indexOf("*/", blockStart + 2);
      if (ende === -1) {
        text = text.slice(0, blockStart);
        inBlock = true;
      } else {
        text = text.slice(0, blockStart) + text.slice(ende + 2);
      }
    }
    const line = text.indexOf("//");
    if (line !== -1) text = text.slice(0, line);
    if (text.trim().length > 0) out.push({ nr: i + 1, text });
  }
  return out;
}

describe("PROMPT -1 §17 – Wächter gegen Regression", () => {
  // =======================================================================
  // Parametrisierte Abfragen
  // =======================================================================
  describe("Parametrisierte Abfragen (kein SQL aus Zeichenkettenverkettung)", () => {
    it("findet Quelldateien überhaupt (Selbsttest des Wächters)", () => {
      expect(QUELLDATEIEN.length).toBeGreaterThan(30);
    });

    it("es gibt KEIN `sql.unsafe(...)` außerhalb des Migrationsläufers", () => {
      const treffer: string[] = [];
      for (const datei of QUELLDATEIEN) {
        for (const { nr, text } of codeZeilen(readFileSync(datei, "utf-8"))) {
          if (/\.unsafe\s*\(/.test(text)) treffer.push(`${relative(REPO, datei)}:${nr}`);
        }
      }
      // `tx.unsafe(content)` in packages/database/src/migrate.ts ist der EINE
      // erlaubte Fall: eine Migrationsdatei ist per Definition kein
      // Benutzereingabe-Kanal. Er liegt außerhalb von apps/api/src.
      expect(treffer).toEqual([]);
    });

    it("kein `sql`-Template mit interpoliertem Bezeichner (Tabellen-/Spaltenname aus einer Variable)", () => {
      // Gefährlich wäre: sql`select * from ${tabelle}` – postgres.js würde das
      // als PARAMETER senden, was bei einem Bezeichner einen Syntaxfehler gibt;
      // gefährlich ist es in Verbindung mit .unsafe(). Der Wächter sucht nach
      // klassischer Verkettung IN einem Query-String.
      const treffer: string[] = [];
      for (const datei of QUELLDATEIEN) {
        for (const { nr, text } of codeZeilen(readFileSync(datei, "utf-8"))) {
          // "select ... " + variable  bzw.  `... ${x} ...` in einem
          // NICHT-Tagged-Template, das SQL-Schlüsselwörter enthält.
          if (/(["'])\s*(select|insert into|update |delete from)\b[^"']*\1\s*\+/i.test(text)) {
            treffer.push(`${relative(REPO, datei)}:${nr}`);
          }
          if (/`[^`]*\b(select|insert into|update |delete from)\b[^`]*\$\{/i.test(text)) {
            // Ein TAGGED Template (sql`...`) ist erlaubt – dort ist ${} ein
            // Bindeparameter. Erkennbar am Präfix `sql` bzw. `tx`.
            const getaggt = /(?:^|[^A-Za-z0-9_])(sql|tx|t|client|db)\s*`/.test(text) || /sql`/.test(text);
            if (!getaggt) treffer.push(`${relative(REPO, datei)}:${nr}`);
          }
        }
      }
      expect(treffer).toEqual([]);
    });

    /**
     * PROMPT -1 Phase 4 – die Lücke, die der Wächter darüber hatte.
     *
     * `claimJobs` in `workers/job-store.ts` baute die `in (...)`-Liste der
     * Job-Typen als ZEICHENKETTE und gab sie an `sql.raw(...)`:
     *
     *     sql` and job_type in ${sql.raw(`(${types.map((t) => `'${t}'`).join(",")})`)}`
     *
     * Der Test darüber hat das durchgelassen, weil die Zeile ``sql` ``
     * enthält und damit als "getaggtes Template" (= parametrisiert) gewertet
     * wurde. `sql.raw()` ist aber genau das Gegenteil: sein Argument wird
     * UNVERÄNDERT in den Abfragetext eingesetzt. Die Werte kamen aus dem Body
     * von `POST /ops/jobs/run`.
     *
     * Dieser Wächter schließt die Lücke: `sql.raw(` darf kein `${...}` und
     * keine Verkettung enthalten – nur eine literale Zeichenkette.
     */
    it("kein `sql.raw(...)` mit interpoliertem oder verkettetem Inhalt", () => {
      const treffer: string[] = [];
      for (const datei of QUELLDATEIEN) {
        for (const { nr, text } of codeZeilen(readFileSync(datei, "utf-8"))) {
          const stelle = text.indexOf("sql.raw(");
          if (stelle === -1) continue;
          const rest = text.slice(stelle + "sql.raw(".length);
          // Erlaubt: sql.raw("literal") / sql.raw('literal') / sql.raw(`literal`)
          // ohne ${...} und ohne +-Verkettung.
          const literal = /^\s*(["'`])(?:(?!\1)[^\\$+])*\1\s*\)/.test(rest);
          if (!literal) treffer.push(`${relative(REPO, datei)}:${nr}`);
        }
      }
      expect(treffer).toEqual([]);
    });

    it("kein `eval`, kein `new Function`, kein `child_process`", () => {
      const treffer: string[] = [];
      for (const datei of QUELLDATEIEN) {
        for (const { nr, text } of codeZeilen(readFileSync(datei, "utf-8"))) {
          if (/\beval\s*\(/.test(text)) treffer.push(`eval ${relative(REPO, datei)}:${nr}`);
          if (/new\s+Function\s*\(/.test(text)) treffer.push(`Function ${relative(REPO, datei)}:${nr}`);
          if (/child_process/.test(text)) treffer.push(`child_process ${relative(REPO, datei)}:${nr}`);
        }
      }
      expect(treffer).toEqual([]);
    });

    it("kein `TLS`-Abschalter und kein `rejectUnauthorized: false`", () => {
      const treffer: string[] = [];
      for (const datei of QUELLDATEIEN) {
        for (const { nr, text } of codeZeilen(readFileSync(datei, "utf-8"))) {
          if (/rejectUnauthorized\s*:\s*false/.test(text)) treffer.push(`${relative(REPO, datei)}:${nr}`);
          if (/NODE_TLS_REJECT_UNAUTHORIZED/.test(text)) treffer.push(`${relative(REPO, datei)}:${nr}`);
        }
      }
      expect(treffer).toEqual([]);
    });
  });

  // =======================================================================
  // Eingabevalidierung
  // =======================================================================
  describe("Eingabevalidierung: JEDER Schreibendpunkt validiert", () => {
    /**
     * Endpunkte OHNE Body: für sie gibt es nichts zu validieren. Bewusst eine
     * geschlossene Liste mit Begründung – ein neuer Endpunkt landet NICHT
     * automatisch hier.
     */
    const OHNE_BODY = new Set([
      "POST /auth/logout", // kein Body
      "POST /auth/logout-all", // kein Body
      "POST /appointment-offers/:id/decline", // nur die :id aus dem Pfad
      "POST /instructor/lessons/:id/start", // nur die :id; alle Prüfungen in startLesson
      "POST /instructor/lessons/:id/no-show", // nur die :id
      "POST /instructor/voice-logs/:id/confirm", // nur die :id
      "POST /leads/:id/convert", // nur die :id; Daten kommen aus dem Lead
      "POST /learning/resources/:id/visit", // nur die :id
      "POST /storno-angebote/:id/expire", // nur die :id
      "POST /ops/consistency/run", // kein Body
      "POST /flex/opt-in", // kein Body, wirkt auf die eigene Sitzung
      "DELETE /flex/opt-in", // kein Body, wirkt auf die eigene Sitzung
      "POST /resources/fahrzeugmaengel/:id/beheben", // nur die :id aus dem Pfad
      "DELETE /uploads/:id", // nur die :id aus dem Pfad
      "POST /ops/uploads/cleanup", // kein Body
      "POST /ops/auth/locks/purge", // kein Body
      "POST /ops/jobs/schedule-recurring", // kein Body
      "POST /ops/workers/run", // kein Body
      "POST /ops/dead-letters/:id/resume", // nur die :id aus dem Pfad
    ]);

    function routenDatei(datei: string) {
      const inhalt = readFileSync(datei, "utf-8");
      const routen: Array<{ methode: string; pfad: string; body: string }> = [];
      const re = /app\.(post|put|patch|delete)\(\s*\n?\s*"([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inhalt)) !== null) {
        // Der Rumpf reicht bis zum nächsten `app.<methode>(` oder Dateiende.
        const rest = inhalt.slice(m.index);
        const naechste = rest.slice(20).search(/app\.(get|post|put|patch|delete)\(/);
        routen.push({
          methode: m[1].toUpperCase(),
          pfad: m[2],
          body: naechste === -1 ? rest : rest.slice(0, naechste + 20),
        });
      }
      return routen;
    }

    it("jede POST/PUT/PATCH/DELETE-Route benutzt zod ODER steht begründet auf der Body-freien Liste", () => {
      const routenDateien = alleDateien(
        join(SRC, "routes"),
        (p) => p.endsWith(".ts"),
      );
      const fehlend: string[] = [];
      let geprueft = 0;
      for (const datei of routenDateien) {
        for (const route of routenDatei(datei)) {
          geprueft += 1;
          const name = `${route.methode} ${route.pfad}`;
          if (OHNE_BODY.has(name)) continue;
          const validiert =
            /safeParse\(/.test(route.body) ||
            /\.parse\(/.test(route.body) ||
            // Multipart: die Prüfung läuft über validateUpload (§12).
            /validateUpload\(/.test(route.body);
          if (!validiert) fehlend.push(`${name} (${relative(REPO, datei)})`);
        }
      }
      expect(geprueft).toBeGreaterThan(30);
      expect(fehlend).toEqual([]);
    });

    it("die Body-freie Liste enthält nur Routen, die es TATSÄCHLICH gibt (kein toter Freibrief)", () => {
      const routenDateien = alleDateien(join(SRC, "routes"), (p) => p.endsWith(".ts"));
      const vorhanden = new Set<string>();
      for (const datei of routenDateien) {
        for (const route of routenDatei(datei)) vorhanden.add(`${route.methode} ${route.pfad}`);
      }
      const veraltet = [...OHNE_BODY].filter((n) => !vorhanden.has(n));
      expect(veraltet).toEqual([]);
    });

    it("jede Route hat einen `preHandler` mit Autorisierung (kein offener Schreibendpunkt)", () => {
      const routenDateien = alleDateien(join(SRC, "routes"), (p) => p.endsWith(".ts"));
      /** Öffentlich mit Begründung. */
      const OEFFENTLICH = new Set(["POST /auth/login"]);
      const ohneAuth: string[] = [];
      for (const datei of routenDateien) {
        for (const route of routenDatei(datei)) {
          const name = `${route.methode} ${route.pfad}`;
          if (OEFFENTLICH.has(name)) continue;
          const kopf = route.body.slice(0, 600);
          if (!/requireAuth/.test(kopf)) ohneAuth.push(`${name} (${relative(REPO, datei)})`);
        }
      }
      expect(ohneAuth).toEqual([]);
    });
  });

  // =======================================================================
  // Redaktionsvertrag der Fahrlehrer-Notizen – nach Phase 3 erneut geprüft
  // =======================================================================
  describe("Redaktionsvertrag: `internalNotes` bleibt aus jeder schülerseitigen Antwort", () => {
    it("keine schülerseitige Spaltenauswahl selektiert `internalNotes`", () => {
      const feedback = readFileSync(join(SRC, "routes", "feedback.ts"), "utf-8");
      const block = feedback.slice(
        feedback.indexOf("const STUDENT_VISIBLE_COLUMNS"),
        feedback.indexOf("} as const;", feedback.indexOf("const STUDENT_VISIBLE_COLUMNS")),
      );
      expect(block).not.toContain("internalNotes");
      // Und die Phase-3-Ergänzung (Version/ETag) ist da.
      expect(block).toContain("version");
      expect(block).toContain("updatedAt");
    });

    it("`internalNotes` und `pruefprotokoll` stehen auf der Redaktionsliste von §16", async () => {
      const { REDACTED_KEY_PATTERNS } = await import("../lib/observability.js");
      const normalisiert = REDACTED_KEY_PATTERNS.map((p) => p.replace(/[^a-z0-9]/g, ""));
      for (const feld of ["internalnotes", "pruefprotokoll", "transcript", "iban", "password", "token"]) {
        expect(normalisiert, `${feld} fehlt in der Redaktionsliste`).toContain(feld);
      }
    });
  });

  // =======================================================================
  // §16 Alarmkatalog: die Runbook-Anker müssen EXISTIEREN
  // =======================================================================
  describe("Alarmkatalog: jeder Runbook-Verweis zeigt auf einen echten Anker", () => {
    it("löst alle Runbook-Anker in den Dokumenten auf", async () => {
      const { ALARM_CATALOG } = await import("../workers/alarm.js");
      const fehlend: string[] = [];
      for (const eintrag of ALARM_CATALOG) {
        const [datei, anker] = eintrag.runbook.split("#");
        const inhalt = readFileSync(join(REPO, datei), "utf-8");
        // Die Runbooks setzen einen expliziten Anker (`<a id="...">`), damit ein
        // Umformulieren der Überschrift den Verweis nicht bricht.
        if (!inhalt.includes(`id="${anker}"`)) fehlend.push(eintrag.runbook);
      }
      expect(fehlend).toEqual([]);
      expect(ALARM_CATALOG.length).toBeGreaterThanOrEqual(10);
    });

    it("die beiden §22-Dokumente dieser Phase existieren und sind nicht leer", () => {
      for (const datei of ["docs/security-architecture.md", "docs/failure-modes.md"]) {
        const inhalt = readFileSync(join(REPO, datei), "utf-8");
        expect(inhalt.length, `${datei} ist zu kurz`).toBeGreaterThan(4000);
        expect(inhalt).toContain("PROMPT -1");
      }
    });
  });

  // =======================================================================
  // Non-Negotiables, die Phase 3 nicht angetastet haben darf
  // =======================================================================
  describe("Non-Negotiables nach Phase 3 erneut geprüft (statisch)", () => {
    it("der EXCLUDE-Constraint gegen Doppelbuchung wird von keiner Migration entfernt", () => {
      const migrationen = alleDateien(
        join(REPO, "packages", "database", "migrations"),
        (p) => p.endsWith(".sql"),
      );
      const inhalt = migrationen.map((m) => readFileSync(m, "utf-8")).join("\n");
      expect(inhalt).toContain("terminbuchungen_no_overlap_fahrlehrer");
      expect(inhalt.toLowerCase()).not.toMatch(/drop\s+constraint\s+terminbuchungen_no_overlap/);
    });

    it("Migration 0009 ist expand-contract: kein DROP COLUMN, kein DROP TABLE, kein RENAME", () => {
      const sql = readFileSync(
        join(REPO, "packages", "database", "migrations", "0009_defense_in_depth.sql"),
        "utf-8",
      );
      const zeilen = sql
        .split("\n")
        .filter((z) => !z.trim().startsWith("--"))
        .join("\n")
        .toLowerCase();
      expect(zeilen).not.toMatch(/drop\s+column/);
      expect(zeilen).not.toMatch(/drop\s+table/);
      expect(zeilen).not.toMatch(/rename\s+(column|to)/);
      expect(zeilen).not.toMatch(/alter\s+column[^;]*set\s+not\s+null/);
    });

    it("alle §2-Operationen bleiben verpflichtend (Phase 2 hat sie umgeschaltet)", async () => {
      const { IDEMPOTENCY_MANDATORY } = await import("../lib/idempotency.js");
      const werte = Object.values(IDEMPOTENCY_MANDATORY);
      expect(werte).toHaveLength(10);
      expect(werte.every((v) => v === true)).toBe(true);
    });

    it("es gibt keinen Endpunkt, der eine Prüfungsfreigabe AUTOMATISCH erteilt", () => {
      const pipeline = readFileSync(join(SRC, "routes", "exam-pipeline.ts"), "utf-8");
      // Jeder Übergang kommt aus dem Request-Body und wird rollen-/
      // reihenfolgegeprüft; es gibt keinen Zweig, der `fahrlehrer_go` selbst
      // setzt.
      expect(pipeline).toContain("assertTransitionAllowed");
      expect(pipeline).not.toMatch(/to:\s*"fahrlehrer_go"/);
    });

    it("nur `konfidenz = 'sicher'` wird automatisch gebucht", () => {
      const jobs = readFileSync(join(SRC, "workers", "job-handlers.ts"), "utf-8");
      expect(jobs).toContain(`tx.konfidenz === "sicher"`);
      const finance = readFileSync(join(SRC, "routes", "finance.ts"), "utf-8");
      expect(finance).toContain("result.autoBuchbar");
    });

    it("`fahrlehrer_go` bleibt auf die Rolle fahrlehrer beschränkt", () => {
      const domain = readFileSync(
        join(REPO, "packages", "domain", "src", "pruefungspipeline.ts"),
        "utf-8",
      );
      const zeilen = domain.split("\n").filter((z) => z.includes('to: "fahrlehrer_go"'));
      expect(zeilen.length).toBeGreaterThan(0);
      for (const z of zeilen) {
        expect(z).toContain('allowedRoles: ["fahrlehrer"]');
      }
    });

    it("die frozen Prototyp-Dateien sind unangetastet (keine Phase-3-Änderung dort)", () => {
      for (const datei of [
        "app.html",
        "dashboard.html",
        "fahrlehrer.html",
        "cockpit-pro.html",
        "website.html",
        "server.py",
        "sync-data.json",
      ]) {
        const inhalt = readFileSync(join(REPO, datei), "utf-8");
        // "PROMPT -1" ist der Marker, den ALLE vier Phasen in ihren Code
        // schreiben. Sein Fehlen belegt, dass keine Phase diese Dateien
        // angefasst hat. (Auf "Phase 3" kann nicht geprüft werden: der
        // Prototyp-Text in cockpit-pro.html enthält die Wortfolge selbst.)
        expect(inhalt, `${datei} wurde von einer PROMPT--1-Phase verändert`).not.toContain("PROMPT -1");
      }
    });
  });
});
