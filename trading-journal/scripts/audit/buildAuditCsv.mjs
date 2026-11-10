#!/usr/bin/env node
/**
 * Merges the JSON files of the interaction audit crawl (`tests/audit/interactionAudit.spec.ts`) into
 * `docs/audit/INTERACTION_AUDIT.csv` (one row per route × element, the viewports and personas folded into the columns) and
 * `docs/audit/evidence/summary.json` (counts for STATUS.md).
 *
 *   node scripts/audit/buildAuditCsv.mjs <crawl-output-dir> [--out docs/audit]
 *
 * Columns (as the order asked for): Route | Element/Button | Erwartung | aktueller Handler | tatsächliches Network-/Backend-Ergebnis |
 * Fehler/Empty States | Mobil/Keyboard | Priorität | Dateipfad | Nachweis.
 *
 * Honest limits, repeated in the CSV's last lines: "Erwartung" is derived from role / label / href (heuristic, a human reads
 * the P0/P1 rows); "Handler" is what the page's React props and the DOM show (a native listener or a Radix trigger has no
 * React `onClick` – the click result is the proof, not this column); "Netz" is the browser's side against MOCKS (Supabase,
 * billing, social, exchange of `tests/e2e/mocks`) except for the persona `preview`, which talks to the real hosted preview.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const crawlDir = process.argv[2];
if (!crawlDir) {
  console.error("usage: node scripts/audit/buildAuditCsv.mjs <crawl-output-dir> [--out docs/audit]");
  process.exit(2);
}
const outIdx = process.argv.indexOf("--out");
const outDir = outIdx > 0 ? process.argv[outIdx + 1] : "docs/audit";
const SRC = "src";

const PAGE_LABELS = {
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
const PERSONA_SHORT = { preview: "PV", local: "LO", "local-first": "LF", "cloud-out": "CO", "cloud-in": "CI" };
const PERSONA_DOC = {
  PV: "PV = gehostete Vorschau (nichts gemockt, Erstbesucher)",
  LO: "LO = lokaler Default-Build mit Fixture-Journal + Markt-Mock",
  LF: "LF = lokaler Default-Build, leeres Journal, Einführung erlaubt",
  CO: "CO = Cloud-Build gegen Supabase-Mock, abgemeldet",
  CI: "CI = Cloud-Build gegen Supabase-/Billing-/Social-/Börsen-Mock, angemeldet",
};

/** ------------------------------------------------------------------------------ source index (for the Dateipfad column) */
function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|css)$/.test(f) && !f.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}
const files = existsSync(SRC) ? walk(SRC).map((p) => ({ p, c: readFileSync(p, "utf8") })) : [];
const PRIORITY_DIRS = ["src/views", "src/billing", "src/cloud", "src/app", "src/overlays", "src/onboarding", "src/legal", "src/search", "src/journal"];
const rank = (p) => {
  const i = PRIORITY_DIRS.findIndex((d) => p.startsWith(d));
  return i < 0 ? 99 : i;
};
const cache = new Map();
function locate(needle) {
  if (!needle || needle.length < 3) return [];
  if (cache.has(needle)) return cache.get(needle);
  const hits = files.filter((f) => f.c.includes(needle)).map((f) => f.p);
  hits.sort((a, b) => rank(a) - rank(b) || a.length - b.length);
  const r = hits.slice(0, 2);
  cache.set(needle, r);
  return r;
}
function sourceOf(d) {
  if (d.testid) {
    const t = locate(`"${d.testid.replace(/\d+$/, "")}`).filter((p) => p.endsWith(".tsx"));
    const exact = locate(`"${d.testid}"`);
    if (exact.length) return exact;
    if (t.length) return t;
  }
  const raw = d.name.replace(/\s+/g, " ").trim();
  const cands = [raw, raw.split(/[:–—]/)[0].trim(), raw.split(" ").slice(0, 3).join(" ")].filter((x) => x && x.length >= 4 && !/^[\d\s.,+\-−–%€$]+$/.test(x));
  for (const c of cands) {
    const r = locate(`>${c}`).concat(locate(`"${c}"`)).concat(locate(`${c}</`));
    const uniq = [...new Set(r)].filter((p) => p.endsWith(".tsx") || p.endsWith(".ts"));
    uniq.sort((a, b) => rank(a) - rank(b));
    if (uniq.length) return uniq.slice(0, 2);
  }
  if (d.href.startsWith("#")) return locate(`"${d.href.slice(1)}"`).slice(0, 1);
  return [];
}

