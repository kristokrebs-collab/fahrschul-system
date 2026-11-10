/**
 * The "Inhalt" strip of the settings page: one chip per group of cards (`SettingsGroup`, found by `data-section`). The settings page is part of the first load, the strip is not: it comes as its own chunk and keeps its room free
 * meanwhile (`SECTION_NAV_BOX`).
 */
import { lazy, Suspense } from "react";
import { SETTINGS_SECTIONS } from "@/app/navGroups";
import type { SectionNavItem } from "@/primitives/SectionNav";
import { SECTION_NAV_BOX } from "@/primitives/sectionNavBox";

const SectionNav = lazy(() => import("@/primitives/SectionNav").then((m) => ({ default: m.SectionNav })));

const NAV: readonly SectionNavItem[] = SETTINGS_SECTIONS;

export function SettingsNav() {
  return (
    <Suspense fallback={<div aria-hidden="true" className={SECTION_NAV_BOX} />}>
      <SectionNav items={NAV} />
    </Suspense>
  );
}
