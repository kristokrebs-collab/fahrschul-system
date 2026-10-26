/**
 * "Siehe auch" between pages (`src/app/seeAlso.ts`, `<SeeAlso at="…" />`): few, calm, true. Every row is held to the register: its
 * target exists, lives on ANOTHER page than the row, and is related to the card in the register's own "Siehe auch"; no row is
 * longer than three links, a page carries at most three rows, and every row is really placed on a page.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeatureLinks, SeeAlso } from "@/app/FeatureLinks";
import { featureById } from "@/app/features";
import { SEE_ALSO, type SeeAlsoKey } from "@/app/seeAlso";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const ENTRIES = Object.entries(SEE_ALSO) as [SeeAlsoKey, (typeof SEE_ALSO)[SeeAlsoKey]][];

describe("the table of 'Siehe auch'", () => {
  it("is short: at most three links a row, at most three rows a page, a name that fits a line", () => {
    const perPage = new Map<string, number>();
    for (const [key, row] of ENTRIES) {
      expect(row.links.length, key).toBeGreaterThanOrEqual(1);
      expect(row.links.length, key).toBeLessThanOrEqual(3);
      for (const l of row.links) {
        expect(l.label.length, `${key} › ${l.label}`).toBeLessThanOrEqual(34);
        expect(l.label, `${key} › ${l.label}`).not.toMatch(/\s$|^\s/);
      }
      const page = key.split(".")[0]!;
      perPage.set(page, (perPage.get(page) ?? 0) + 1);
    }
    for (const [page, n] of perPage) expect(n, `${page} carries ${n} rows`).toBeLessThanOrEqual(3);
  });

  it("points at functions of the register on another page, related to the card in the register's own 'Siehe auch'", () => {
    for (const [key, row] of ENTRIES) {
      const page = key.split(".")[0]!;
      const from = featureById(row.from);
      expect(from, `${key}: from ${row.from}`).toBeTruthy();
      const ids = row.links.map((l) => l.id);
      expect(new Set(ids).size, key).toBe(ids.length);
      for (const l of row.links) {
        const to = featureById(l.id);
        expect(to, `${key} → ${l.id}`).toBeTruthy();
        expect(l.id, `${key} links to its own card`).not.toBe(row.from);
        expect(to!.page, `${key} → ${l.id} is on the same page (${page}): scrolling is enough`).not.toBe(page);
        const related = (from!.see ?? []).includes(l.id) || (to!.see ?? []).includes(row.from);
        expect(related, `${key}: the register relates neither ${row.from} to ${l.id} nor the other way round`).toBe(true);
        // a link never promises more than the function does: the label names the function's own words
        const first = l.label.split(/[ (:]/)[0]!.replace(/[-–]/g, "").toLowerCase();
        const hay = `${to!.name} ${to!.place ?? ""} ${to!.keywords.join(" ")}`.replace(/[-–]/g, "").toLowerCase();
        expect(hay.includes(first.slice(0, 5)), `${key}: label "${l.label}" does not read like ${to!.name}`).toBe(true);
      }
    }
  });

  it("is placed: every row is used by a page, and no page uses a row that does not exist", () => {
    const text = files(SRC)
      .filter((f) => !f.endsWith("FeatureLinks.tsx"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const used = [...text.matchAll(/<SeeAlso\s+at="([^"]+)"/g)].map((m) => m[1]!);
    for (const [key] of ENTRIES) expect(used, `${key} is not placed on any page`).toContain(key);
    for (const u of used) expect(Object.keys(SEE_ALSO), `${u} is not in the table`).toContain(u);
    // once each
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("the row", () => {
  it("opens the function of a link through the register, and names itself for the screen reader", async () => {
    const open = vi.fn();
    vi.doMock("@/app/featureOpen", () => ({ openFeature: open }));
    render(<SeeAlso at="plan.exit" />);
    const nav = screen.getByRole("navigation", { name: /^Siehe auch: Verwaltung testen, Verwaltung vergleichen$/ });
    expect(nav).toHaveAttribute("data-at", "plan.exit");
    fireEvent.click(screen.getByRole("button", { name: /Verwaltung vergleichen/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("verwaltung-vergleich"));
    vi.doUnmock("@/app/featureOpen");
  });

  it("keeps the coach page's row ('Auch hier') working as before", () => {
    render(<FeatureLinks items={[{ id: "ueben", label: "Üben" }]} />);
    expect(screen.getByRole("navigation", { name: "Auch hier" })).toBeInTheDocument();
    expect(screen.getByText("Auch hier")).toBeInTheDocument();
  });
});
