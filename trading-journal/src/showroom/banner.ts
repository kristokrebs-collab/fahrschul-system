/**
 * The fixed Showroom banner (Paket S): "SHOWROOM · Demo-Daten · keine echten Konten oder Zahlungen". Plain DOM, not React: it has to be there from the
 * first paint (no layout jump), cannot be dismissed (it has no control at all) and survives anything the app does to its own tree.
 *
 * Place: the bottom edge, in a band the page reserves for it. `html[data-showroom]` adds the band's height to `--safe-bottom` (base.css), the
 * variable the dock, the bottom fade, the footer's padding and the sheets already respect – so nothing (the footer's legal links included) ends up
 * under it, and the start page / cockpit layout above is untouched. Dialogs and sheets are above it (z-index 46 < the sheets), as they are above
 * the dock. Text on a phone wraps to two lines (band 38 px instead of 26).
 */
export const BANNER_TEXT = "SHOWROOM · Demo-Daten · keine echten Konten oder Zahlungen";
export const BANNER_ID = "showroom-banner";

export const BANNER_CSS = `
html[data-showroom]{--sr-bar:26px;--safe-bottom:calc(max(env(safe-area-inset-bottom,0px),var(--vv-bottom,0px)) + var(--sr-bar))}
@media (max-width:520px){html[data-showroom]{--sr-bar:38px}}
#${BANNER_ID}{position:fixed;left:0;right:0;bottom:0;z-index:46;box-sizing:border-box;min-height:var(--sr-bar);display:flex;align-items:center;justify-content:center;gap:8px;padding:5px 12px;background:var(--color-ink-950,#0b0b0b);border-top:1px solid var(--color-line,#2a2a2a);color:var(--color-mute,#a0a0a0);font:600 10px/1.25 var(--font-mono,ui-monospace,monospace);letter-spacing:.09em;text-align:center;text-transform:uppercase;pointer-events:none}
#${BANNER_ID}::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--color-signal,#e5202e)}
`;

export function mountBanner(doc: Document = document): HTMLElement {
  const existing = doc.getElementById(BANNER_ID);
  if (existing) return existing;
  doc.documentElement.setAttribute("data-showroom", "1");
  const style = doc.createElement("style");
  style.setAttribute("data-showroom-style", "");
  style.textContent = BANNER_CSS;
  doc.head.appendChild(style);
  const bar = doc.createElement("div");
  bar.id = BANNER_ID;
  bar.setAttribute("role", "note");
  bar.setAttribute("data-testid", "showroom-banner");
  bar.textContent = BANNER_TEXT;
  doc.body.appendChild(bar);
  return bar;
}
