/**
 * Search index (P13): everything the global search can find, as plain data (pure – the side effects of opening an
 * item live in `actions.ts`). Built from the journal (trades, setups, day notes), the registered pages (whatever
 * `PAGES` holds – pages the integrator adds later appear by themselves), the settings sections, the report archive
 * (only once the `berichte` page exists) and the app commands.
 */
import type { FeatureEntry } from "@/app/features";
import { featureSearchId, groupOf, parseFeatureQuery, scoreFeature } from "@/app/featureQuery";
import { aggregate } from "@/domain/agg";
import { KIND_REPORT, reportArchive } from "@/domain/reports";
import type { DayNotes, EnrichedTrade, Settings } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { fmt, isFin } from "@/lib/format";
import { haystack, type FieldMatch, type Haystack } from "./fuzzy";

export type SearchKind = "best" | "recent" | "command" | "page" | "feature" | "trade" | "setup" | "day" | "setting" | "report";

export type CommandId =
  | "new-trade"
  | "theme-toggle"
  | "theme-light"
  | "theme-dark"
  | "theme-system"
  | "shortcuts"
  | "tour"
  | "intro"
  | "export-json"
  | "export-csv"
  | "new-setup"
  | "filter-top"
  | "filter-winners"
  | "filter-losers"
  | "filter-open"
  | "filter-reset"
  | "nav"
  | "fullscreen";

export type SearchAction =
  | { type: "page"; page: string }
  | { type: "feature"; id: string }
  | { type: "trade"; id: string }
  | { type: "setup"; id: string }
  | { type: "day"; key: string }
  | { type: "setting"; title: string }
  | { type: "report"; key: string }
  | { type: "command"; id: CommandId };

export type SearchTone = "win" | "loss" | "signal" | "mute";

export interface SearchItem {
  /** unique across the index (`trade:t_1`, `page:trades`, …) */
  id: string;
  kind: Exclude<SearchKind, "best" | "recent">;
  title: string;
  subtitle?: string;
  /** right column (P&L, R, count) */
  meta?: string;
  metaTone?: SearchTone;
  /** key hint for commands / pages (`n`, `g t`) */
  keys?: string;
  /** additive ranking boost (recency, strength) */
  boost: number;
  action: SearchAction;
  hay: Haystack;
  /** a scorer of its own (the function register: intents, typos, spoken questions); without it `hay` is scored */
  match?: (query: string) => FieldMatch | null;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  best: "Stärkste zuerst",
  recent: "Zuletzt geöffnet",
  command: "Befehle",
  page: "Seiten",
  feature: "Funktionen",
  trade: "Trades",
  setup: "Entscheidungsgrundlagen",
  day: "Tagesnotizen",
  setting: "Einstellungen",
  report: "Berichte",
};

/** Labels of pages the integrator may register later (fallback when `PAGE_LABELS` has no entry). */
export const FALLBACK_PAGE_LABELS: Record<string, string> = {
  overview: "Übersicht",
  trades: "Trades",
  setups: "Entscheidungsgrundlagen",
  settings: "Einstellungen",
  markt: "Markt",
  analyse: "Analyse",
  risiko: "Risiko",
  coach: "Coach",
  berichte: "Berichte",
  labor: "Labor",
  wachstum: "Wachstum",
  community: "Community",
  cockpit: "Cockpit",
  konto: "Konto",
  preise: "Preise",
  funktionen: "Funktionen",
  studio: "Strategie-Studio",
  plan: "Handelsplan",
  aktien: "Aktien",
};

