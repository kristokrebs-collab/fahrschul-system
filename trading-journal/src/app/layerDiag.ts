/**
 * Layer diagnostics (decision 7, "grey bar" on the Galaxy Tab in Samsung Internet): which page layer sits where.
 * Opened by `?debug=layers` in the URL (search or hash query, e.g. `/?debug=layers` or `#overview?debug=layers`) or by
 * five quick taps on the header logo; the overlay itself (`LayerDiagnostics.tsx`) is loaded only then.
 *
 * Pure helpers (tap counter, names, geometry, report text) + DOM measuring that runs ONLY while the overlay is open
 * (one DOM walk per refresh, ≤ 1×/s, plus rect reads on scroll / resize at ≤ 10 Hz) – nothing here runs in the app
 * otherwise. The Samsung-Internet-safe effects switch (`data-safe-fx` on `<html>`, see `@/app/pwa`) is reported and can
 * be toggled from the overlay to compare.
 */
import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ activation */

/** URL switch: `debug=layers` (also `debug=layers,…`). */
export const DIAG_PARAM = "layers";

/** Pure: whether the URL asks for the layer diagnostics (`?debug=layers` in the search or in the hash query). */
export function diagRequested(search: string, hash: string): boolean {
  const q = (s: string) => {
    const i = s.indexOf("?");
    const raw = i >= 0 ? s.slice(i + 1) : s.replace(/^\?/, "");
    try {
      return (new URLSearchParams(raw).get("debug") ?? "").split(",").includes(DIAG_PARAM);
    } catch {
      return false;
    }
  };
  return q(search) || q(hash.startsWith("#") ? hash.slice(1) : hash);
}

/** Five quick taps (each within `gapMs` of the previous one) open / close the overlay. */
export const MULTI_TAP = { count: 5, gapMs: 450 } as const;

/**
 * Pure tap counter: `tap(now)` returns the number of consecutive quick taps so far (1 … count); it reports `count`
 * exactly once and then starts over. `pending()` is true while a series is still running (a single tap's own action
 * waits for it to end).
 */
export function createTapCounter(cfg: { count: number; gapMs: number } = MULTI_TAP) {
  let n = 0;
  let last = -Infinity;
  return {
    tap(now: number): number {
      n = now - last <= cfg.gapMs ? n + 1 : 1;
      last = now;
      const out = n;
      if (n >= cfg.count) {
        n = 0;
        last = -Infinity;
      }
      return out;
    },
    reset() {
      n = 0;
      last = -Infinity;
    },
  };
}

/* ------------------------------------------------------------------ open state (tiny external store) */

const hasWindow = typeof window !== "undefined" && typeof document !== "undefined";
const listeners = new Set<() => void>();
let open = hasWindow ? diagRequested(location.search, location.hash) : false;

function emit() {
  for (const l of listeners) l();
}

export function isLayerDiagOpen(): boolean {
  return open;
}

export function setLayerDiagOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export const toggleLayerDiag = (): void => setLayerDiagOpen(!open);

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useLayerDiagOpen(): boolean {
  return useSyncExternalStore(subscribe, isLayerDiagOpen, () => false);
}

if (hasWindow) {
  // a later `#…?debug=layers` (typed into the address bar) opens it too
  window.addEventListener("hashchange", () => {
    if (diagRequested("", location.hash)) setLayerDiagOpen(true);
  });
}

/* ------------------------------------------------------------------ measuring (overlay open only) */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerInfo {
  /** 1-based, stable for one measurement */
  n: number;
  name: string;
  /** `innen`: a named part (`data-layer`) inside a fixed layer, e.g. the visible dock plate */
  position: "fixed" | "sticky" | "innen";
  box: Box;
  z: string;
  opacity: number;
  /** background colour as computed (rgba / "transparent") */
  bg: string;
  /** clip-path · backdrop-filter · mask · filter · will-change · transform · blend */
  effects: string[];
  visibility: string;
  /** null for pseudo elements (body::before) */
  el: Element | null;
  /** pseudo element (e.g. "body::before") */
  pseudo?: string;
}

/** Attribute that marks every element of the overlay itself (never listed). */
export const DIAG_ATTR = "data-layer-diag";

const round = (v: number) => Math.round(v);

/** Pure: a short readable name – `data-layer`, `aria-label`, `data-testid`, `id`, else tag + first classes. */
export function layerName(el: { tagName: string; id?: string; getAttribute(n: string): string | null; classList?: { length: number; [i: number]: string } }): string {
  const attr = (n: string) => el.getAttribute(n)?.trim() || "";
  const tag = el.tagName.toLowerCase();
  const named = attr("data-layer") || attr("aria-label") || attr("data-testid");
  if (named) return `${named} (${tag})`;
  if (el.id) return `${tag}#${el.id}`;
  const cls: string[] = [];
  const list = el.classList;
  if (list) for (let i = 0; i < list.length && cls.length < 3; i++) if (list[i] && !list[i]!.includes("[")) cls.push(list[i]!);
  return cls.length ? `${tag}.${cls.join(".")}` : tag;
}

