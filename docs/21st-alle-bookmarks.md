# Alle 24 Bookmarks — CLI-Befehle & Direktlinks

**Warum du das ausführen musst, nicht ich:** 21st.dev ist von meiner Umgebung aus
gesperrt (Proxy antwortet 403), und `npx shadcn add` ruft genau diesen Host auf.
Mein MCP-Kontingent ist heute erschöpft (0 von 2).

**Schnellster Weg für dich:** Link öffnen → „Copy code" → hier reinpasten.
Dann portiere ich mechanisch 1:1. Der CLI-Befehl tut dasselbe, braucht aber ein
React-Projekt — unser Build ist Vanilla, also ist Copy-Paste sogar der direktere Weg.

`$API_KEY_21ST` ist dein Schlüssel aus der MCP-Konfiguration.

---

## ✅ Bereits vorhanden — nicht nötig
| Komponente | Quelle |
|---|---|
| Hero Scrub (12213) | über MCP geholt |
| Liquid Metal Button (10443) | über MCP geholt |
| Interactive Image Accordion (5189) | von dir eingefügt |
| Minimalist Hero (4582) | von dir eingefügt |

---

## ⏳ Noch benötigt — 20 Stück

### Priorität 1 — trägt die Startseite
```bash
npx shadcn@latest add "https://21st.dev/r/isaiahbjork/reveal-text?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/manuarora700/container-scroll-animation?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/designali-in/shiny-button?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/ibelick/dock?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/minhxthanh/animated-glowing-search-bar?api_key=$API_KEY_21ST"
```
· https://21st.dev/@isaiahbjork/components/reveal-text → Hero-Headline
· https://21st.dev/@manuarora700/components/container-scroll-animation → Cockpit-Showcase
· https://21st.dev/@designali-in/components/shiny-button → sekundäre CTAs
· https://21st.dev/@ibelick/components/dock → Navigation
· https://21st.dev/@minhxthanh/components/animated-glowing-search-bar → Führerschein-Finder

### Priorität 2 — Kapitel & Interaktion
```bash
npx shadcn@latest add "https://21st.dev/r/isaiahbjork/gradient-selector-card?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/mapcn/mapcn-marker-popup?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/aghasisahakyan1/section-with-mockup?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/bucharitesh/view-magnifier?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/reuno-ui/hero?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/mdafsarx/hover-footer?api_key=$API_KEY_21ST"
```
· https://21st.dev/@isaiahbjork/components/gradient-selector-card → Klassen-/Preisstufen-Wahl
· https://21st.dev/@mapcn/components/mapcn-marker-popup → Standorte Fulda / Bad Hersfeld
· https://21st.dev/@aghasisahakyan1/components/section-with-mockup → Simulator
· https://21st.dev/@bucharitesh/components/view-magnifier → Fahrzeug-Detail
· https://21st.dev/@reuno-ui/components/hero → Abschluss-Kapitel (Paper-Shader)
· https://21st.dev/@mdafsarx/components/hover-footer → Footer

### Priorität 3 — Unterseiten & Feinschliff
```bash
npx shadcn@latest add "https://21st.dev/r/jatin-yadav05/minimal-dock?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/meschacirung/hero-section-2?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/aghasisahakyan1/sign-in-flow-1?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/jatin-yadav05/morphing-cursor?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/chetanverma16/animated-tabs?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/cult-ui/feature-carousel?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/designali-in/shader-animation?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/aghasisahakyan1/animated-profile-card?api_key=$API_KEY_21ST"
npx shadcn@latest add "https://21st.dev/r/waleedkibhen/image-auto-slider?api_key=$API_KEY_21ST"
```
· minimal-dock → Unterseiten-Navigation
· hero-section-2 → Unterseiten-Hero
· sign-in-flow-1 → Cockpit-Login-Teaser
· morphing-cursor → globaler Cursor
· animated-tabs → Team-Filter (Auto / Zweirad / Lkw & Bus / Büro)
· feature-carousel → Digitalpaket
· shader-animation → Hintergrund Abschluss-Kapitel
· animated-profile-card → Team-Portraits
· image-auto-slider → regionale Prüfungsvideos

---

## Drei Wege — such dir den bequemsten aus

1. **Copy-Paste (empfohlen, kostenlos)** — Link öffnen, Code kopieren, hier einfügen.
   Gern mehrere auf einmal.
2. **CLI lokal** — Befehle oben in einem React-Projekt ausführen, dann die erzeugten
   Dateien aus `components/ui/` hier reinpasten.
3. **21st.dev upgraden** — dann hole ich den Rest selbst über MCP,
   ohne dass du etwas kopieren musst. https://21st.dev/pricing