const PAGE_WORDS: Record<string, string[]> = {
  overview: ["Start", "Dashboard", "Home", "Netto P&L", "Kontostand", "Einstiegs-Check", "Chart", "Kalender", "Auswertung"],
  trades: ["Alle Trades", "Liste", "Journal", "Historie", "Filter", "Tabelle"],
  setups: ["Setups", "Strategien", "Playbook", "Grundlagen", "Regeln"],
  settings: ["Optionen", "Konfiguration", "Backup", "Kapital", "Datenarchiv", "Einführung"],
  markt: ["Boxen", "Ausbruch", "Scanner", "Live-Markt", "Box-zu-Box", "Termine", "Squeeze", "Alarme"],
  analyse: ["Kennzahlen", "Sharpe", "Monte Carlo", "Statistik", "Heatmap"],
  risiko: ["Limits", "Positionsgröße", "Rechner", "Exposure", "Liquidation"],
  coach: ["KI", "Hinweise", "Fragen", "Tipps"],
  berichte: ["Report", "Wochenbericht", "Monatsbericht", "Export", "PDF", "Transaktionsbuch"],
  labor: ["Backtest", "Strategie testen", "Walk-Forward", "Forward-Test", "Playbook"],
  wachstum: ["Ziele", "Gewohnheiten", "Serien", "Psychologie", "Check-in"],
  community: ["Gruppen", "Rangliste", "Mentor", "Teilen"],
  cockpit: ["Widgets", "Eigenes Dashboard", "Anordnen"],
  konto: ["Anmelden", "Cloud", "Sync", "Abo", "Börse", "Sicherheit"],
  preise: ["Abo", "Pro", "Premium", "Tarife", "Upgrade"],
  funktionen: ["Alle Funktionen", "Übersicht der Funktionen", "Wo finde ich", "Was kann die App", "Index", "Hilfe", "Verzeichnis", "Demo"],
  studio: ["Strategie als Text", "Neue Strategie", "Strategie schreiben", "Regeln aus Text", "Strategien vergleichen", "Alle testen", "Papier-Konto"],
  plan: ["Handelsplan erstellen", "Trade planen", "Einstiegs-Timer", "Opening Range", "Ausstiegsplan", "Stop und Ziel", "Positionsgröße", "Risiko-Check", "Ticket", "Alarme aus dem Plan"],
  aktien: ["Aktien scannen", "Aktie", "Scanner", "Opening Range", "Flagge", "RSI überverkauft", "Watchlist", "Nachrichten", "News", "Kongress", "Analyst", "DCF", "Quartalszahlen"],
};

/** Settings sections: the card titles of the settings page (scroll target) + what they hold. */
export const SETTING_SECTIONS: readonly { title: string; words: string[] }[] = [
  { title: "Konten", words: ["Startkapital", "Kapital", "Makro", "Scalp", "Währung", "Paar", "Journal-Start"] },
  { title: "Backtest-Referenz", words: ["Win-Rate", "Erwartung", "Gewinner", "Verlierer", "Backtest"] },
  { title: "Chart-Level · manuell", words: ["Trigger", "Level", "Long-Trigger", "Short-Trigger", "Invalidierung", "Zone", "Lower High"] },
  { title: "Live-Daten", words: ["Feeds", "Binance", "Proxy", "Verbindung", "Cache", "Neu verbinden"] },
  { title: "Einstiegs-Check", words: ["Signal", "Timeframe", "RSI", "MCB", "Divergenz", "Support", "Widerstand", "Whale", "Gewicht"] },
  { title: "Lage-Ampel", words: ["Ampel", "Trend", "EMA", "Tageslage"] },
  { title: "Hyblock-Connector", words: ["Hyblock", "Long-%", "Delta", "Endpoint"] },
  { title: "Daten", words: ["Backup", "Export", "Import", "CSV", "JSON", "Wiederherstellen", "Intro"] },
  { title: "Fehler-Tags", words: ["Fehler", "Mistakes", "Tags", "FOMO"] },
  { title: "Grundregeln", words: ["Regeln", "Checkliste", "Disziplin"] },
  { title: "Disziplin-Grenzen", words: ["Limits", "Verlust pro Tag", "Max. Trades", "Grenzen"] },
  { title: "Version & Speicher", words: ["Speicher", "Version", "App installieren", "Vollbild"] },
  { title: "Darstellung", words: ["Theme", "Hell", "Dunkel", "System", "Light Mode", "Dark Mode", "Akzent", "Farbe"] },
];

interface CommandDef {
  id: CommandId;
  title: string;
  subtitle?: string;
  words: string[];
  keys?: string;
}

