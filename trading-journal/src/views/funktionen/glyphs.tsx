/**
 * One small symbol per function (24 × 24, stroke 1.8, `currentColor`): about two dozen drawings, each standing for a KIND of
 * work (a traffic light for the market state, a bell for alarms, a flask for the lab …). `glyphOf(id, group)` picks the drawing
 * of a register entry – by id, else by the symbol of its group – so a new function is never without one. Static SVG, decorative
 * (`aria-hidden`): the name next to it carries the meaning. Lives in the lazy chunk of the page, not in the first load.
 */
import type { SVGProps } from "react";
import type { FeatureGroupId } from "@/app/features";
import { Icon, type IconName } from "@/primitives/icons";

export type GlyphKind =
  | "ampel"
  | "plan"
  | "level"
  | "bell"
  | "candles"
  | "calc"
  | "dice"
  | "flask"
  | "link"
  | "replay"
  | "doc"
  | "speech"
  | "compare"
  | "calendar"
  | "tray-in"
  | "tray-out"
  | "camera"
  | "shield"
  | "check"
  | "users"
  | "book"
  | "cloud"
  | "mic"
  | "coin"
  | "grid"
  | "tag"
  | "sliders";

/** The ids of the register, by the kind of work they stand for. Anything not listed here shows the symbol of its group. */
const KINDS: Readonly<Record<GlyphKind, readonly string[]>> = {
  ampel: ["marktampel", "lage-einstellen", "bereit-check", "einstiegs-check", "warum-handeln"],
  plan: ["tagesplan", "handelsplan-einstieg", "handelsplan-ausstieg", "handelsplan-groesse", "handelsplan-risiko", "handelsplan-ticket", "coach-plan", "wochenexperiment", "verwaltung-planen"],
  level: ["schluesselmarken", "chart-level", "struktur", "box-einstellungen"],
  bell: ["alarme", "email-alarm", "daten-alarmqualitaet", "signal-posteingang"],
  candles: ["box-chart", "box-status", "beste-setups", "zeichnungen", "top-trader", "top-trader-netto", "top-trader-netto-karte", "scanner", "aktien-scanner", "aktien-watchlist", "squeeze-beobachtung", "aehnliche-situationen", "ausfuehrbarkeit-live", "bias-test", "branchen-trend", "aktien-kongress"],
  calc: ["positionsrechner", "dcf-rechner", "risiko-einstellungen", "disziplin-grenzen", "verlustlimits", "gesamtrisiko", "liquidation", "korrelation", "szenario-schock", "konten-kapital", "kaufthese", "zahlen-analyst"],
  dice: ["monte-carlo", "monte-carlo-faecher", "risk-of-ruin", "risiko-serien", "risiko-je-strategie", "zeitmaschine", "belastungstest"],
  flask: [
    "strategie-studio",
    "eigene-idee",
    "indikator-bausteine",
    "strategie-bibliothek",
    "positionsverwaltung",
    "idee-testen",
    "entwurf-versionen",
    "labor",
    "diagnose",
    "lauf-vergleich",
    "passt-zu-dir",
    "pruefbericht",
    "robustheit",
    "parameter-raster",
    "filtervergleich",
    "verwaltung-vergleich",
    "hintergrund-optimierer",
    "forward-test",
    "backtest-referenz",
    "muster-entdecker",
  ],
  link: ["tv-vergleich", "indikator-abgleich", "pine-export", "playbook-austausch", "tradingview-webhook", "boerse-sync", "boerse-auto-sync", "teilen", "empfehlung"],
  replay: ["replay", "was-waere-wenn", "ueben", "signal-beim-einstieg"],
  doc: ["berichte", "wochenreview", "monatsnutzen", "rueckblick", "transaktionsbuch", "export", "aktien-news", "einfuehrung"],
  speech: ["coach", "coach-fragen", "coach-heute", "assistent", "reviews", "erklaerungen"],
  compare: [
    "kennzahlen",
    "edge-score",
    "analyse-aufschluesselung",
    "analyse-kosten",
    "eigene-kennzahl",
    "benchmark",
    "analyse-vergleich",
    "analyse-herkunft",
    "analyse-verteilung",
    "rollierend",
    "analyse-serien",
    "mae-mfe",
    "drawdown-verlauf",
    "r-verteilung",
    "gewinner-verlierer",
    "signal-staerke",
    "zeit-session",
    "disziplin-auswertung",
    "erkenntnisse",
    "leaks-edges",
    "verhalten",
    "fehler-kosten",
    "signalbilanz",
    "signal-ausgang",
    "verpasste-chancen",
    "ereignisphasen",
    "rangliste",
    "stimmung-ergebnis",
    "wochenverlauf",
  ],
  calendar: ["pnl-kalender", "ereigniskalender", "morgenbriefing", "checkin", "checkin-auswertung"],
  "tray-in": ["trade-eintragen", "csv-import", "letzten-trade-duplizieren", "backup", "boersenhistorie-nachladen", "datenarchiv"],
  "tray-out": ["ergebnisbeleg", "chartfaelle"],
  camera: ["screenshot-ocr", "screenshot-import"],
  shield: ["grundregeln", "lokaler-modus", "datenstatus"],
  check: ["ziele", "challenges", "gewohnheiten", "serien-prozess", "skill-stufen", "bestleistungen", "emotionstagebuch", "muster-tracker", "fehler-tags"],
  users: ["gruppen", "mentor"],
  book: ["bibliothek", "tastenkuerzel", "produktdemo"],
  cloud: ["konto-cloud", "version-speicher"],
  mic: ["spracheingabe-notizen"],
  coin: ["abo", "tarif-vergleich"],
  grid: ["heatmap", "cockpit", "navigation", "mobile-oberflaeche"],
  tag: ["setup-zuordnen", "trade-filter"],
  sliders: ["trade-formular-anpassen", "einstiegs-check-einstellen", "darstellung", "hyblock"],
};