/**
 * Console lines and requests are sorted before they count: `app` (the product's own doing) vs `extern` (the sandbox cannot reach
 * Binance / Bybit / OKX, the hosted preview's Netlify drawer is framed against the CSP) vs `harness` (the test world: an external
 * host is blocked on purpose, a function nobody mocked answers 404). Only `app` lines make a priority; the others are counted.
 */
const classifyLog = (persona, text) => {
  if (/fapi\.binance\.com|data-api\.binance|api\.bybit\.com|okx\.com|fstream\.binance|stream\.bybit|status of 451|app\.netlify\.com|Unavailable For Legal/.test(text)) return "extern";
  if (persona === "preview" && /ERR_FAILED|ERR_BLOCKED/.test(text)) return "extern";
  if (persona !== "preview" && /ERR_INTERNET_DISCONNECTED|status of 404/.test(text)) return "harness";
  return "app";
};
const classifyNet = (persona, line) => {
  if (/HTML-Fallback/.test(line)) return "harness";
  if (/ERR_INTERNET_DISCONNECTED/.test(line)) return "harness";
  if (persona !== "preview" && /\/api\/v1\/.* → 404/.test(line)) return "harness";
  if (/\/api\/binance\/.* → 451/.test(line)) return "extern";
  return "app";
};
const personaOf = (tag) => Object.entries(PERSONA_SHORT).find(([, v]) => tag.startsWith(`${v}@`))?.[0] ?? "";

/** ------------------------------------------------------------------------------ load */
const loaded = readdirSync(crawlDir)
  .filter((f) => /^[a-z-]+__\d+(\.[a-z0-9-]+)?\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(crawlDir, f), "utf8")));
// a partial re-run (`PW_AUDIT_TAG`) replaces the same screens of the full run of its persona and viewport
const units = loaded.filter((u) => !u.recheck);
for (const re of loaded.filter((u) => u.recheck)) {
  const base = units.find((u) => u.persona === re.persona && u.viewport === re.viewport);
  if (!base) {
    units.push({ ...re, recheck: false });
    continue;
  }
  for (const r of re.reports) {
    const i = base.reports.findIndex((x) => x.screen === r.screen);
    if (i >= 0) base.reports[i] = r;
    else base.reports.push(r);
  }
  base.allLogs = [...base.allLogs, ...re.allLogs];
}

const SHELL_ROUTE = "Shell (Header, Seitenleiste, Dock: auf jeder Seite)";
const routeOf = (r, region) => {
  if (r.screen.startsWith("overlay-")) return `Overlay ${r.screen.slice(8)}`;
  if (region === "shell") return SHELL_ROUTE;
  return `#${r.screen}`;
};

const CORE_ROUTES = new Set(["#overview", "#preise", "#konto", SHELL_ROUTE, "Overlay auth-login", "Overlay auth-signup", "Overlay menu", "Overlay trade-editor", "Overlay suche"]);
const CORE_NAME = /anmelden|registrieren|konto erstellen|kostenlos|premium|pro wählen|weiter zur|zahlung|bestell|passwort|trade eintragen|menü|mehr|preise|konto|abo|verbinden|suche/i;

const rows = new Map();
const pageRows = [];
const evidence = { units: [], logs: [], failedRequests: [] };

for (const u of units) {
  const tag = `${PERSONA_SHORT[u.persona] ?? u.persona}@${u.viewport}`;
  evidence.units.push({ tag, base: u.base, screens: u.reports.length, at: u.at });
  for (const r of u.reports) {
    // page-level row
    pageRows.push({ tag, r });
    for (const l of r.logs) evidence.logs.push({ tag, screen: r.screen, cls: classifyLog(u.persona, l.text), ...l });
    for (const n of r.net) if (!n.external) evidence.failedRequests.push({ tag, screen: r.screen, ...n });
    for (const e of r.elements) {
      const d = e.desc;
      const route = routeOf(r, d.region);
      const key = `${route}|${d.region}|${d.key}|${d.n}`;
      let row = rows.get(key);
      if (!row) {
        row = { route, d, obs: [], represents: e.represents ?? 1 };
        rows.set(key, row);
      }
      row.obs.push({ tag, vp: u.viewport, persona: u.persona, e, screen: r.screen });
    }
  }
}