/** Pure: effects that matter for a fixed layer in Samsung Internet (from computed style values). */
export function layerEffects(cs: Pick<CSSStyleDeclaration, "clipPath" | "filter" | "transform" | "willChange" | "mixBlendMode"> & Record<string, unknown>): string[] {
  const out: string[] = [];
  const v = (k: string) => (typeof cs[k] === "string" ? (cs[k] as string) : "");
  if (v("clipPath") && v("clipPath") !== "none") out.push("clip-path");
  const backdrop = v("backdropFilter") || v("webkitBackdropFilter");
  if (backdrop && backdrop !== "none") out.push("backdrop-filter");
  const mask = v("maskImage") || v("webkitMaskImage");
  if (mask && mask !== "none") out.push("mask");
  if (v("filter") && v("filter") !== "none") out.push("filter");
  if (v("willChange") && v("willChange") !== "auto") out.push(`will-change:${v("willChange")}`);
  if (v("transform") && v("transform") !== "none") out.push("transform");
  if (v("mixBlendMode") && v("mixBlendMode") !== "normal") out.push(`blend:${v("mixBlendMode")}`);
  return out;
}

function info(el: Element, cs: CSSStyleDeclaration, n: number, pseudo?: string): LayerInfo {
  const r = pseudo ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
  return {
    n,
    name: pseudo ?? layerName(el),
    position: cs.position === "sticky" ? "sticky" : cs.position === "fixed" ? "fixed" : "innen",
    box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
    z: cs.zIndex,
    opacity: Number.parseFloat(cs.opacity) || 0,
    bg: cs.backgroundColor === "rgba(0, 0, 0, 0)" ? (cs.backgroundImage !== "none" ? "Verlauf/Bild" : "transparent") : cs.backgroundColor,
    effects: layerEffects(cs as unknown as Parameters<typeof layerEffects>[0]),
    visibility: cs.visibility,
    el: pseudo ? null : el,
    pseudo,
  };
}

/**
 * Every `position: fixed | sticky` element of the page (DOM order), named parts inside them (`data-layer`, e.g. the
 * visible dock plate) and fixed pseudo elements of `<html>` / `<body>` (the noise film is `body::before`). Skips the overlay and `display: none` subtrees. One computed-style read per
 * element – call it at most about once a second.
 */
export function collectLayers(doc: Document = document): LayerInfo[] {
  const out: LayerInfo[] = [];
  // jsdom has no pseudo-element styles (and logs for every try)
  const pseudoStyles = !/jsdom/i.test(navigator.userAgent);
  for (const host of pseudoStyles ? [doc.documentElement, doc.body] : []) {
    if (!host) continue;
    for (const p of ["::before", "::after"] as const) {
      const cs = getComputedStyle(host, p);
      if (cs.display !== "none" && cs.content !== "none" && cs.content !== "normal" && (cs.position === "fixed" || cs.position === "sticky")) {
        out.push(info(host, cs, out.length + 1, `${host.tagName.toLowerCase()}${p}`));
      }
    }
  }
  // `layerZ`: z-index of the nearest fixed / sticky ancestor – a named inner part stacks with its layer
  const visit = (el: Element, layerZ: string) => {
    if (el.hasAttribute(DIAG_ATTR)) return;
    const cs = getComputedStyle(el);
    // nothing below a display:none element is rendered
    if (cs.display === "none") return;
    const own = cs.position === "fixed" || cs.position === "sticky";
    if (own) out.push(info(el, cs, out.length + 1));
    else if (el.hasAttribute("data-layer")) out.push({ ...info(el, cs, out.length + 1), z: layerZ });
    for (const child of Array.from(el.children)) visit(child, own ? cs.zIndex : layerZ);
  };
  if (doc.body) for (const child of Array.from(doc.body.children)) visit(child, "auto");
  return out;
}

/** Re-reads the boxes of already collected layers (scroll moves sticky layers; cheap: a few rects). */
export function refreshBoxes(layers: readonly LayerInfo[]): LayerInfo[] {
  return layers.map((l) => {
    if (!l.el || !l.el.isConnected) return l;
    const r = l.el.getBoundingClientRect();
    return { ...l, box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) } };
  });
}

export interface ViewportInfo {
  ua: string;
  samsung: boolean;
  safeFx: boolean;
  display: string;
  dpr: number;
  screen: string;
  inner: { w: number; h: number };
  client: { w: number; h: number };
  vv: { w: number; h: number; top: number; left: number; scale: number } | null;
  safe: { top: number; right: number; bottom: number; left: number };
  vvBottom: string;
  safeBottom: number;
  scrollY: number;
  docH: number;
}

