/**
 * Layer diagnostics overlay (decision 7). Loaded lazily by `LayerDiagHost` only while it is open (`?debug=layers` or
 * five quick taps on the header logo). It shows, on top of everything:
 * - a dashed outline + label (`#n name · w×h · z`) for every `position: fixed | sticky` layer of the page;
 * - a striped, fully opaque PRÜFSTREIFEN across the bottom 64 px of the layout viewport at the highest z-index a page
 *   can use, with a 16 / 32 / 48 px ruler: a grey bar that still covers it is drawn by the browser, not by the page;
 * - a panel with the viewport / visual viewport / safe-area numbers, the layers under the bottom centre, every layer
 *   with a hide toggle, the Samsung-safe-effects switch, and "Kopieren" for the plain-text report.
 * Measuring only runs while open: one DOM walk per second (and on resize / visual-viewport changes), box refreshes on
 * scroll at ≤ 10 Hz. Everything it changes (hidden layers, noise film, safe effects) is restored when it closes.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DISPLAY_STRINGS, isSafeFx, setSafeFx } from "@/app/pwa";
import { collectLayers, copyText, DIAG_ATTR, formatReport, layersAt, readViewport, refreshBoxes, setLayerDiagOpen, type LayerInfo, type ViewportInfo } from "@/app/layerDiag";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { GlyphClose } from "@/primitives/icons";

/** Above every app layer (toasts 95, intro 95); the probe takes the very top. */
const ROOT_Z = 2147483000;
const PROBE_Z = 2147483647;
/** Height of the bottom probe (px) – taller than the reported bar (47 px), so its top edge stays visible either way. */
export const PROBE_H = 64;
const COLORS = ["#e5202e", "#f2f2f2", "#ffb020", "#3ddc84"] as const;
const DIAG = { [DIAG_ATTR]: "" };

export const DIAG_TITLE = "Ebenen-Diagnose";
export const DIAG_HINT =
  "Rot-schwarz gestreift = Prüfstreifen am unteren Seitenrand (höchste Ebene, die eine Seite zeichnen kann). Verdeckt der graue Balken den Streifen, zeichnet ihn der Browser – dann helfen Vollbild oder „App installieren“. Liegt der Streifen über dem Balken, gehört der Balken zur Seite: Ebenen unten einzeln ausblenden, bis er verschwindet. Screenshot machen und „Kopieren“ tippen.";

const colorOf = (n: number) => COLORS[(n - 1) % COLORS.length] as string;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A layer without area (an idle 0×0 region) gets no outline or label; the panel list still names it. */
const hasArea = (l: LayerInfo): boolean => l.box.w * l.box.h > 0;

/**
 * Label boxes in viewport px, nudged down until they no longer overlap an earlier label (estimated text width, 6.8 px
 * per character of the 10-px mono font). A label that still overlaps after 12 nudges goes to the first free slot of a
 * column at the left edge, stacked upward from the bottom; with no free slot left it is not drawn — a label never
 * keeps an overlapping spot.
 */
export function placeLabels(layers: readonly LayerInfo[], vw: number, vh: number, bottom: number): Map<number, { x: number; y: number }> {
  const placed: Placed[] = [];
  const out = new Map<number, { x: number; y: number }>();
  const h = 18;
  // never under the probe band: a label of a bottom layer (dock) sits just above it
  const maxY = vh - bottom - h - 4;
  const hits = (x: number, y: number, w: number) => placed.some((p) => x < p.x + p.w + 2 && x + w + 2 > p.x && y < p.y + p.h + 2 && y + h + 2 > p.y);
  for (const l of layers) {
    if (!hasArea(l)) continue;
    const text = `#${l.n} ${l.name} · ${l.box.w}×${l.box.h} · ${l.position === "innen" ? "innen" : `z ${l.z}`}`;
    const w = Math.min(vw - 8, text.length * 6.8 + 14);
    let x = Math.max(4, Math.min(vw - w - 4, l.box.x + 4));
    let y = Math.max(4, Math.min(maxY, l.box.y + 4));
    for (let i = 0; i < 12 && hits(x, y, w); i++) {
      if (y + h + 2 <= maxY) y += h + 2;
      else {
        y = Math.max(4, y - (h + 2));
        x = Math.min(vw - w - 4, x + 24);
      }
    }
    if (hits(x, y, w)) {
      let free: { x: number; y: number } | null = null;
      for (let fy = maxY; fy >= 4; fy -= h + 2) {
        if (!hits(4, fy, w)) {
          free = { x: 4, y: fy };
          break;
        }
      }
      if (!free) continue;
      ({ x, y } = free);
    }
    placed.push({ x, y, w, h });
    out.set(l.n, { x, y });
  }
  return out;
}