/** ------------------------------------------------------------------------------ derive columns */
const hostOf = (h) => {
  try {
    return new URL(h).host;
  } catch {
    return "";
  }
};

function expectation(d) {
  const n = d.name || d.testid || d.tag;
  if (d.tag === "a" && /^#[a-z]/.test(d.href)) {
    const target = d.href.slice(1).split("?")[0];
    return PAGE_LABELS[target] ? `Wechselt zur Seite „${PAGE_LABELS[target]}“ (Hash-Route ${d.href})` : `Springt zum Hash-Ziel ${d.href} (Seite oder Anker; Ziel geprüft: ${PAGE_LABELS[target] ? "ja" : "nein"})`;
  }
  if (d.tag === "a" && /^\?rechtliches=/.test(d.href)) return `Öffnet den Rechtstext „${d.href.split("=")[1]}“ im App-Dialog`;
  if (d.tag === "a" && /^https?:/.test(d.href)) return `Öffnet ${hostOf(d.href)} ${d.target === "_blank" ? "in neuem Tab" : "im selben Tab"} (externes Ziel)`;
  if (d.tag === "a" && d.href) return `Navigiert zu ${d.href}`;
  if (d.tag === "input" && d.type === "checkbox") return "Schaltet das Kästchen um und übernimmt den Wert";
  if (d.tag === "input" || d.tag === "textarea") return "Nimmt Eingaben an, validiert sie und zeigt Treffer/Fehler am Feld";
  if (d.tag === "select") return "Wechselt die Auswahl und aktualisiert die Ansicht";
  if (d.role === "tab") return "Wechselt den Reiter, Inhalt darunter wechselt";
  if (d.role === "radio") return "Wählt die Option im Segment (Inhalt/Filter wechselt)";
  if (d.role === "switch") return "Schaltet die Einstellung um (Zustand sichtbar)";
  if (/schließen|^×$|^x$|abbrechen/i.test(d.name)) return "Schließt den Dialog, Fokus geht zum Auslöser zurück";
  if (/trade eintragen|ersten trade/i.test(d.name)) return "Öffnet das Trade-Formular (Goldstandard, unverändert)";
  if (/anmelden|registrieren|konto erstellen/i.test(d.name)) return "Öffnet bzw. sendet das Anmelde-/Registrier-Formular";
  if (/menü|mehr/i.test(d.name) && d.region !== "main") return "Öffnet die Navigation (vier Gruppen, Suche)";
  if (/assistent/i.test(d.name)) return "Öffnet den Assistenten";
  if (/details|mehr anzeigen|zeigen|öffnen/i.test(d.name)) return "Klappt die Details auf oder öffnet die Detailansicht";
  if (d.tag === "summary") return "Klappt den Abschnitt auf/zu";
  return `Löst die beschriftete Aktion aus („${n.slice(0, 40)}“) und zeigt das Ergebnis`;
}

function handlerOf(d) {
  const bits = [];
  if (d.tag === "a") bits.push(`<a href="${d.href.slice(0, 60)}">`);
  if (d.props.length) bits.push(`React ${d.props.filter((p) => /^on(Click|PointerDown|PointerUp|KeyDown|Change|Input|Submit)$/.test(p)).join("/") || d.props.slice(0, 3).join("/")}`);
  if (d.formSubmit) bits.push("Formular onSubmit");
  if (!bits.length) bits.push(d.tag === "button" || d.role === "button" ? "kein React-onClick im Prop-Objekt (natives/Radix-/Motion-Listener möglich; Klickergebnis entscheidet)" : "natives Element ohne React-Prop");
  if (d.tag === "a" && (d.href === "#" || d.href === "" || /^javascript:/i.test(d.href))) bits.push("LINK OHNE ZIEL");
  return bits.join("; ");
}

const short = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const uniq = (a) => [...new Set(a)];


function coreRoute(row) {
  return CORE_ROUTES.has(row.route) || CORE_NAME.test(row.d.name);
}

