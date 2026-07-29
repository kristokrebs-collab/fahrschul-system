# Alle 24 Bookmarks — Nachweis, wo jedes einzelne sitzt

Stand 29.07. · Datei `index.html` · geprüft bei 390 / 768 / 1024 / 1440 / 1920 px,
kein horizontaler Überlauf, Konsole ohne Fehler.

**Quelle** sagt, woher die Mechanik stammt:
· **Original** = Quellcode lag vor (MCP `get_component` oder von dir eingefügt) → Werte 1:1
· **Abgeleitet** = nur der CLI-Befehl lag vor, `21st.dev` ist aus dieser Umgebung
  gesperrt (403) und das MCP-Kontingent ist aufgebraucht (`get_usage`: 0 von 2).
  Mechanik und Maße stammen aus der Komponentenbeschreibung, nicht aus ihrem Quelltext.

| # | Komponente | Autor | Einbauort | Quelle |
|---|---|---|---|---|
| 12213 | Hero Scrub | jean.duthil13 | Kapitel 01 — Frame-Scrub des Heros | **Original** |
| 10443 | Liquid Metal Button | johuniq | Primär-CTAs (Kapitel 07 + 09) | **Original** |
| 5189 | Interactive Image Accordion | minhxthanh | Kapitel 02 — Fahrzeugwelten | **Original** |
| 4582 | Minimalist Hero | ravikatiyar162 | Kapitel 06 — Handicap | **Original** |
| 2591 | Animated Glowing Search Bar | minhxthanh | Kapitel 02 — Klassen-Finder | Abgeleitet |
| 1913 | Section With Mockup | aghasisahakyan1 | Kapitel 03 — Cockpit-Schaufenster | Abgeleitet |
| 2520 | Gradient Selector Card | isaiahbjork | Kapitel 04 — Ausbildungswege | Abgeleitet |
| 2491 | Reveal Text | isaiahbjork | 7 Kapitel-Überschriften | Abgeleitet |
| 1081 | Container Scroll Animation | manuarora700 | Kapitel 03 — App im Desktop-Rahmen | Abgeleitet |
| 5508 | Shiny Button | designali-in | Sekundär-CTAs (Kapitel 07 + 09) | Abgeleitet |
| 990 | Dock | ibelick | Schwebende Navigation ab Kapitel 02 | Abgeleitet |
| 3226 | Minimal Dock | jatin-yadav05 | Kapitel 03 — Navigation der App | Abgeleitet |
| 13966 | MarkerPopup | mapcn | Kapitel 08 — Standortkarte | Abgeleitet |
| 4559 | View Magnifier | bucharitesh | Kapitel 02 — Fahrzeug-Detail | Abgeleitet |
| 2497 | Image Auto Slider | waleedkibhen | Kapitel 02 — Fahrzeug-Laufband | Abgeleitet |
| 3052 | Feature Carousel | cult-ui | Kapitel 03 — Digitalpaket | Abgeleitet |
| 525 | Animated Tabs | chetanverma16 | Kapitel 05 — Bereichsfilter | Abgeleitet |
| 8341 | Animated Profile Card | aghasisahakyan1 | Kapitel 05 — Ausbildungsbereiche | Abgeleitet |
| 1825 | Hero Section 2 | meschacirung | Kapitel 07 — Ferienfahrschule | Abgeleitet |
| 2049 | Sign In Flow | aghasisahakyan1 | Kapitel 03 — Cockpit-Zugang | Abgeleitet |
| 5625 | Shader Animation | designali-in | Kapitel 09 — Ripple-Hintergrund | Abgeleitet |
| 5649 | Hero (Paper Shader) | reuno-ui | Kapitel 09 — Papier-Verlauf | Abgeleitet |
| 8687 | Hover Footer | mdafsarx | Footer | Abgeleitet |
| 9643 | Morphing Cursor | jatin-yadav05 | Global (ab 900 px, Zeigergeräte) | Abgeleitet |

**24 von 24 verbaut.** Automatisch nachgezählt beim Rendern:
Accordion 5 Kacheln · Meilensteine 4 · Dock 6 Symbole · App-Dock 4 · Karussell 4 Ebenen ·
Tabs 5 · Bereichskarten 5 · Zugangsfelder 6 · Laufband 10 Bilder (2 × 5) ·
Reveal-Überschriften 7 · Standort-Popups 2 · Ripple-Canvas aktiv.

---

## Warum 20 Stück „abgeleitet" sind — belegt, nicht behauptet

| Versuch | Ergebnis |
|---|---|
| `npx shadcn@latest add "https://21st.dev/r/…"` | ruft `21st.dev` auf → Proxy verweigert (403) |
| `curl https://21st.dev/…` | 403 |
| WebFetch | 403 |
| MCP `get_component` | Free-Tier 2 Abrufe/Tag, `get_usage` meldet 0 übrig |

Die vier mit **Original** markierten Komponenten sind die, für die der Code
tatsächlich vorlag: zwei über MCP geholt (bevor das Kontingent leer war), zwei
hast du selbst eingefügt.

**Wenn du die restlichen Originalquellen haben willst:** Auf der jeweiligen
Bookmark-Seite „Copy code" drücken und hier einfügen — dann gleiche ich die
Zahlenwerte an. Der Einbauort bleibt in jedem Fall derselbe, es ändern sich nur
Dauer, Easing und Maße. Alternativ 21st.dev upgraden, dann hole ich den Rest selbst.

---

## Das Cockpit ist kein Nachbau

Kapitel 03 zeigt **echte Screenshots der App aus diesem Repo**, nicht nachgezeichnete
Oberflächen:

| Datei | Quelle | Größe |
|---|---|---|
| `assets/media/app-cockpit-mobile.jpg` | `krebs-cockpit-mobile.html`, 390 × 844 bei 2× | 101 KB |
| `assets/media/app-cockpit-desktop.jpg` | `krebs-cockpit-pro.html`, 1400 × 880 bei 1,6× | 207 KB |

Erneuern lassen sie sich mit `assets/screenshot-app.sh`.