export const COMMANDS: readonly CommandDef[] = [
  { id: "new-trade", title: "Neuen Trade eintragen", words: ["Trade erfassen", "Eintrag", "neu", "hinzufügen", "plus"], keys: "n" },
  { id: "filter-top", title: "Top-Trades zeigen", subtitle: "Trades ab 2 R – die stärksten zuerst", words: ["beste", "2R", "Gewinner", "stark", "best"] },
  { id: "filter-winners", title: "Gewinner zeigen", words: ["Gewinn", "win", "positiv"] },
  { id: "filter-losers", title: "Verlierer zeigen", words: ["Verlust", "loss", "negativ"] },
  { id: "filter-open", title: "Offene Trades zeigen", words: ["offen", "laufend", "Position"] },
  { id: "filter-reset", title: "Trade-Filter zurücksetzen", words: ["Filter", "alle", "zurück"] },
  { id: "theme-toggle", title: "Hell / Dunkel umschalten", words: ["Theme", "Light", "Dark", "Modus", "Darstellung"], keys: "t" },
  { id: "theme-light", title: "Design: Hell", words: ["Light Mode", "hell", "weiß", "Theme"] },
  { id: "theme-dark", title: "Design: Dunkel", words: ["Dark Mode", "dunkel", "schwarz", "Theme"] },
  { id: "theme-system", title: "Design: wie das System", words: ["automatisch", "Gerät", "Theme"] },
  { id: "new-setup", title: "Neue Entscheidungsgrundlage", words: ["Setup anlegen", "Strategie", "Playbook"] },
  { id: "shortcuts", title: "Tastenkürzel anzeigen", words: ["Shortcuts", "Tastatur", "Hilfe", "Keys"], keys: "?" },
  { id: "tour", title: "Einführung starten", words: ["Tour", "Onboarding", "Hilfe", "erste Schritte"] },
  { id: "intro", title: "Intro abspielen", words: ["Animation", "Start"] },
  { id: "export-json", title: "Backup exportieren (JSON)", words: ["Sicherung", "Download", "Export"] },
  { id: "export-csv", title: "Trades als CSV exportieren", words: ["Excel", "Tabelle", "Download", "Export"] },
  { id: "nav", title: "Navigation öffnen", words: ["Menü", "Seiten", "Command"], keys: "⌘K" },
  { id: "fullscreen", title: "Vollbild umschalten", words: ["Fullscreen", "Präsentation"] },
];

export interface IndexInput {
  trades: readonly EnrichedTrade[];
  settings: Settings;
  days: DayNotes;
  /** registered pages (`PAGES`) */
  pages: readonly string[];
  labels?: Partial<Record<string, string>>;
  now: number;
  /** command filter (fullscreen support, …); default: all */
  commandAvailable?: (id: CommandId) => boolean;
  /** `g` + letter per page (`PAGE_KEYS`) */
  pageKeys?: Partial<Record<string, string>>;
  /** the function register (`src/app/features.ts`) – absent: no function items (the register is a lazy chunk) */
  features?: readonly FeatureEntry[];
}

const RESULT_WORD: Record<EnrichedTrade["result"], string> = { win: "Gewinn", loss: "Verlust", be: "Break-even", open: "Offen" };
const MONTH = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const WEEKDAY = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function pageLabel(page: string, labels?: Partial<Record<string, string>>): string {
  return labels?.[page] ?? FALLBACK_PAGE_LABELS[page] ?? page;
}

