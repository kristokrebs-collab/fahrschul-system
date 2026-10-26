/**
 * The "Inhalt" strip of the settings page: one chip per card (found by its heading – the cards carry no section names of their
 * own). The settings page is part of the first load, the strip is not: it comes as its own chunk and keeps its room free
 * meanwhile (`SECTION_NAV_BOX`).
 */
import { lazy, Suspense } from "react";
import type { SectionNavItem } from "@/primitives/SectionNav";
import { SECTION_NAV_BOX } from "@/primitives/sectionNavBox";

const SectionNav = lazy(() => import("@/primitives/SectionNav").then((m) => ({ default: m.SectionNav })));

const NAV: readonly SectionNavItem[] = [
  { id: "s-konten", label: "Konten", heading: "Konten" },
  { id: "s-backtest", label: "Backtest", heading: "Backtest-Referenz" },
  { id: "s-level", label: "Chart-Level", heading: "Chart-Level" },
  { id: "s-live", label: "Live-Daten", heading: "Live-Daten" },
  { id: "s-signal", label: "Einstiegs-Check", heading: "Einstiegs-Check" },
  { id: "s-lage", label: "Lage-Ampel", heading: "Lage-Ampel" },
  { id: "s-hyblock", label: "Hyblock", heading: "Hyblock-Connector" },
  { id: "s-daten", label: "Daten", heading: "Daten" },
  { id: "s-fehler", label: "Fehler-Tags", heading: "Fehler-Tags" },
  { id: "s-regeln", label: "Grundregeln", heading: "Grundregeln" },
  { id: "s-grenzen", label: "Grenzen", heading: "Disziplin-Grenzen" },
  { id: "s-darstellung", label: "Darstellung", heading: "Darstellung" },
  { id: "s-hilfe", label: "Einführung", heading: "Einführung & Hilfe" },
  { id: "s-archiv", label: "Archiv", heading: "Datenarchiv" },
  { id: "s-mehr", label: "Mehr", heading: "Weitere Einstellungen" },
  { id: "s-version", label: "Version", heading: "Version & Speicher" },
];

export function SettingsNav() {
  return (
    <Suspense fallback={<div aria-hidden="true" className={SECTION_NAV_BOX} />}>
      <SectionNav items={NAV} />
    </Suspense>
  );
}