function build(row) {
  const d = row.d;
  // An external link that opens a new tab is judged by its target, not by a reaction inside the page (the crawl never follows it; older
  // crawl runs counted the new tab too late and called such a link "dead").
  if (d.tag === "a" && /^https?:/.test(d.href) && d.target === "_blank") {
    for (const o of row.obs)
      if (o.e.probe && ["dead-candidate", "no-effect-handler"].includes(o.e.probe.status)) o.e.probe = { ...o.e.probe, status: "ok", reasons: ["neuer-tab-extern (nicht gefolgt)"], detail: `öffnet ${hostOf(d.href)} in neuem Tab` };
  }
  const probes = row.obs.filter((o) => o.e.probe);
  const statuses = probes.map((o) => o.e.probe.status);
  const reactions = uniq(probes.flatMap((o) => o.e.probe.reasons));
  const netAll = probes.flatMap((o) => o.e.probe.net.map((line) => ({ line, cls: classifyNet(o.persona, line) })));
  const net = uniq(netAll.map((x) => (x.cls === "app" ? x.line : `${x.line} [${x.cls === "harness" ? "Testwelt: nicht gemockt/geblockt" : "extern/Sandbox"}]`))).slice(0, 4);
  const netApp = netAll.filter((x) => x.cls === "app").map((x) => x.line);
  const logsAll = probes.flatMap((o) => o.e.probe.logs.map((text) => ({ text, cls: classifyLog(o.persona, text) })));
  const logs = uniq(logsAll.filter((l) => l.cls === "app").map((l) => l.text)).slice(0, 3);
  const details = uniq(probes.map((o) => o.e.probe.detail).filter(Boolean)).slice(0, 2);
  const bad = probes.filter((o) => ["dead-candidate", "no-effect-handler", "input-dead", "covered", "click-error"].includes(o.e.probe.status));
  const gone = probes.filter((o) => o.e.probe.status === "gone");
  const notClicked = row.obs.filter((o) => !o.e.probe || o.e.probe.status === "not-clicked");
  const linkNoTarget = d.tag === "a" && (d.href === "#" || d.href === "" || /^javascript:/i.test(d.href));
  // `rel="noreferrer"` implies noopener in every current browser (HTML spec), so it counts
  const blankNoRel = d.target === "_blank" && !/noopener|noreferrer/.test(d.rel);
  const unknownHash = d.tag === "a" && /^#[a-z]/.test(d.href) && !PAGE_LABELS[d.href.slice(1).split("?")[0]] && !/^#share\//.test(d.href);
  const noName = !d.name && !d.testid;
  // inline text links are exempt from the minimum target size (WCAG 2.2, 2.5.8 "inline" exception); buttons and fields are not
  const small390 = row.obs.find((o) => o.vp === 390 && Math.min(o.e.desc.rect.w, o.e.desc.rect.h) < 24 && ["button", "input", "select"].includes(d.tag));
  // roving-tabindex groups (segments, tabs, calendar grids: one Tab stop, arrow keys inside) are fine; a lone button with tabindex -1 is not
  const notFocusable = d.tag !== "a" && !d.focusable && !["radio", "tab", "option", "menuitem", "menuitemradio", "combobox", "gridcell"].includes(d.role) && d.type !== "radio" && row.represents <= 1 && !/^\d+\. /.test(d.name) && !/^(Mo|Di|Mi|Do|Fr|Sa|So)\b/.test(d.name);
  const popup = probes.map((o) => o.e.probe.popup).find(Boolean);
  const onlyDom = probes.length > 0 && probes.every((o) => o.e.probe.reasons.length > 0 && o.e.probe.reasons.every((r) => ["dom"].includes(r)));

  // ---- priority
  let prio = "–";
  const reasonsP = [];
  const core = coreRoute(row);
  if (linkNoTarget) {
    prio = core ? "P0" : "P1";
    reasonsP.push("Link ohne Ziel (#/leer)");
  }
  if (bad.some((o) => o.e.probe.status === "dead-candidate" || o.e.probe.status === "input-dead")) {
    prio = core ? "P0" : "P1";
    reasonsP.push("kein beobachtbarer Effekt nach Klick und kein Handler (zweimal geprüft)");
  }
  if (prio === "–" && probes.some((o) => o.e.probe.status === "no-effect-handler")) {
    prio = core ? "P1" : "P2";
    reasonsP.push("Handler vorhanden, aber kein sichtbarer Effekt (zweimal geprüft): manuell bewerten");
  }
  if (bad.some((o) => o.e.probe.status === "covered" || o.e.probe.status === "click-error")) {
    if (prio === "–") prio = core ? "P1" : "P2";
    reasonsP.push("Klick scheitert: verdeckt/instabil");
  }
  if (logs.some((l) => l.startsWith("console-error") || l.startsWith("pageerror"))) {
    if (prio === "–" || prio === "P2") prio = core ? "P0" : "P1";
    reasonsP.push("Konsolenfehler beim Klick");
  }
  if (netApp.some((x) => /→ (4|5)\d\d/.test(x))) {
    if (prio === "–" || prio === "P2") prio = core ? "P1" : "P1";
    reasonsP.push("Request antwortet mit Fehlerstatus");
  }
  if (unknownHash) {
    if (prio === "–") prio = "P1";
    reasonsP.push("Hash-Ziel unbekannt");
  }
  if (blankNoRel && prio === "–") {
    prio = "P2";
    reasonsP.push("target=_blank ohne rel=noopener");
  }
  void noName; // accessible names are judged by `tests/audit/names.spec.ts` (full rule set), not by the crawl's own label reader
  if (small390 && prio === "–") {
    prio = "P2";
    reasonsP.push("Ziel < 24 px auf 390 px");
  }
  if (notFocusable && prio === "–" && !d.disabled) {
    prio = "P2";
    reasonsP.push("per Tab nicht erreichbar (tabindex<0)");
  }
  if (gone.length && !probes.some((o) => o.e.probe.status === "ok") && prio === "–") reasonsP.push("nach Zustandswechsel nicht erneut auffindbar (Crawl-Grenze)");

  // ---- columns
  const mobileBits = [];
  for (const o of row.obs) {
    const st = o.e.probe ? o.e.probe.status : o.e.skipReason ? "erfasst" : "?";
    const sz = `${o.e.desc.rect.w}×${o.e.desc.rect.h}`;
    mobileBits.push(`${o.tag}: ${st}${o.vp === 390 ? ` (${sz})` : ""}`);
  }
  const hit390 = row.obs.find((o) => o.vp === 390);
  const kb = [
    d.tag === "button" || d.tag === "a" || d.tag === "input" || d.tag === "select" || d.tag === "summary" ? "natives Element (Enter/Leertaste)" : `role=${d.role || "?"}`,
    d.focusable ? "Tab: ja" : d.role === "radio" || d.role === "tab" ? "Tab: Gruppe (roving)" : "Tab: nein",
    d.hiddenFromAt ? "aria-hidden-Vorfahr" : "",
  ]
    .filter(Boolean)
    .join(", ");

  const reactionText = probes.length
    ? uniq(probes.map((o) => o.e.probe.status)).join("/") + (reactions.length ? ` [${reactions.join(",")}]` : "") + (popup ? ` → Tab ${short(popup, 60)}` : "")
    : "nicht geklickt";
  const netText = net.length ? net.join(" | ") : probes.length ? "kein Request (lokaler Zustand)" : "–";
  const errText = [...logs, ...uniq(bad.map((o) => short(o.e.probe.detail ?? o.e.probe.status, 220))), ...(notClicked.length && !probes.length ? [uniq(notClicked.map((o) => o.e.skipReason).filter(Boolean)).join("; ")] : []), ...details.filter((x) => !bad.some((o) => o.e.probe.detail === x))].filter(Boolean).slice(0, 4).join(" || ") || "–";
  void onlyDom;
  const src = sourceOf(d);
  const shotEv = row.obs.find((o) => o.e.probe)?.screen ?? row.obs[0]?.screen;
  const shotTag = row.obs.find((o) => o.e.probe)?.persona ?? row.obs[0]?.persona;
  return {
    Route: row.route,
    "Element/Button": `${d.role || d.tag} „${short(d.name || "(ohne Name)", 70)}“ [${d.where}${d.testid ? `; ${d.testid}` : ""}${row.represents > 1 ? `; steht für ${row.represents + 1} gleichartige` : ""}]`,
    Erwartung: expectation(d),
    "aktueller Handler": handlerOf(d),
    "tatsächliches Network-/Backend-Ergebnis": `${reactionText}; ${netText}`,
    "Fehler/Empty States": errText,
    "Mobil/Keyboard": `${mobileBits.slice(0, 5).join(" · ")}${mobileBits.length > 5 ? ` · +${mobileBits.length - 5}` : ""}; ${hit390 ? `Ziel 390 px: ${hit390.e.desc.rect.w}×${hit390.e.desc.rect.h}` : "kein 390-px-Lauf"}; ${kb}`,
    Priorität: prio,
    Dateipfad: src.join(" , ") || "nicht zuordenbar (Label dynamisch)",
    Nachweis: `${row.obs.map((o) => o.tag).slice(0, 4).join(",")}; Bild ${shotTag}/…/${shotEv}.jpg; ${reasonsP.join(", ") || "ok"}`,
    _p: prio,
    _core: core,
  };
}