function tradeItems(trades: readonly EnrichedTrade[], settings: Settings, now: number): SearchItem[] {
  const names = new Map(settings.setups.map((s) => [s.id, s.name]));
  const cur = settings.currency;
  return trades.map((t) => {
    const d = tradeTime(t);
    const side = t.side === "short" ? "Short" : "Long";
    const setups = (t.setups ?? []).map((id) => names.get(id)).filter((x): x is string => !!x);
    const ageDays = Math.max(0, (now - d.getTime()) / 86_400_000);
    const open = t.result === "open";
    const r = t.r;
    const meta = open ? "offen" : `${fmt.signed(t.pnl, 0)} ${cur}`;
    const subtitle = [setups.join(" · ") || "ohne Grundlage", t.account === "makro" ? "Makro" : "Scalp", isFin(r) ? fmt.r(r) : null]
      .filter(Boolean)
      .join(" · ");
    const keywords = [
      setups.join(" "),
      t.pair,
      t.timeframe,
      RESULT_WORD[t.result],
      t.account === "makro" ? "Makro" : "Scalp",
      t.notes,
      t.reason,
      t.emotion,
      ...(t.mistakes ?? []),
      ...((t as { tags?: string[] }).tags ?? []),
      fmt.date(d),
      MONTH.format(d),
    ].filter((x): x is string => typeof x === "string" && x.length > 0);
    return {
      id: `trade:${t.id}`,
      kind: "trade",
      title: `${side} ${t.pair || "BTC"} · ${fmt.date(d)} ${fmt.time(d)}`.trim(),
      subtitle,
      meta,
      metaTone: open ? "mute" : (t.pnl ?? 0) > 0 ? "win" : (t.pnl ?? 0) < 0 ? "loss" : "mute",
      // newer first (≤ 6 points over ~a year), strong R a little higher (≤ 4)
      boost: Math.max(0, 6 - ageDays / 60) + Math.max(-2, Math.min(4, (r ?? 0) * 1.2)),
      action: { type: "trade", id: t.id },
      hay: haystack(`${side} ${t.pair ?? ""} ${fmt.date(d)}`, keywords),
    } satisfies SearchItem;
  });
}

export interface SetupStat {
  id: string;
  name: string;
  n: number;
  winRate: number | null;
  net: number;
  exp: number;
}

/** Per-setup results over the closed trades (strongest first by expectancy). */
export function setupStats(trades: readonly EnrichedTrade[], settings: Settings): SetupStat[] {
  const closed = trades.filter((t) => t.result !== "open");
  return settings.setups
    .map((s) => {
      const list = closed.filter((t) => (t.setups ?? []).includes(s.id));
      const a = aggregate(list);
      return { id: s.id, name: s.name, n: a.n, winRate: a.n ? a.winRate : null, net: a.net, exp: a.exp ?? 0 };
    })
    .sort((a, b) => b.exp - a.exp);
}

function setupItems(trades: readonly EnrichedTrade[], settings: Settings): SearchItem[] {
  const stats = new Map(setupStats(trades, settings).map((s) => [s.id, s]));
  return settings.setups.map((s) => {
    const st = stats.get(s.id);
    const n = st?.n ?? 0;
    return {
      id: `setup:${s.id}`,
      kind: "setup",
      title: s.name,
      subtitle: n ? `${n} Trades · ${fmt.pct0(st?.winRate ?? null)} Win-Rate` : "noch keine Trades",
      meta: n ? `${fmt.signed(st?.net ?? 0, 0)} ${settings.currency}` : undefined,
      metaTone: !n ? "mute" : (st?.net ?? 0) >= 0 ? "win" : "loss",
      boost: n ? ((st?.exp ?? 0) > 0 ? 2 : -1) + Math.min(3, n / 10) : 0,
      action: { type: "setup", id: s.id },
      hay: haystack(s.name, [s.desc ?? "", ...(s.checklist ?? []).map((c) => c.text), s.account === "makro" ? "Makro" : s.account === "scalp" ? "Scalp" : "Makro Scalp", "Setup Strategie"]),
    } satisfies SearchItem;
  });
}

