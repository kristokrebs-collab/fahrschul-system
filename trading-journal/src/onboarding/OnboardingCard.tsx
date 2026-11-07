import { useState } from "react";
import { FeatureLinks } from "@/app/FeatureLinks";
import { KeyCombo } from "@/app/Kbd";
import { openShortcutSheet } from "@/app/shortcuts";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { readOnboarding, startOnboarding, useOnboarding, type StoredOnboarding } from "./onboardingStore";

export const ONBOARDING_CARD = {
  title: "Einführung & Hilfe",
  lead: "Die Tour durch Konten, Setups, Börse, die neueren Bereiche und dein erstes Ziel – jederzeit noch einmal.",
  news: { lead: "Neu in der App", label: "Neue Bereiche der App", items: [{ id: "handelsplan-einstieg", label: "Handelsplan" }, { id: "aktien-scanner", label: "Aktien" }, { id: "zeitmaschine", label: "Zeitmaschine" }, { id: "datenarchiv", label: "Datenarchiv" }] },
  start: "Einführung starten",
  keys: "Alle Tastenkürzel",
  demo: "Demo mit Beispieldaten",
  quick: [
    { keys: ["/"], label: "Suche" },
    { keys: ["n"], label: "Neuer Trade" },
    { keys: ["t"], label: "Hell / Dunkel" },
    { keys: ["g", "t"], label: "Zu den Trades" },
    { keys: ["g", "f"], label: "Alle Funktionen" },
    { keys: ["?"], label: "Alle Kürzel" },
  ],
  status: {
    done: (d: string) => `Abgeschlossen${d ? ` am ${d}` : ""}.`,
    skipped: "Übersprungen – du kannst sie jederzeit starten.",
    seen: "Noch nicht angesehen.",
    none: "Noch nicht angesehen.",
  },
} as const;

const fmtDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export function onboardingStatusText(s: StoredOnboarding | null): string {
  if (!s) return ONBOARDING_CARD.status.none;
  if (s.status === "done") return ONBOARDING_CARD.status.done(fmtDay(s.at));
  return ONBOARDING_CARD.status[s.status];
}

/** Settings card (P13, mounted by the integrator next to "Darstellung"): restart the tour, open the cheat sheet. */
export function OnboardingCard({ className }: { className?: string }) {
  // re-read the stored outcome whenever the tour closes
  const open = useOnboarding((s) => s.open);
  const [stored, setStored] = useState(readOnboarding);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setStored(readOnboarding());
  }
  return (
    <Card title={ONBOARDING_CARD.title} className={className}>
      <div className="grid gap-4">
        <p className="text-[13px] leading-relaxed text-mute">{ONBOARDING_CARD.lead}</p>
        <p className="text-[12px] text-mute" data-testid="onboarding-status">
          {onboardingStatusText(stored)}
        </p>
        <ul className="grid gap-1.5 border-t border-line pt-3" aria-label="Wichtige Tastenkürzel">
          {ONBOARDING_CARD.quick.map((q) => (
            <li key={q.label} className="flex items-center justify-between gap-3 text-[12.5px] text-mute">
              <span>{q.label}</span>
              <KeyCombo keys={q.keys} then={q.keys.length === 2} size="sm" />
            </li>
          ))}
        </ul>
        <FeatureLinks items={ONBOARDING_CARD.news.items} lead={ONBOARDING_CARD.news.lead} label={ONBOARDING_CARD.news.label} testId="onboarding-news" className="border-t border-line pt-3" />
        <div className="flex flex-wrap gap-2.5">
          <Button variant="primary" size="sm" onClick={() => startOnboarding()}>
            {ONBOARDING_CARD.start}
          </Button>
          <Button size="sm" onClick={() => openShortcutSheet()}>
            {ONBOARDING_CARD.keys}
          </Button>
          {/* F58: the demo's chunk is fetched on the click – nothing of it weighs on the first load */}
          <Button size="sm" onClick={() => void import("@/views/demo/demoStore").then((m) => m.openDemo())} data-testid="onboarding-demo">
            {ONBOARDING_CARD.demo}
          </Button>
        </div>
      </div>
    </Card>
  );
}
