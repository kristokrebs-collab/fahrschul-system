---
name: befehlskarte
description: >-
  Zuordnung der Web-Design-, UI- und Content-Befehle aus dem All-in-One-Assistenten-Prompt auf die tatsächlich vorhandenen Skills: typography-system, spacing-rules, layout-composer, hero-section-crafter, accessibility-auditor, playwright-tester, motion-principles, color-harmony, /apple-design, /reel-schnitt, /linkedin-post, /claude-ads, /agent-reach, /graphify, /omniroute, /instagram-account-analyse, /gegenstand-scharf. Nutze, wenn einer dieser Namen genannt wird, damit Claude das passende vorhandene Werkzeug nimmt und ehrlich sagt, was es nicht gibt.
---

# Befehlskarte: Name → vorhandenes Werkzeug

Diese Namen stammen aus einem Sammel-Prompt ohne Quelle; es gibt dafür **keine eigenen Skills**. Nimm das Vorhandene und sage in einem Satz, welcher Teil fehlt.

| Name im Prompt | Nimm stattdessen |
|---|---|
| typography-system, spacing-rules, visual-hierarchy | Skill `frontend-design` (Typografie) |
| layout-composer, grid-systems, card-layouts, wireframe-builder | `responsive-design`, `design-system-generator` |
| hero-section-crafter, landing-page-planner | `pulse-motion` (Hero-Komponenten), `fk-premium-website` / `web-quality-suite-tablet:premium-webdesign` |
| interaction-patterns, motion-principles | `pulse-motion` (+ `references/principles-120hz.md`) |
| navigation-systems | `pulse-motion` (immersive-full-screen-navigation, dock) |
| form-ux-checker, accessibility-auditor, responsive-reviewer, prototype-reviewer | `web-design-guidelines`, Agent `a11y-architect`, `design:accessibility-review` |
| playwright-tester | Agent `e2e-runner` |
| css-architecture, design-token-manager, ui-component-library, tailwind-helper | `design-system-generator`, `pulse-motion` (Style-Tokens `--s-*`) |
| color-harmony | `pulse-motion` Style-Referenzen (10 Paletten), `anthropic-skills:theme-factory` |
| docs-lookup | MCP `context7` |
| figma-mcp | Figma-Konnektor (im Moment nicht verbunden) |
| /apple-design | `pulse-motion` Style `apple-espana` / `apple-foldable` |
| /reel-schnitt, /claude-ads, /linkedin-post, /agent-reach | **fehlt**; allgemein beantworten (Hook, Struktur, CTA), nichts als geprüfte Methode ausgeben |
| /graphify | `dataviz` |
| /gegenstand-scharf | **fehlt**; Bildbearbeitung über Adobe-Konnektor möglich, nur auf Wunsch |
| /instagram-account-analyse | **fehlt**; nur mit vom Nutzer gelieferten Exportdaten, kein Scraping |
| /omniroute | **unklar**; nachfragen, was gemeint ist |
