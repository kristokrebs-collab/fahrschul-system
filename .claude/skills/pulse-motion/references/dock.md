# Dock (dock)
> macOS-artige Icon-Leiste (Home, Search, Music, Favorites, Add New, Profile, Settings): beim Ueberfahren eines Icons blendet ein Textlabel darueber ein (steigt ~6px auf) und eine graue Pille faehrt hinter dem Icon auf; beim Wechsel ueberblenden alte und neue Labels parallel.

## Wann einsetzen
- Floating Navigation / Bottom-Dock fuer Apps, Portfolios, Landing-Pages (Icon-only Toolbar)
- Icon-Toolbars mit Tooltips (Editor, Player, Admin-Panel), die ohne Beschriftung sauber bleiben sollen
- Dark-UI mit minimalem Look: Kontrast nur ueber Grau-Pille und weissen Text
- Segmented-/Tab-Leiste mit Hover-Feedback; Mobile-Tab-Bar mit Label-Hinweis beim Drag ueber die Icons
- Dock / icon bar / tooltip on hover / hover pill / macOS dock / toolbar / navigation

## Anatomie & Zeitleiste
Buehne #1f1f1f (1234x673). Dock 357x62px, mittig, 1px Rahmen, Radius 16, transparent. 7 Items je 49.1x49.4px ohne Gap, Icons 22px (Lucide-Stil, Strich 1.6, #b3b3b3). Ein Tooltip (Text 12px/500, #f9f9f9) und eine Pille (#484848, 50.5x49.4, Radius 12, ~2.5px ueber Icon-Mitte) pro Item. Zeiten gemessen an echten Frame-Zeiten (8-10 ms Aufloesung):

| Phase | ms | Verlauf |
|---|---|---|
| Hover-Start Tooltip | 0 | Opacity 0->1 exponentiell tau 38 ms (19% @8, 62% @35, 94% @100 ms) |
| Tooltip-Aufstieg | 0-~110 | translateY +6px -> 0, Feder mit leichtem Overshoot (~0.5px) |
| Pille ein | ~25 | Opacity 0->1, tau ~40 ms (Ende ~100 ms) |
| Hover-Ende Tooltip | 0-~100 | Opacity ->0, tau ~35 ms, kein Rueckweg der Position |
| Hover-Ende Pille | 0-~150 | Opacity ->0, tau ~45 ms (traeger als der Tooltip) |
| Itemwechsel | parallel | altes Label/Pille blenden aus, neues ein: kurzzeitig zwei Labels (z. B. "Home" + "Search") nebeneinander |

## Motion-Tokens
- Tooltip-Opacity in tau 38 ms / out 35 ms; Pille in 40 ms / out 45 ms (alles `1 - exp(-dt/tau)`)
- Tooltip-Y: Feder stiffness 1000, damping 38, Start +6px (Framer: `y: [6,0]`)
- Pille-Delay 25 ms; Touch-Linger 700 ms
- Keine Skalierung/Magnification der Icons messbar (Icon-Groesse konstant 16-19px Strichbox)

## Look-Tokens
- Buehne/Dock-Fuellung #1f1f1f; Rahmen #2b2b2b 1px (gemessen 25-2d); Schein unter dem Dock `0 8px 16px rgba(255,255,255,.04)` (Pixel unter dem Rand 25 -> 21, oben kein Schein)
- Icons #b3b3b3 (Strich ~176/255), Tooltip #f9f9f9, Pille #484848 (exakt gemessen)
- Radius Dock 16, Pille 12; Raster 49.1px; Dock-Padding 5.5/5.3px
- Tooltip-Text-Mitte ~21px ueber dem Dock-Rand; Font Inter/Geist/system 12px weight 500

## Interaktion & Barrierefreiheit
- Ausloeser: Hover (Maus) oder Beruehrung/Drag (Touch/Stift) ueber das Dock; Trefferzone = ganzes Raster (Position -> Index aus gecachtem Rect, nicht pro Item-Hit-Test)
- Touch: nach dem Loslassen bleibt der Zustand 700 ms stehen. Tastatur: Fokus (focus-visible) zeigt Tooltip + Pille, Rand-Outline
- `nav[aria-label]`, Items sind `<button aria-label>`, Tooltips `aria-hidden` (Name kommt vom aria-label); Klick feuert `dock:select`
- `prefers-reduced-motion`: Zustaende wechseln sofort, kein Aufstieg

