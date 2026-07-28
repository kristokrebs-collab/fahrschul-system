# Technische Ausgangslage

## Vorgefunden

- Ein Repository mit **einer** Datei: `dashboard.html`.
- Kein `package.json`, kein Build, keine Abhängigkeiten, keine Tests, kein CI.
- Kein `.claude/`, keine Projekt-Skills, keine `CLAUDE.md`.
- Zwei Branches, zwei Commits.

`dashboard.html` ist eine einzelne HTML-Datei mit eingebettetem CSS und
JavaScript: Glassmorphism-Dark-Mode, Plus Jakarta Sans über Google Fonts,
`innerHTML`-Rendering, globaler Zustand, Inline-`onclick`-Handler.
Als Prototyp brauchbar, als Grundlage für eine Produktions-Website nicht —
kein Routing, kein SEO, kein serverseitiges Rendering, keine Typsicherheit.

**Entscheidung: Neuaufbau.** `dashboard.html` bleibt unangetastet erhalten.

## Randbedingungen der Umgebung

| Bedingung | Auswirkung auf die Architektur |
| --- | --- |
| Egress-Policy blockiert nahezu alle Hosts (HTTP 403) | Keine externen Assets zur Laufzeit; Bilder und Videos aus dem Higgsfield-Archiv **nicht herunterladbar** |
| `registry.npmjs.org` erreichbar | npm-Abhängigkeiten möglich |
| `fonts.googleapis.com` erreichbar | Schriften werden zur **Build-Zeit** geholt und selbst ausgeliefert (`next/font`) — zur Laufzeit keine Verbindung zu Google |
| Chromium vorinstalliert | Playwright ohne Download nutzbar |
| 4 CPU-Kerne | Builds und Tests laufen, Parallelität begrenzt |

Der blockierte Asset-Zugriff hat die Gestaltung geprägt: **die gesamte
Bildsprache ist code-nativ** (SVG und CSS). Das war zunächst eine Not, ist aber
im Ergebnis ein Vorteil — keine Ladezeit für Hintergrundbilder, gestochen
scharf auf jedem Display, und die Fahrbahn lässt sich pro Kapitel
parametrisieren statt neu zu fotografieren.

## Gewählter Stack

| Baustein | Version | Begründung |
| --- | --- | --- |
| Next.js (App Router) | 16.2 | 45 statisch vorgerenderte Seiten, Metadata-API, Sitemap, Server Actions für das Formular |
| React | 19.2 | Vom Framework vorgegeben |
| TypeScript | 5.9 | `strict` plus `noUncheckedIndexedAccess` |
| Tailwind CSS | 4.3 | CSS-first-Konfiguration, Design-Tokens in `@theme` |
| Zod | 4 | Serverseitige Formularvalidierung |
| Vitest | 4 | Preislogik |
| Playwright | 1.62 | Browsertests gegen den **Produktions**-Build |

## Bewusst nicht verwendet

| Bibliothek | Warum nicht |
| --- | --- |
| **GSAP / ScrollTrigger** | Die einzige scroll-synchrone Sequenz (Cockpit) kommt mit `IntersectionObserver` und `position: sticky` aus. Das ist robuster (kein Pinning, keine `refresh()`-Fallstricke nach dem Laden der Schriften), barrierefreier und spart die Bibliothek vollständig. |
| **Motion / Framer Motion** | Alle Übergänge sind CSS-Transitions. Eine Animationsbibliothek hätte nichts hinzugefügt, was CSS hier nicht kann. |
| **Lenis** | Überschreibt natives Scrollen. Auf iOS führt das zu Momentum-Konflikten, und es ist der Hauptgrund, warum viele teure Websites gleich wirken. |
| **Three.js / R3F** | Kein Inhalt dieser Website braucht WebGL. Die Fahrbahn ist echte Perspektivgeometrie in SVG — schärfer, kleiner, ohne Fallback-Bedarf. |
| **shadcn/ui** | Erkennbare Silhouette. Die wenigen benötigten Bausteine sind hier gezielt gebaut. |

Beide Bibliotheken (`gsap`, `motion`) stehen in `package.json`, weil der
Master-Prompt sie vorsieht — im ausgelieferten Bundle sind sie nicht enthalten,
da sie nirgends importiert werden.