/**
 * Manual verdicts (`scripts/audit/annotations.json`): a human looked at a row the crawl could not judge (a handler that shows nothing, a
 * click that fails only under the crawl) and read the code or clicked it by hand. A verdict sets the priority (a repaired defect keeps
 * its original class, marked "repariert") and adds the reason to "Nachweis". `route` matches the start of the route, `element` is a
 * substring of the element column, `persona` (optional) limits it to one persona tag (e.g. `PV` = the hosted preview).
 */
const annotations = existsSync(join("scripts", "audit", "annotations.json")) ? JSON.parse(readFileSync(join("scripts", "audit", "annotations.json"), "utf8")) : [];
function annotate(row, r) {
  for (const a of annotations) {
    if (a.route && !r.Route.startsWith(a.route)) continue;
    if (a.element && !r["Element/Button"].includes(a.element)) continue;
    r.Priorität = a.prio === "–" ? "–" : `${a.prio}${a.repariert ? " (repariert)" : ""}`;
    r._p = a.prio;
    r.Nachweis = `${r.Nachweis}; MANUELL: ${a.note}`;
    return;
  }
}
const out = [...rows.values()].map((row) => {
  const r = build(row);
  annotate(row, r);
  return r;
});

/** ------------------------------------------------------------------------------ page rows */
const pageCsv = [];
const pageBy = new Map();
for (const { tag, r } of pageRows) {
  const route = r.screen.startsWith("overlay-") ? `Overlay ${r.screen.slice(8)}` : `#${r.screen}`;
  const row = pageBy.get(route) ?? { route, obs: [] };
  row.obs.push({ tag, r });
  pageBy.set(route, row);
}
for (const row of pageBy.values()) {
  const notReady = row.obs.filter((o) => !o.r.ready);
  const logsAll = uniq(row.obs.flatMap((o) => o.r.logs.filter((l) => classifyLog(personaOf(o.tag), l.text) === "app").map((l) => `${l.type}: ${short(l.text, 110)}`))).slice(0, 4);
  const envLogs = row.obs.reduce((n, o) => n + o.r.logs.filter((l) => classifyLog(personaOf(o.tag), l.text) !== "app").length, 0);
  const defects = uniq(
    row.obs.flatMap((o) =>
      o.r.net
        .filter((n) => !n.external && ((n.status !== null && n.status >= 400) || (n.failed && !/ABORTED|INTERNET_DISCONNECTED/.test(n.failed))))
        .map((n) => `${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, "")} → ${n.status ?? n.failed}${n.ct === "text/html" ? " (HTML-Fallback)" : ""}`)
        .filter((line) => classifyNet(personaOf(o.tag), line) === "app"),
    ),
  ).slice(0, 4);
  const overflow = row.obs.filter((o) => o.r.overflowX > 0);
  const flags = uniq(row.obs.flatMap((o) => o.r.stateFlags.filter((f) => f !== "fehlerrahmen" || o.r.elements.some((e) => /Erneut versuchen|Neu laden/.test(e.desc.name)))));
  const hits = row.obs.flatMap((o) => o.r.hits.map((h) => `${h.where}: ${h.name} (${h.w}×${h.h}, Zielfläche ${h.ew}×${h.eh})`));
  const noRing = uniq(row.obs.flatMap((o) => o.r.tab?.withoutFocusRing ?? [])).slice(0, 4);
  const trapped = row.obs.some((o) => o.r.tab?.trapped);
  let prio = "–";
  const why = [];
  const core = CORE_ROUTES.has(row.route);
  if (notReady.length) {
    prio = core ? "P0" : "P1";
    why.push(`Seite/Overlay nicht bereit: ${notReady.map((o) => o.tag).join(",")}`);
  }
  if (defects.length) {
    if (prio === "–") prio = "P1";
    why.push("Request mit Fehlerstatus beim Laden");
  }
  if (logsAll.some((l) => /^(console-error|pageerror)/.test(l))) {
    if (prio === "–") prio = core ? "P1" : "P2";
    why.push("Konsolenfehler beim Laden");
  }
  if (overflow.length) {
    if (prio === "–" || prio === "P2") prio = "P1";
    why.push(`horizontaler Überlauf: ${overflow.map((o) => o.tag).join(",")}`);
  }
  if (flags.includes("skeleton-bleibt") || flags.includes("fehlerrahmen")) {
    prio = core ? "P0" : "P1";
    why.push(flags.join(","));
  }
  if (trapped) {
    if (prio === "–") prio = "P1";
    why.push("Fokus-Falle beim Tab-Durchlauf");
  }
  if (hits.length && prio === "–") {
    prio = "P2";
    why.push(`${hits.length} Ziele unter 44 px (390)`);
  }
  if (noRing.length && prio === "–") {
    prio = "P2";
    why.push("Tab-Fokus ohne erkennbaren Ring bei " + noRing.join(", "));
  }
  const first = row.obs[0].r;
  const pr = {
    Route: row.route,
    "Element/Button": "SEITE: Laden, Zustand, Tab-Durchlauf",
    Erwartung: "Seite lädt ohne Fehler, h1 sichtbar, kein horizontaler Überlauf, Tab erreicht die Bedienelemente",
    "aktueller Handler": `Hash-Route; h1 „${first.h1 || "–"}“; Anzeige: ${short(first.mainText, 90)}`,
    "tatsächliches Network-/Backend-Ergebnis": defects.join(" | ") || `${row.obs.reduce((n, o) => n + o.r.net.filter((x) => !x.external).length, 0)} eigene Requests ohne Fehlerstatus (Mock-Backend)`,
    "Fehler/Empty States": [...logsAll, ...(envLogs ? [`${envLogs} weitere Konsolenzeilen aus Testwelt/Sandbox (Binance/Bybit/OKX 451/CORS, geblockte Fremdhosts) – nicht dem Produkt zugerechnet`] : []), flags.join(","), ...(hits.length ? [`Ziele < 44 px @390: ${hits.slice(0, 3).join("; ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`] : [])].filter(Boolean).join(" || ") || "–",
    "Mobil/Keyboard": `${row.obs.map((o) => `${o.tag}:${o.r.ready ? "bereit" : "NICHT bereit"}${o.r.overflowX > 0 ? `,Überlauf ${o.r.overflowX}px` : ""}`).slice(0, 8).join(" · ")}; Tab-Schritte ${first.tab?.steps ?? "–"}`,
    Priorität: prio,
    Dateipfad: first.screen && PAGE_LABELS[first.screen] ? `src/views/${first.screen}/ (siehe src/app/pages.ts)` : "src/app/",
    Nachweis: `${row.obs.map((o) => o.tag).slice(0, 5).join(",")}; Bild ${first.screenshot ?? "–"}; ${why.join(", ") || "ok"}`,
    _p: prio,
    _core: core,
  };
  annotate(row, pr);
  pageCsv.push(pr);
}