## 120 Hz
- Eine rAF-Schleife mit Zeitstempel (dt <= 50 ms), schlaeft im Leerlauf. Opacity per exponentieller Glaettung, Tooltip-Y per Feder (semi-impliziter Euler, fester Substep 1/240 s per Akkumulator)
- Nur `opacity` und `transform: translate3d`; `will-change` nur waehrend der Animation; `contain: layout paint` am Wrapper (mit Polster fuer Tooltip/Schein); DOM-Writes nur bei Wertaenderung; pointermove nur gemerkt (getCoalescedEvents) und einmal pro Frame angewendet; Rect einmal pro Enter/Resize gemessen
- check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (p95 1.0 ms normal, 3.0 ms bei 4x Drosselung, 0 % ueber Budget, script 0.08 ms/Frame; INFO zu Layout-Lesezugriffen = die einmalige Messung im Event-Handler).

## Einbindung
`assets/dock.html`: `COMPONENT:START/END`, CSS-Block "COMPONENT CSS", Look-Variablen oben in `:root`, Motion in `DOCK_CONFIG`.
```js
const d = initDock(document.querySelector('.dk'), { tipInTauMs:38, tipOutTauMs:35, tipRiseFrom:6,
  tipSpring:{stiffness:1000,damping:38}, pillInTauMs:40, pillOutTauMs:45, pillDelayMs:25, touchLingerMs:700 });
dock.addEventListener('dock:select', e => console.log(e.detail.label));
```
Markup: `nav.dk` > `button.dk__item[data-label]` > `i.dk__pill` + `svg` (Tooltip-Span wird per JS aus `data-label` erzeugt). Weitere Items einfach anhaengen.

## Vermuteter Original-Stack -> React/Framer-Motion
```tsx
<motion.div className="flex rounded-2xl border border-white/10 p-1.5">
  {items.map(i => <button onMouseEnter={()=>setH(i.id)} onMouseLeave={()=>setH(null)} className="relative size-[49px] grid place-items-center">
    <AnimatePresence>{h===i.id && <>
      <motion.span className="absolute inset-0 rounded-xl bg-[#484848]" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.12}}/>
      <motion.span className="absolute -top-8 text-xs font-medium" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
        exit={{opacity:0}} transition={{type:"spring",stiffness:1000,damping:38}}>{i.label}</motion.span></>}
    </AnimatePresence><i.Icon/></button>)}
</motion.div>
```

## Kreativ remixen
1. Echtes Magnification: Icon-Skalierung nach Zeigerabstand (`scale = 1 + 0.8*exp(-d^2/2s^2)`), Nachbarn drumherum mitschieben; Feder stiffness 400/damping 20 fuer "Gummi"-Gefuehl.
2. Eine einzige Pille mit `layoutId`-Gleiten statt Ein-/Ausblenden (Feder 500/30) und Tooltip als Pille-Anhaengsel, das mitwandert.
3. Pille mit Akzent-Glow (`box-shadow` statisch, nur opacity animiert) und Icon-Mikro-Animation beim Hover (Herz pocht, Zahnrad dreht 90 Grad).
4. Dock am Bildschirmrand verstecken und per Edge-Hover aufspringen lassen (translateY 80 -> 0, Overshoot), Labels als Glas-Chips mit Blur.
5. Kombination mit Text-Morphing: das Tooltip-Label morpht zwischen den Items statt zu ueberblenden; oder Dock als Mobile-Tab-Bar mit Haptik-Impuls (Vibration) pro Itemwechsel.

## Bekannte Abweichungen (ehrlich)
- Das Video zeigt eine Touch-Aufnahme mit gezeichnetem Zeiger; der Hover-Zustand der Seite hinkt dem Zeiger teils 100-150 ms hinterher (z. B. "Profile" erscheint, waehrend der Zeiger schon bei Settings ist). Ob echtes `onMouseEnter` oder Touch-Hover-Emulation, ist nicht erkennbar.
- Beim ersten Eintritt (Home) erschien die Pille ~140 ms nach dem Tooltip, bei spaeteren Items fast gleichzeitig; im Nachbau nur 25 ms Delay. Ursache unklar. Kurzer Pille-Zustand "dunkler als Buehne" (Wert 29 statt 31) vor der Pille nicht erklaerbar, nicht nachgebaut.
- Pillen-Lift (-2.5px) und -Breite (50.5px) sind Messwerte; ein "Magnification"-Effekt war nicht messbar und fehlt.
- Icons sind Lucide-artig aus dem Gedaechtnis nachgezeichnet, Font Inter-Fallback (Original wirkte Roboto-artig); Textbreite ~ +-1px. Dock-Schein und Rahmenfarbe aus wenigen Pixeln geschaetzt.
- Tooltip-Exit nur grob gemessen (Opacity-tau ~35 ms, Position unveraendert); Feder-Werte aus 6 Y-Messpunkten gefittet.
