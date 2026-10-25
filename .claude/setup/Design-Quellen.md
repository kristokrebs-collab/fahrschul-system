# Design-Plattformen aus Deiner Liste: Befund (gelesen am 2026-10-25)

Gelesen wurden die öffentlichen Startseiten. Inhalte hinter Login (Galerien, Chats, Projekte) habe ich nicht gesehen.

| Plattform | Befund | Im Repo / was Du tun kannst |
|---|---|---|
| Magic UI | MIT-Lizenz, Quellcode auf GitHub gelesen | Skill `magic-ui` + 8 Effekte als Vanilla in `pulse-motion/assets/magic-primitives.html` |
| Uiverse | MIT-Lizenz, Archiv auf GitHub | Skill `uiverse-lookup`; Klon auf Deinem Rechner: `setup-claude-extras.sh uiverse` |
| **Aceternity UI** | „React-Komponentenbibliothek, 200+ Komponenten“. Free-Plan: 100+ Komponenten, **MCP-Zugang für Claude Code**; Pro: 169 $ (regulär 249 $) einmalig, 1 Jahr Updates für Blocks/Templates. Die AGB sagen: „alle Rechte vorbehalten“; eine Lizenz für die kostenlosen Komponenten steht dort **nicht** | **Kein Code kopiert.** Nutzen über deren eigenen Weg (CLI/MCP laut ihrer Doku) auf Deinem Rechner, nachdem Du die Lizenzbedingungen der kostenlosen Komponenten selbst geprüft hast. Unten: Zuordnung zu dem, was wir schon haben |
| Refero | Sammlung „zehntausender“ UI/UX-Screenshots; wirbt mit MCP-Anbindung für Agenten. Die Inhalte sind fremde Designs | nur Inspiration. Muster in Worten notieren, nicht nachbauen. Ob der MCP-Zugang etwas kostet, habe ich nicht geprüft |
| Godly | lieferte beim Abruf eine leere Seite (Weiterleitung/Schutz) | nicht gelesen. Kurationsseite fremder Designs, gleiche Regel wie Refero |
| v0 (Vercel) | Chat → Full-Stack-App („Use your ChatGPT plan in v0“), Registrierung nötig | Dienst, kein Quellcode zum Ziehen. Ablauf: dort prompten, Code exportieren, in Claude Code verfeinern |
| Bolt | KI-Builder für Websites/Apps, Anmeldung nötig | wie v0 |
| Lovable | Schutzseite („Just a moment…“), Seite nicht lesbar | nicht gelesen. Dienst, wie v0 |
| Flowstep | „Design-Canvas für Agenten“: mehrere Screens per Prompt, Export als Code oder Figma, **MCP-Verbindung zu Claude Code, Cursor, Codex, Windsurf**; Preise nicht gelesen | Dienst. MCP wäre eine neue Verbindung: erst klären, ob Du sie willst (`CLAUDE.md`) |

## Aceternity: was wir schon haben (Zuordnung, ohne deren Code)
| Aceternity-Komponente (Name) | Vorhanden bei uns |
|---|---|
| Meteors, Shooting Stars | `magic-primitives` (Meteors) |
| Background Ripple Effect | `magic-primitives` (Ripple) |
| Moving Border, Hover Border Gradient, Glowing Effect | `border-beam` |
| Infinite Moving Cards | `magic-primitives` (Marquee) |
| Floating Dock | `dock` |
| Text Generate Effect, Typewriter, Flip Words | `text-animate`, `text-morphing` |
| Aurora Background, Gradient Animation | `magic-primitives` (Aurora Text), `thinking-orbs` (andere Optik) |
| Expandable Card, Draggable Card | `draggable-widget-grid`, `notched-project-card` |
| Parallax Scroll, Hero Parallax | `parallax-strip-slider`, `slanted-spread-hero` |
| Floating Navbar, Navbar Menu | `immersive-full-screen-navigation` |
| 3D Card Effect, Spotlight, Lamp, Canvas Reveal, Vortex, Shaders | nicht vorhanden (offen, wenn Du sie willst: eigener Nachbau nach Aussehen, nicht nach deren Code) |