const BY_ID: ReadonlyMap<string, GlyphKind> = new Map((Object.entries(KINDS) as [GlyphKind, readonly string[]][]).flatMap(([kind, ids]) => ids.map((id) => [id, kind] as const)));

/** What a group shows when one of its functions has no symbol of its own. */
const BY_GROUP: Readonly<Record<FeatureGroupId, IconName>> = {
  heute: "target",
  pruefen: "candles",
  aktien: "stocks",
  planen: "route",
  risiko: "shield",
  testen: "flask",
  lernen: "coach",
  auswerten: "chart",
  wachsen: "sprout",
  daten: "list",
  community: "users",
  konto: "sliders",
};

export const glyphKindOf = (id: string): GlyphKind | undefined => BY_ID.get(id);
/** Every id with a drawing of its own (tests). */
export const GLYPH_IDS: readonly string[] = [...BY_ID.keys()];

const P: SVGProps<SVGSVGElement> = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

function Drawing({ kind, className }: { kind: GlyphKind; className?: string }) {
  switch (kind) {
    case "ampel":
      return (
        <svg {...P} className={className}>
          <rect x="8" y="3" width="8" height="18" rx="3" />
          <circle cx="12" cy="8" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="12" cy="16" r="1.2" />
        </svg>
      );
    case "plan":
      return (
        <svg {...P} className={className}>
          <path d="M6 21V4M6 5h11l-2.5 3.5L17 12H6" />
        </svg>
      );
    case "level":
      return (
        <svg {...P} className={className}>
          <path d="M3 12h9M16 12h5" />
          <path d="M12 8h5v8h-5l-2.2-4z" />
        </svg>
      );
    case "bell":
      return (
        <svg {...P} className={className}>
          <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 21h4" />
        </svg>
      );
    case "candles":
      return (
        <svg {...P} className={className}>
          <path d="M7 4v16M17 4v16" />
          <rect x="5" y="8" width="4" height="7" rx="1" />
          <rect x="15" y="6" width="4" height="9" rx="1" />
        </svg>
      );
    case "calc":
      return (
        <svg {...P} className={className}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2" />
        </svg>
      );
    case "dice":
      return (
        <svg {...P} className={className}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="9" cy="9" r="0.8" fill="currentColor" />
          <circle cx="12" cy="12" r="0.8" fill="currentColor" />
          <circle cx="15" cy="15" r="0.8" fill="currentColor" />
        </svg>
      );
    case "flask":
      return (
        <svg {...P} className={className}>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
        </svg>
      );
    case "link":
      return (
        <svg {...P} className={className}>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
      );
    case "replay":
      return (
        <svg {...P} className={className}>
          <path d="M4 5v5h5" />
          <path d="M5.4 15a7.5 7.5 0 1 0 1-7.8L4 10" />
        </svg>
      );
    case "doc":
      return (
        <svg {...P} className={className}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h5M10 16h5" />
        </svg>
      );
    case "speech":
      return (
        <svg {...P} className={className}>
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
      );
    case "compare":
      return (
        <svg {...P} className={className}>
          <path d="M6 20V10M12 20V4M18 20v-7" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...P} className={className}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 10h16M9 3v4M15 3v4" />
        </svg>
      );
    case "tray-in":
      return (
        <svg {...P} className={className}>
          <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
        </svg>
      );
    case "tray-out":
      return (
        <svg {...P} className={className}>
          <path d="M12 16V5M7 9l5-5 5 5M5 20h14" />
        </svg>
      );
    case "camera":
      return (
        <svg {...P} className={className}>
          <rect x="3" y="6" width="18" height="14" rx="2" />
          <circle cx="12" cy="13" r="3.5" />
          <path d="M9 6l1.5-2h3L15 6" />
        </svg>
      );
    case "shield":
      return (
        <svg {...P} className={className}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
      );
    case "check":
      return (
        <svg {...P} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        </svg>
      );
    case "users":
      return (
        <svg {...P} className={className}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M17 14c2.5 0 4 2 4 5" />
        </svg>
      );
    case "book":
      return (
        <svg {...P} className={className}>
          <path d="M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" />
          <path d="M5 16a4 4 0 0 1 4-4h9" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...P} className={className}>
          <path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6 1.4A3.3 3.3 0 0 1 17 18z" />
        </svg>
      );
    case "mic":
      return (
        <svg {...P} className={className}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      );
    case "coin":
      return (
        <svg {...P} className={className}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M9.5 9.5H13a1.8 1.8 0 0 1 0 3.6H9.5" />
        </svg>
      );
    case "grid":
      return (
        <svg {...P} className={className}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "tag":
      return (
        <svg {...P} className={className}>
          <path d="M3 12V4h8l10 10-8 8z" />
          <circle cx="7.5" cy="8.5" r="1" fill="currentColor" />
        </svg>
      );
    case "sliders":
      return <Icon name="sliders" className={className} />;
  }
}

/** The small symbol of a function, sized by its parent (`[&>svg]:size-4`). */
export function FunctionGlyph({ id, group, className }: { id: string; group: FeatureGroupId; className?: string }) {
  const kind = BY_ID.get(id);
  return kind ? <Drawing kind={kind} className={className} /> : <Icon name={BY_GROUP[group]} className={className} />;
}
