/**
 * The "Inhalt" strip of the settings page: one chip per group of cards (`SettingsGroup`, found by `data-section`). The settings page is part of the first load, the strip is not: it comes as its own chunk and keeps its room free
 * meanwhile (`SECTION_NAV_BOX`).
 */
import { lazy, Suspense } from "react";
import type { SectionNavItem } from "@/primitives/SectionNav";
import { SECTION_NAV_BOX } from "@/primitives/sectionNavBox";

const SectionNav = lazy(() => import("@/primitives/SectionNav").then((m) => ({ default: m.SectionNav })));

const NAV: readonly SectionNavItem[] = [
  { id: "s-grundlagen", label: "Grundlagen" },
  { id: "s-maerkte", label: "Märkte und Signale" },
  { id: "s-regeln-gruppe", label: "Regeln" },
  { id: "s-sichern", label: "Sichern" },
  { id: "s-aussehen", label: "Aussehen und Hilfe" },
];

export function SettingsNav() {
  return (
    <Suspense fallback={<div aria-hidden="true" className={SECTION_NAV_BOX} />}>
      <SectionNav items={NAV} />
    </Suspense>
  );
}