function Outlines({ layers, vw, vh, bottom }: { layers: readonly LayerInfo[]; vw: number; vh: number; bottom: number }) {
  const labels = useMemo(() => placeLabels(layers, vw, vh, bottom), [layers, vw, vh, bottom]);
  return (
    <>
      {layers.filter(hasArea).map((l) => {
        const c = colorOf(l.n);
        const at = labels.get(l.n);
        return (
          <div key={l.n} {...DIAG}>
            <div
              {...DIAG}
              aria-hidden="true"
              className="absolute"
              style={{ left: l.box.x, top: l.box.y, width: Math.max(1, l.box.w), height: Math.max(1, l.box.h), outline: `1.5px dashed ${c}`, outlineOffset: -1.5 }}
            />
            {at && (
              <span
                {...DIAG}
                aria-hidden="true"
                className="absolute whitespace-nowrap rounded-[5px] border bg-ink-950 px-1.5 font-mono text-[10px] leading-4 text-fg"
                style={{ left: at.x, top: at.y, borderColor: c, maxWidth: vw - 8, overflow: "hidden", textOverflow: "ellipsis" }}
              >
                <span style={{ color: c }}>#{l.n}</span> {l.name} · {l.box.w}×{l.box.h} · {l.position === "innen" ? "innen" : `z ${l.z}`}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Opaque striped band over the bottom of the layout viewport (the highest z a page can use) with a px ruler. */
function Probe() {
  const stripes: CSSProperties = { background: "repeating-linear-gradient(135deg, #e5202e 0 8px, #0a0a0a 8px 16px)" };
  return (
    <div {...DIAG} aria-hidden="true" className="fixed inset-x-0 bottom-0" style={{ height: PROBE_H, zIndex: PROBE_Z, ...stripes }}>
      <span {...DIAG} className="absolute inset-x-0 top-0 h-px bg-fg" />
      {[16, 32, 48].map((y) => (
        <span {...DIAG} key={y} className="absolute left-0 flex items-center gap-1" style={{ bottom: y - 0.5 }}>
          <span className="h-px w-3 bg-fg" />
          <span className="rounded-[3px] bg-ink-950 px-1 font-mono text-[9px] leading-3 text-fg">{y}</span>
        </span>
      ))}
      <span {...DIAG} className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-signal bg-ink-950 px-2 font-mono text-[10px] leading-4 tracking-[0.08em] text-fg">
        PRÜFSTREIFEN · untere {PROBE_H} px der Seite
      </span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="num min-w-0 break-words font-mono text-fg">{v}</dd>
    </>
  );
}

/** Small on/off pill (aria-pressed), ≥ 44 px tall on coarse pointers. */
function Toggle({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: string; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        on ? "border-white/40 bg-white/[0.08] text-fg" : "border-line-2 text-mute hover:text-fg",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", on ? "bg-signal" : "bg-faint")} />
      {children}
    </button>
  );
}

export default function LayerDiagnostics() {
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [vp, setVp] = useState<ViewportInfo | null>(null);
  const [min, setMin] = useState(false);
  const [probe, setProbe] = useState(true);
  const [noise, setNoise] = useState(true);
  const [safe, setSafe] = useState(isSafeFx);
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");
  // hidden layers (state for the render) + their original inline visibility (ref, restored on toggle / close)
  const [hiddenEls, setHiddenEls] = useState<readonly Element[]>([]);
  const hidden = useRef(new Map<Element, string>());
  const initialSafe = useRef(isSafeFx());

  const measure = useCallback(() => {
    setLayers(collectLayers());
    setVp(readViewport());
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastScroll = 0;
    const full = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), measure()));
    };
    const onScroll = () => {
      const now = performance.now();
      if (now - lastScroll < 100) return;
      lastScroll = now;
      setLayers((prev) => refreshBoxes(prev));
    };
    full();
    const iv = setInterval(measure, 1000);
    const vv = window.visualViewport;
    window.addEventListener("resize", full, { passive: true });
    window.addEventListener("orientationchange", full, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    vv?.addEventListener("resize", full, { passive: true });
    vv?.addEventListener("scroll", full, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayerDiagOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const originals = hidden.current;
    const startSafe = initialSafe.current;
    return () => {
      clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", full);
      window.removeEventListener("orientationchange", full);
      window.removeEventListener("scroll", onScroll);
      vv?.removeEventListener("resize", full);
      vv?.removeEventListener("scroll", full);
      window.removeEventListener("keydown", onKey);
      // restore everything the overlay changed
      for (const [el, prev] of originals) (el as HTMLElement).style.visibility = prev;
      originals.clear();
      document.documentElement.removeAttribute("data-diag-nonoise");
      setSafeFx(startSafe);
    };
  }, [measure]);

  const toggleLayer = (l: LayerInfo) => {
    if (l.pseudo === "body::before") {
      const next = !noise;
      setNoise(next);
      document.documentElement.toggleAttribute("data-diag-nonoise", !next);
    } else if (l.el instanceof HTMLElement || l.el instanceof SVGElement) {
      const el = l.el as HTMLElement;
      const map = hidden.current;
      if (map.has(el)) {
        el.style.visibility = map.get(el) ?? "";
        map.delete(el);
      } else {
        map.set(el, el.style.visibility);
        el.style.visibility = "hidden";
      }
      setHiddenEls([...map.keys()]);
    }
    requestAnimationFrame(measure);
  };
  const isHidden = (l: LayerInfo) => (l.pseudo === "body::before" ? !noise : !!l.el && hiddenEls.includes(l.el));

  const vw = vp?.inner.w ?? (typeof window === "undefined" ? 0 : window.innerWidth);
  const vh = vp?.inner.h ?? (typeof window === "undefined" ? 0 : window.innerHeight);
  const at = useMemo(
    () =>
      [12, 30].map((dy) => ({
        label: `Ebenen an der Unterkante (Mitte, ${dy} px darüber)`,
        names: layersAt(layers, vw / 2, vh - dy).map((l) => `#${l.n} ${l.name}`),
      })),
    [layers, vw, vh],
  );
  const report = useMemo(() => (vp ? formatReport(vp, layers, at, new Date(), location.href) : ""), [vp, layers, at]);
  const vvBottom = vp?.vv ? vp.vv.top + vp.vv.h : vh;

  const onCopy = async () => {
    const ok = await copyText(report);
    setCopy(ok ? "ok" : "fail");
    if (ok) setTimeout(() => setCopy("idle"), 2000);
  };

  return (
    <div {...DIAG} role="region" aria-label={DIAG_TITLE} data-testid="layer-diag" className="pointer-events-none fixed inset-0" style={{ zIndex: ROOT_Z }}>
      <Outlines layers={layers} vw={vw} vh={vh} bottom={probe ? PROBE_H : 0} />
      {vp && vvBottom < vh - 1 && (
        <div {...DIAG} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-warn" style={{ top: vvBottom }}>
          <span className="absolute right-2 top-1 rounded-[4px] bg-ink-950 px-1.5 font-mono text-[10px] text-warn">Visual-Viewport-Unterkante · {Math.round(vh - vvBottom)} px über dem Layout-Rand</span>
        </div>
      )}
      {probe && <Probe />}
      {min ? (
        <button
          type="button"
          {...DIAG}
          onClick={() => setMin(false)}
          className="pointer-events-auto fixed left-3 top-[calc(env(safe-area-inset-top,0px)+76px)] inline-flex min-h-11 items-center gap-2 rounded-full border border-line-2 bg-ink-900 px-4 text-[12px] font-medium text-fg shadow-tooltip"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
          {DIAG_TITLE} öffnen
        </button>
      ) : (
        <div
          {...DIAG}
          className="pointer-events-auto fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+76px)] grid w-[min(600px,calc(100vw-24px))] -translate-x-1/2 gap-4 overflow-y-auto overscroll-contain rounded-2xl border border-line-2 bg-ink-900 p-4 text-[12px] text-mute shadow-dialog"
          style={{ maxHeight: `max(240px, calc(100dvh - 76px - ${PROBE_H + 24}px - env(safe-area-inset-top, 0px)))` }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
              <h2 className="label !text-fg">{DIAG_TITLE}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => void onCopy()}>
                {copy === "ok" ? "Kopiert ✓" : "Kopieren"}
              </Button>
              <Button size="sm" onClick={() => setMin(true)}>
                Minimieren
              </Button>
              <Button size="sm" aria-label="Diagnose schließen" onClick={() => setLayerDiagOpen(false)} className="!px-2">
                <GlyphClose className="size-3.5" />
              </Button>
            </div>
          </div>
          <p className="leading-relaxed">{DIAG_HINT}</p>
          {vp?.samsung && <p className="rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 leading-relaxed text-warn">{DISPLAY_STRINGS.samsungDark}</p>}
          {copy === "fail" && (
            <div className="grid gap-1.5">
              <span className="text-warn">Kopieren nicht erlaubt – Text ist markiert, über das Menü kopieren:</span>
              <textarea readOnly value={report} rows={6} onFocus={(e) => e.currentTarget.select()} autoFocus className="w-full rounded-lg border border-line-2 bg-ink-950 p-2 font-mono text-[10.5px] text-fg" />
            </div>
          )}
          {vp && (
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[11.5px]">
              <Row k="Browser" v={vp.samsung ? "Samsung Internet" : vp.ua.replace(/^Mozilla\/5\.0 /, "").slice(0, 80)} />
              <Row k="Anzeige" v={`${vp.display} · DPR ${vp.dpr} · Bildschirm ${vp.screen}`} />
              <Row k="Fenster" v={`inner ${vp.inner.w}×${vp.inner.h} · client ${vp.client.w}×${vp.client.h}`} />
              <Row k="Visual Viewport" v={vp.vv ? `${vp.vv.w}×${vp.vv.h} · Versatz ${vp.vv.left}/${vp.vv.top} · Zoom ${vp.vv.scale}` : "–"} />
              <Row k="Safe-Area" v={`oben ${vp.safe.top} · rechts ${vp.safe.right} · unten ${vp.safe.bottom} · links ${vp.safe.left}`} />
              <Row k="Unterer Abstand" v={`--vv-bottom ${vp.vvBottom} · --safe-bottom ${vp.safeBottom}px`} />
              {at.map((a) => (
                <Row key={a.label} k={a.label.replace("Ebenen an der Unterkante", "Unterkante")} v={a.names.length ? a.names.join(" › ") : "keine Seiten-Ebene"} />
              ))}
            </dl>
          )}
          <div className="grid gap-2">
            <span className="label">Optionen</span>
            <div className="flex flex-wrap gap-2">
              <Toggle on={probe} onClick={() => setProbe((p) => !p)} label="Prüfstreifen anzeigen">
                Prüfstreifen
              </Toggle>
              <Toggle
                on={safe}
                onClick={() => {
                  setSafeFx(!safe);
                  setSafe(!safe);
                  requestAnimationFrame(measure);
                }}
                label="Sichere Effekte (Samsung) anwenden"
              >
                Sichere Effekte (Samsung)
              </Toggle>
            </div>
          </div>
          <div className="grid gap-1">
            <span className="label">Ebenen · fixed / sticky · {layers.length}</span>
            <ul className="grid">
              {layers.map((l, i) => {
                const off = isHidden(l);
                const canHide = l.pseudo === "body::before" || !!l.el;
                return (
                  <li key={l.n} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2", i > 0 && "border-t border-line")}>
                    <span className="num font-mono text-[11px]" style={{ color: colorOf(l.n) }}>
                      #{l.n}
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className={cn("truncate text-[12px]", off ? "text-faint line-through" : "text-fg")}>{l.name}</span>
                      <span className="num truncate font-mono text-[10.5px] text-faint">
                        {l.position} · {l.box.w}×{l.box.h} @ {l.box.x},{l.box.y} · z {l.z}
                        {l.effects.length ? ` · ${l.effects.join(", ")}` : ""}
                      </span>
                    </span>
                    {canHide && (
                      <Toggle on={!off} onClick={() => toggleLayer(l)} label={`${l.name} ${off ? "einblenden" : "ausblenden"}`}>
                        {off ? "aus" : "an"}
                      </Toggle>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-[11px] text-faint">Schließen: ×, Esc oder fünfmal schnell auf das Logo tippen. Aufruf: Adresse mit „?debug=layers“.</p>
        </div>
      )}
    </div>
  );
}