/** ------------------------------------------------------------------------------ names */
const namesFile = join(crawlDir, "names.json");
const nameRows = [];
if (existsSync(namesFile)) {
  const nm = JSON.parse(readFileSync(namesFile, "utf8"));
  const grouped = new Map();
  for (const u of nm.unnamed) {
    const k = `${u.route}|${u.tag}|${u.role}|${u.html.slice(0, 90)}`;
    const g = grouped.get(k) ?? { ...u, vps: new Set() };
    g.vps.add(u.viewport);
    grouped.set(k, g);
  }
  for (const g of grouped.values())
    nameRows.push({
      Route: g.route,
      "Element/Button": `${g.role || g.tag} „(ohne zugänglichen Namen)“ [${g.where}]`,
      Erwartung: "Jedes Bedienelement hat einen zugänglichen Namen (WCAG 4.1.2): Text, aria-label oder Beschriftung",
      "aktueller Handler": "–",
      "tatsächliches Network-/Backend-Ergebnis": "–",
      "Fehler/Empty States": `Kein Name aus aria-label, aria-labelledby, Text, <label>, title, placeholder, Bild-alt: ${g.html}`,
      "Mobil/Keyboard": `Namens-Prüfung bei ${[...g.vps].join(" und ")} px`,
      Priorität: "P2",
      Dateipfad: "nicht zuordenbar (siehe HTML-Ausschnitt)",
      Nachweis: `Namens-Prüfung tests/audit/names.spec.ts (${nm.checked} Elemente geprüft); Stand ${nm.at.slice(0, 10)}`,
      _p: "P2",
      _core: false,
    });
}