function dayItems(days: DayNotes, now: number): SearchItem[] {
  return Object.entries(days)
    .filter(([key, d]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && d && (d.note || d.plan || d.review))
    .map(([key, d]) => {
      const date = new Date(`${key}T12:00`);
      const text = [d.note, d.plan, d.review].filter(Boolean).join(" · ");
      const age = Math.max(0, (now - date.getTime()) / 86_400_000);
      return {
        id: `day:${key}`,
        kind: "day",
        title: `Tagesnotiz · ${WEEKDAY.format(date)} ${fmt.date(date)}`,
        subtitle: clip(text.replace(/\s+/g, " "), 90),
        boost: Math.max(0, 4 - age / 30),
        action: { type: "day", key },
        hay: haystack(`Tagesnotiz ${fmt.date(date)}`, [d.note ?? "", d.plan ?? "", d.review ?? "", MONTH.format(date), "Notiz Tagebuch Plan Review"]),
      } satisfies SearchItem;
    });
}

function pageItems(pages: readonly string[], labels: IndexInput["labels"], keys: IndexInput["pageKeys"]): SearchItem[] {
  return pages.map((p, i) => {
    const title = pageLabel(p, labels);
    const k = keys?.[p];
    return {
      id: `page:${p}`,
      kind: "page",
      title,
      subtitle: "Seite",
      keys: k ? `g ${k}` : undefined,
      boost: 3 - i * 0.1,
      action: { type: "page", page: p },
      hay: haystack(title, [p, ...(PAGE_WORDS[p] ?? [])]),
    } satisfies SearchItem;
  });
}

/** The register's functions (deep links): "Kosten- und Belastungstest · Strategie entwickeln & testen · Labor". Register order = tie order. */
function featureItems(features: readonly FeatureEntry[], labels: IndexInput["labels"]): SearchItem[] {
  return features.map((f, i) => {
    const page = pageLabel(f.page, labels);
    return {
      id: featureSearchId(f.id),
      kind: "feature",
      title: f.name,
      subtitle: `${f.task ?? groupOf(f).name} · ${f.place ? `${page} › ${f.place}` : page}`,
      meta: f.status === "teilweise" ? "teilweise" : undefined,
      metaTone: f.status === "teilweise" ? "mute" : undefined,
      boost: 2 - i * 0.01,
      action: { type: "feature", id: f.id },
      hay: haystack(f.name, [...f.keywords, ...(f.intents ?? []), f.task ?? "", f.benefit, groupOf(f).name, page]),
      match: (query) => scoreFeature(f, parseFeatureQuery(query)),
    } satisfies SearchItem;
  });
}

function settingItems(): SearchItem[] {
  return SETTING_SECTIONS.map((s) => ({
    id: `setting:${s.title}`,
    kind: "setting",
    title: s.title,
    subtitle: "Einstellungen",
    boost: 0,
    action: { type: "setting", title: s.title },
    hay: haystack(s.title, [...s.words, "Einstellung"]),
  }));
}

function reportItems(trades: readonly EnrichedTrade[], settings: Settings, now: number): SearchItem[] {
  const out: SearchItem[] = [];
  for (const kind of ["week", "month", "quarter"] as const) {
    for (const e of reportArchive(trades, settings, kind, now, 6)) {
      out.push({
        id: `report:${e.period.key}`,
        kind: "report",
        title: `${KIND_REPORT[kind]} ${e.period.label}`,
        subtitle: `${e.period.range} · ${e.n} Trades`,
        meta: `${fmt.signed(e.net, 0)} ${settings.currency}`,
        metaTone: e.net >= 0 ? "win" : "loss",
        boost: kind === "week" ? 1 : 0.5,
        action: { type: "report", key: e.period.key },
        hay: haystack(`${KIND_REPORT[kind]} ${e.period.label}`, [e.period.short, e.period.range, "Bericht Report"]),
      });
    }
  }
  return out;
}

function commandItems(available: IndexInput["commandAvailable"]): SearchItem[] {
  return COMMANDS.filter((c) => !available || available(c.id)).map((c, i) => ({
    id: `command:${c.id}`,
    kind: "command",
    title: c.title,
    subtitle: c.subtitle ?? "Befehl",
    keys: c.keys,
    boost: 2 - i * 0.05,
    action: { type: "command", id: c.id },
    hay: haystack(c.title, c.words),
  }));
}

/** The whole index. Pure: same input → same items. */
export function buildSearchIndex(input: IndexInput): SearchItem[] {
  const { trades, settings, days, pages, labels, now, commandAvailable, pageKeys, features } = input;
  return [
    ...commandItems(commandAvailable),
    ...pageItems(pages, labels, pageKeys),
    ...(features ? featureItems(features, labels) : []),
    ...tradeItems(trades, settings, now),
    ...setupItems(trades, settings),
    ...dayItems(days, now),
    ...settingItems(),
    ...(pages.includes("berichte") ? reportItems(trades, settings, now) : []),
  ];
}
