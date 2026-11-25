---
name: frontend-motion-system
description: Nutze diesen Skill für React Bits, GSAP, ScrollTrigger, Parallax, Transitions, modale Animationen und Mikrointeraktionen.
---

# UI-Animationen und Frontend-Motion

**Kategorie:** design

## Ablauf
1. Technologie prüfen (React/Vue/HTML, Build, Lizenzen, Browser- und Leistungsbudget).
2. Nach Bedeutung animieren: Feedback, Orientierung, Hierarchie; keine rein dekorativen Endlosschleifen ohne Nutzen.
3. Geeignete Bausteine gezielt prüfen: React Bits Komponenten, GSAP Skills für komplexe Timelines, transitions.dev für UI-Wechsel.
4. `prefers-reduced-motion`, Tastaturbedienung, Fokus, Mobile-GPU, CLS und LCP berücksichtigen.
5. Ein neues Motion-Pattern zunächst isoliert bauen, dann im Browser auf Touch/Desktop testen.
6. Keine umfangreichen Dependencies nur wegen eines einzelnen Effekts hinzufügen.
## Ergebnis
Motion-Spezifikation (Trigger, Dauer, Easing, State), Codeplan, Fallback, Performance- und A11y-Check.
## Quellen
- [React Bits](https://github.com/DavidHDev/react-bits)
- [GSAP Skills](https://github.com/greensock/gsap-skills)
- [Transitions.dev](https://transitions.dev)

## Qualitäts- und Sicherheitsregel
Wenn eine genannte API, ein Tool, Account oder ein Zugang fehlt, simuliere keine aktive Verbindung. Zeige einen getesteten nächsten Schritt, markiere fehlende Zugriffe und fordere nötige externe Freigaben nur gezielt an. Fremdcode niemals ungelesen ausführen.
