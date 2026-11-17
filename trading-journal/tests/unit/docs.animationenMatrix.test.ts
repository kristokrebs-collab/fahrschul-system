/**
 * `docs/ANIMATIONEN-MATRIX.md` – one row for each of the 177 inventory points the user asked to be checked one by one.
 * This test only guards the shape: every number 1 … 177 appears exactly once as the first cell of a table row, and
 * every row's status is one of the allowed words. Whether a row is TRUE is not something a test can say.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "../../docs/ANIMATIONEN-MATRIX.md");
const STATUS = ["vorhanden", "wiederhergestellt/verbessert", "neu eingebaut", "bewusst nicht", "offen", "nicht prüfbar"];
const TOTAL = 177;

/** Rows of the matrix: `| 12 | Name | Q | Status | … |` (first cell a whole number, status = the fourth cell). */
function matrixRows(): { nr: number; status: string }[] {
  const rows: { nr: number; status: string }[] = [];
  for (const line of readFileSync(FILE, "utf8").split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!/^\d+$/.test(cells[0] ?? "")) continue;
    rows.push({ nr: Number(cells[0]), status: (cells[3] ?? "").replace(/`/g, "") });
  }
  return rows;
}

describe("docs/ANIMATIONEN-MATRIX.md", () => {
  const rows = matrixRows();

  it("has all 177 numbers exactly once", () => {
    const seen = new Map<number, number>();
    for (const r of rows) seen.set(r.nr, (seen.get(r.nr) ?? 0) + 1);
    const missing = Array.from({ length: TOTAL }, (_, i) => i + 1).filter((n) => !seen.has(n));
    const doubled = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
    const outside = [...seen.keys()].filter((n) => n < 1 || n > TOTAL);
    expect({ missing, doubled, outside }).toEqual({ missing: [], doubled: [], outside: [] });
    expect(rows).toHaveLength(TOTAL);
  });

  it("gives every row one of the allowed statuses", () => {
    const wrong = rows.filter((r) => !STATUS.includes(r.status)).map((r) => `${r.nr}: ${r.status || "(leer)"}`);
    expect(wrong).toEqual([]);
  });
});