/** Reads one `env()` / custom property length through a probe element (px). */
function probeLength(doc: Document, prop: string, value: string): number {
  const el = doc.createElement("div");
  el.setAttribute(DIAG_ATTR, "");
  el.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;${prop}:${value}`;
  doc.body.appendChild(el);
  const v = Number.parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
  el.remove();
  return round(v);
}

export function readViewport(win: Window = window): ViewportInfo {
  const doc = win.document;
  const root = doc.documentElement;
  const vv = win.visualViewport;
  const mq = (q: string) => (typeof win.matchMedia === "function" ? win.matchMedia(q).matches : false);
  const display = doc.fullscreenElement ? "Vollbild (API)" : mq("(display-mode: fullscreen)") ? "fullscreen" : mq("(display-mode: standalone)") ? "standalone (installiert)" : mq("(display-mode: minimal-ui)") ? "minimal-ui" : "Browser-Tab";
  return {
    ua: win.navigator.userAgent,
    samsung: /SamsungBrowser\//.test(win.navigator.userAgent),
    safeFx: root.hasAttribute("data-safe-fx"),
    display,
    dpr: win.devicePixelRatio,
    screen: `${win.screen.width}×${win.screen.height}`,
    inner: { w: win.innerWidth, h: win.innerHeight },
    client: { w: root.clientWidth, h: root.clientHeight },
    vv: vv ? { w: round(vv.width), h: round(vv.height), top: round(vv.offsetTop), left: round(vv.offsetLeft), scale: Math.round(vv.scale * 100) / 100 } : null,
    safe: {
      top: probeLength(doc, "padding-top", "env(safe-area-inset-top, 0px)"),
      right: probeLength(doc, "padding-right", "env(safe-area-inset-right, 0px)"),
      bottom: probeLength(doc, "padding-bottom", "env(safe-area-inset-bottom, 0px)"),
      left: probeLength(doc, "padding-left", "env(safe-area-inset-left, 0px)"),
    },
    vvBottom: root.style.getPropertyValue("--vv-bottom") || "0px",
    safeBottom: probeLength(doc, "padding-bottom", "var(--safe-bottom, 0px)"),
    scrollY: round(win.scrollY),
    docH: round(root.scrollHeight),
  };
}

/** Pure: layers whose box covers the point (topmost first: higher z, then later in DOM order). */
export function layersAt(layers: readonly LayerInfo[], x: number, y: number): LayerInfo[] {
  const zOf = (l: LayerInfo) => (l.z === "auto" ? 0 : Number(l.z) || 0);
  return layers
    .filter((l) => l.visibility !== "hidden" && x >= l.box.x && x < l.box.x + l.box.w && y >= l.box.y && y < l.box.y + l.box.h)
    .sort((a, b) => zOf(b) - zOf(a) || b.n - a.n);
}

/** Pure: one report line per layer. */
export function layerLine(l: LayerInfo): string {
  const fx = l.effects.length ? ` · ${l.effects.join(", ")}` : "";
  const hidden = l.visibility === "hidden" ? " · ausgeblendet" : "";
  const op = l.opacity < 1 ? ` · Deckkraft ${Math.round(l.opacity * 100)} %` : "";
  return `${l.n}. ${l.name} · ${l.position} · ${l.box.w}×${l.box.h} @ ${l.box.x},${l.box.y} · z ${l.z} · ${l.bg}${op}${fx}${hidden}`;
}

/** Pure: the full report (German, plain text – pasted into a chat next to the screenshot). */
export function formatReport(v: ViewportInfo, layers: readonly LayerInfo[], at: { label: string; names: string[] }[], when: Date, url: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  const vv = v.vv ? `${v.vv.w}×${v.vv.h} · Versatz ${v.vv.left}/${v.vv.top} · Zoom ${v.vv.scale}` : "–";
  return [
    "Trade Journal · Ebenen-Diagnose",
    `Zeit: ${stamp}`,
    `URL: ${url}`,
    `Browser: ${v.ua}`,
    `Samsung Internet: ${v.samsung ? "ja" : "nein"} · sichere Effekte: ${v.safeFx ? "an" : "aus"}`,
    `Anzeige: ${v.display} · DPR ${v.dpr} · Bildschirm ${v.screen}`,
    `Fenster (inner): ${v.inner.w}×${v.inner.h} · Layout (client): ${v.client.w}×${v.client.h}`,
    `Visual Viewport: ${vv}`,
    `Safe-Area: oben ${v.safe.top} · rechts ${v.safe.right} · unten ${v.safe.bottom} · links ${v.safe.left}`,
    `--vv-bottom ${v.vvBottom} · --safe-bottom ${v.safeBottom}px · scrollY ${v.scrollY} / ${v.docH}`,
    ...at.map((a) => `${a.label}: ${a.names.length ? a.names.join(" › ") : "keine Seiten-Ebene"}`),
    `Ebenen (fixed/sticky): ${layers.length}`,
    ...layers.map(layerLine),
  ].join("\n");
}

/** Copies text: async Clipboard API, else a selected textarea + `execCommand("copy")`. Resolves to success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission / insecure context → fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.setAttribute(DIAG_ATTR, "");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