/** ------------------------------------------------------------------------------ write */
const COLS = ["Route", "Element/Button", "Erwartung", "aktueller Handler", "tatsächliches Network-/Backend-Ergebnis", "Fehler/Empty States", "Mobil/Keyboard", "Priorität", "Dateipfad", "Nachweis"];
const esc = (v) => {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const order = { P0: 0, P1: 1, P2: 2, "–": 3 };
const all = [...pageCsv, ...out, ...nameRows].sort((a, b) => order[a._p] - order[b._p] || a.Route.localeCompare(b.Route, "de") || 0);
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "evidence"), { recursive: true });
const lines = [COLS.join(";"), ...all.map((r) => COLS.map((c) => esc(r[c])).join(";"))];
writeFileSync(join(outDir, "INTERACTION_AUDIT.csv"), `${lines.join("\n")}\n`);

// open = the class as is, repaired = the class with "(repariert)" (the crawl found it, this package fixed it)
const count = (p) => all.filter((r) => r.Priorität === p).length;
const countFixed = (p) => all.filter((r) => r.Priorität === `${p} (repariert)`).length;
const statusCounts = {};
for (const row of rows.values()) for (const o of row.obs) if (o.e.probe) statusCounts[o.e.probe.status] = (statusCounts[o.e.probe.status] ?? 0) + 1;
const summary = {
  builtAt: new Date().toISOString(),
  units: evidence.units,
  rows: all.length,
  elementRows: out.length,
  pageRows: pageCsv.length,
  priority: { P0: count("P0"), P1: count("P1"), P2: count("P2"), ok: count("–") },
  repaired: { P0: countFixed("P0"), P1: countFixed("P1"), P2: countFixed("P2") },
  probeStatuses: statusCounts,
  personas: PERSONA_DOC,
  loadLogs: evidence.logs.length,
  p0p1: all.filter((r) => r._p === "P0" || r._p === "P1").map((r) => ({ prio: r.Priorität, route: r.Route, element: r["Element/Button"], why: r.Nachweis.split("; ").slice(-1)[0], err: r["Fehler/Empty States"].slice(0, 260), path: r.Dateipfad })),
  consoleErrorsOnLoad: uniq(evidence.logs.filter((l) => l.type !== "console-warning" && l.cls === "app").map((l) => `${l.tag} ${l.screen}: ${l.text.slice(0, 160)}`)).slice(0, 40),
  consoleLinesByClass: evidence.logs.reduce((m, l) => ({ ...m, [l.cls]: (m[l.cls] ?? 0) + 1 }), {}),
  failedRequests: uniq(evidence.failedRequests.filter((n) => (n.status !== null && n.status >= 400) || (n.failed && !/ABORTED|INTERNET_DISCONNECTED/.test(n.failed))).map((n) => `${n.method} ${n.url.replace(/^https?:\/\/[^/]+/, "")} → ${n.status ?? n.failed}`)).slice(0, 40),
};
writeFileSync(join(outDir, "evidence", "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`rows ${all.length} (offen: P0 ${count("P0")}, P1 ${count("P1")}, P2 ${count("P2")}; repariert: P0 ${countFixed("P0")}, P1 ${countFixed("P1")}, P2 ${countFixed("P2")}; ohne Befund ${count("–")}) → ${relative(process.cwd(), join(outDir, "INTERACTION_AUDIT.csv"))}`);
console.log("probe statuses:", JSON.stringify(statusCounts));
