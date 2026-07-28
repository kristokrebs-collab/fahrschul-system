# Design-Recherche

## Umfang

**101 Muster** aus sieben parallelen Recherchesträngen, deutlich über den
geforderten 25. Quellen: der Komponentenkatalog von **21st.dev**, die Jury-
Begründungen von **Awwwards**, **FWA** und **CSS Design Awards**,
**Codrops**, die Produktseiten und Konfiguratoren von **Porsche, Audi,
Polestar, Lucid und Cartier**, sowie die W3C-Muster und WCAG-Kriterien für
Formulare und Statusmeldungen.

| Entscheidung | Anzahl |
| --- | --- |
| Übernehmen | 38 |
| Anpassen | 45 |
| Verwerfen | 18 |

Ein Komponentenkatalog ist ein Steinbruch, kein Fertighaus: Übernommen wurden
**Prinzipien**, kein einziges Layout und keine Animationssequenz im Ganzen.

## Die fünf Erkenntnisse, die die Website geprägt haben

**1. Gescrubbt und aufgedeckt trennen.** Die teuren Websites, die *nicht* nach
Scroll-Hijacking wirken, sind die, bei denen rund 80 % der Seite ganz normal
scrollt und Pinning streng rationiert ist. Empfohlene Obergrenze: 250–300 vh
gepinnte Strecke auf der gesamten Seite.
→ *Diese Website: 0 vh.* Das Cockpit nutzt `sticky` plus `IntersectionObserver`,
die Seite scrollt durchgehend normal weiter.

**2. Die Jury-Gewichtung hat sich verschoben.** Die Rubriken für 2026 gewichten
Performance und Bedienbarkeit über die reine Optik. Awwwards rechnet Design 40 /
Usability 30 / Kreativität 20 / Inhalt 10.
→ *Diese Website: keine Bilder, LCP 1,3 s unter vierfacher Drosselung, keine
animierte LCP-Zone.*

**3. Es gibt eine erkennbare Silhouette von KI-generierten Seiten.** Wortweise
eingeblendete Absätze, der 3-D-Kipprahmen um einen Screenshot, Aurora-Verläufe,
Partikelfelder, Marquees als Füllmaterial — alles davon liest sich als „Vorlage",
bevor ein Wort gelesen wurde.
→ *Alle fünf ausdrücklich verworfen.*

**4. Der Gewinner der Kategorie war eine Dienstleisterseite.** „Don't Board Me"
gewann Awwwards Site of the Year Usability — eine praktische lokale
Dienstleistung, die durch Klarheit gewann, nicht durch Spektakel. Das ist die
näherliegende Vergleichsgröße für eine Fahrschule als jede WebGL-Demo.

**5. Automotive liefert die Disziplin, nicht die Bildsprache.** Ein einziger
Akzent als Bedeutungsträger, eine Lichtquelle, technische Werte als
typografische Hierarchie, eine Entscheidung pro Bildschirm im Konfigurator.
Übernommen. Der Beauty-Shot mit 360°-Rotator und das autoplayende Filmintro:
verworfen — das wäre eine Autowerbung, die mit dem Geschäft nichts zu tun hat.

## Unmittelbare Konsequenzen im Code

| Erkenntnis | Umsetzung |
| --- | --- |
| Pinning rationieren | `sticky` + `IntersectionObserver` statt ScrollTrigger; GSAP gar nicht importiert |
| Aktive Passage nach Nähe zur Bildschirmmitte wählen | Verhindert, dass das Gerät beim schnellen Scrollen hinterherhinkt |
| Reduzierte Bewegung darf keine Leerflächen erzeugen | Abstände kollabieren statt nur die Animation abzuschalten |
| Disclosure statt Hover-Menü (W3C APG) | `aria-expanded`, Escape, Klick außerhalb, nichts nur per Hover |
| Ehrlicher Fortschritt: fester, nie schrumpfender Nenner | Finder zeigt „3 / 6", nicht eine mitwachsende Skala |
| Gleiche Mengen für beide Angebote | Kern des Preisrechners |
| Fremdgebühren getrennt ausweisen | Vier Kostentöpfe im Ausbildungsablauf und auf `/preise` |
| Statusmeldungen nach WCAG 4.1.3 | `aria-live` für die Summen, `role="alert"` für Formularfehler |
| Korn als Mittel gegen Banding, nicht als Effekt | Ein statisches, fixiertes Kompositlayer |

## Verworfen — und warum das wichtig ist

Diese 18 Muster wären alle leicht umzusetzen gewesen und hätten die Seite
schlechter gemacht:

Gepinnte Horizontalgalerie (achsenverwirrend, tastaturfeindlich, kollidiert mit
der iOS-Zurück-Geste) · Geschwindigkeits-Skew (signalisiert Kontrollverlust —
für eine Fahrschule genau die falsche Botschaft) · 3-D-Kipprahmen (die meist
geklonte Scroll-Komponente überhaupt) · Partikelfeld · Aurora-Verlauf ·
Vollbild-Shader · automatisch rotierendes Gerätekarussell · Cursor-Tilt ·
Frame-Sequenz auf Canvas (LCP-Killer) · Scramble-Typografie · Neobrutalismus ·
„Wir gegen die anderen"-Vergleichskarte (unbelegbar und unfair) ·
Beauty-Shot-Rotator · autoplayendes Filmintro · Marquees · Scroll-Jacking ·
Novelty-Navigation · das Übernehmen fertiger Katalogkomponenten als solche.

## Vollständige Matrix


### Scroll & Erzählung

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Pinned canvas image-sequence scrub ("Apple product page" hero) | **anpassen** | This is the one place where the metaphor can be literal instead of decorative: a windscreen POV shot of an actual Krebs training car pulling out of th |
| Sticky media column with stepping text (scrollytelling two-column) | **übernehmen** | This is the workhorse for "der Weg vom Wunsch zum Führerschein". Sticky side = a single map/route illustration where a marker advances along a drawn l |
| Scroll-driven SVG path draw (route line drawing itself) | **übernehmen** | The single strongest carrier of the brief's core metaphor and the least generic thing on this list. The path *is* the route: a stylised road from "Wun |
| Vertical progress beam timeline with milestone nodes | **anpassen** | This is the honest, information-dense counterpart to the cinematic hero — the place where the route metaphor pays rent. Nodes become the statutory mil |
| Scroll-driven media expansion (small frame grows to full-bleed) | **anpassen** | Maps precisely onto one narrative beat and one only: the transition from *looking at* driving to *doing* it. The small frame is a windscreen seen from |
| Word-by-word / line-by-line reading reveal | **anpassen** | Reserve it for the one sentence the whole site rests on — the promise (e.g. "Vom ersten Gedanken bis zum Führerschein begleiten wir dich auf jedem Met |
| Pinned image tunnel / zoom-through sequence | **anpassen** | The one effect whose *native* sensation is "moving forward on a road". Used as the gallery of the fleet, the classroom, the instructors and the town,  |
| Sticky stacking cards (cards pile up in place) | **übernehmen** | The literal reading is the right one: things that accumulate on the way to a Führerschein. Each card is a completed requirement (Sehtest, Erste-Hilfe- |
| Persistent scroll-progress indicator as a domain instrument | **übernehmen** | The obvious and correct move is to render it as a car instrument rather than a web progress bar: a speedometer-style arc, or better, a fuel/Tacho gaug |
| Scroll-linked grayscale-to-colour / focus mask | **anpassen** | Two genuinely meaningful uses. First, as a before/after: the nervous first-lesson state renders desaturated and slightly blurred, and resolves to shar |
| Scroll-driven cross-fade sequence (scroll-controlled slideshow) | **anpassen** | The correct replacement for a testimonial carousel — student quotes with faces that change as you scroll past, at the user's pace, with no timer racin |
| Pinned horizontal panels (vertical scroll drives sideways travel) | **verwerfen** | Very high. The pinned horizontal gallery is *the* signature move of 2020-2023 agency portfolios and is now shorthand for "we bought a template with GS |
| Scroll-velocity kinetics (skew, speed-reactive marquee, drag-lag) | **verwerfen** | High. Velocity-skew was the defining Awwwards tic of 2021-2022 and now dates a site precisely. Velocity-reactive marquees are in every second template |
| 3D perspective tilt on scroll (rotateX card that flattens) | **verwerfen** | Maximum. Aceternity's Container Scroll Animation is one of the most-cloned components in the entire shadcn ecosystem and its silhouette — a tilted bro |
| Momentum smooth-scroll layer (Lenis) under the narrative | **anpassen** | Defensible on brand terms, not just aesthetic ones: a slight, well-damped inertia is what a well-maintained car feels like, and it is the difference b |

### App-Präsentation

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Sticky Device Stage + Scrolling Copy Column | **anpassen** | This is the natural home for the Schüler-Cockpit chapter. The left column can carry the four `detail` bullets from digital-package.ts (Ausbildungsfort |
| Screen-as-Viewport: inner track moved by transform, never by a scrollb | **übernehmen** | The cockpit content is long (progress across all Stationen, Termine, Unterlagen, offene Aufgaben, Rückmeldungen). It genuinely needs vertical travel i |
| Declarative Device Frame as a CSS/SVG shell with a content slot | **anpassen** | Fahrschule Krebs is a local, plain-spoken business; a hyperreal titanium iPhone render would look borrowed. A restrained, brand-tinted frame (dark bez |
| Scroll progress as an animation timeline (scrub), never as an input to | **übernehmen** | The cockpit story is a sequence of factual claims, and each claim has a matching screen. Binding screen index strictly to scroll progress means a visi |
| Frame-sequence scrub (Apple's literal technique: canvas + image sequen | **verwerfen** | Not generic — it is the opposite problem. It is so expensive and so associated with Apple that a small driving school reproducing it reads as imitatio |
| Perspective settle: device enters tilted in 3D and flattens as it arri | **anpassen** | Useful once, at the moment the cockpit chapter opens, to mark it as a distinct object rather than another content card. It gives the page one premium  |
| Chapter rail: a visible progress indicator alongside the scrubbed sequ | **übernehmen** | With four cockpit claims and a preview status to communicate, a rail lets a visitor jump straight to the claim they care about (e.g. Termine) rather t |
| Tabs-bound feature switcher (explicit control instead of scroll) | **übernehmen** | Strong candidate as the *primary* implementation and the scrub as the enhancement layered on top. A prospective Fahrschüler comparing schools is task- |
| Mobile scroll-snap card rail (the phone-free substitute for the pinned | **übernehmen** | This is the mobile answer for the cockpit chapter, and mobile is where most Fahrschüler traffic will land. It also gracefully handles the 'vorschau' c |
| Bento grid of cockpit surfaces (the static, indexable base layer) | **übernehmen** | Two concrete wins. First, it is the honest presentation of a `vorschau` product: separate tiles do not imply a single shipped app the way one polished |
| Card / notification deck as UI evidence, with no device frame at all | **anpassen** | Directly applicable to 'Rückmeldung nach jeder Fahrstunde' — a single, legible feedback card with a real instructor comment is far more persuasive tha |
| Auto-rotating device carousel with prev/next/pause | **verwerfen** | Maximum. Auto-rotating phone carousel is the default app-landing-page component and reads as a template on sight. |
| Cursor-tilt / 3D device rotate | **verwerfen** | High and dated — mouse-tracking tilt with a glow reads as 2022 portfolio. |
| Pinned horizontal track (vertical scroll drives sideways travel) | **verwerfen** | High, and increasingly read as dated rather than premium. |
| Frame vocabulary consistency: one device grammar across the whole site | **übernehmen** | Krebs will plausibly show several surfaces: the cockpit preview, the online Voranmeldung, the Theorie booking, the Simulator. Only the cockpit is phon |

### Hintergrund & Material

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Full-screen WebGL shader field (Paper Shaders / 21st Shader Builder re | **verwerfen** | Catastrophic. The catalogue is saturated with six Paper Shaders recipes (Mesh Gradient, Mesh Drift, Warp, Halftone, Smoke, Metaballs) that dozens of u |
| Mesh-gradient / aurora blob background (CSS gradients + heavy blur) | **verwerfen** | The single most exhausted background pattern on the web, and the Aceternity/Framer variants are recognisable on sight. Multi-hue versions (purple/cyan |
| SVG feTurbulence grain overlay (fixed, non-animated) | **übernehmen** | Use — this is already the right call in src/components/brand/atmosphere.tsx. The change that turns it from generic texture into road surface: make the |
| Grain-dithered gradient (noise as the cure for banding, not as decorat | **übernehmen** | Use — it is the enabling technique for everything else here, because #060708 → #16191d over 900px is precisely the case that bands. Applied to Krebs:  |
| Animated / flickering grid background | **anpassen** | Adapt, and the adaptation is already half-built in roadway.tsx: replace the orthogonal lattice with a projected lattice. A uniform grid says 'blueprin |
| Dot pattern / dot grid field | **anpassen** | Adapt narrowly, or drop. Two legitimate translations: (1) retroreflective road studs — dots placed only on the lane-divider path, at the perspective-c |
| Cursor spotlight / reveal-on-hover light | **anpassen** | Adapt — this is the highest-value adaptation available, because a headlight is the correct metaphor and nobody ships it. Required changes: (1) ellipse |
| God rays / volumetric light beams / lamp | **anpassen** | Adapt only by discarding the rays. A brake light in humid night air produces no rays — it produces a hard-edged saturated core with a very steep fallo |
| Particle field / starfield / connected-node network | **verwerfen** | Maximum. There is no configuration of this pattern that a visitor will not have seen on a token launch page. |
| Progressive / edge blur and mask-image depth fade | **anpassen** | Adapt, with a strict budget. Two on-brand uses: (1) atmospheric perspective — the horizon band in roadway.tsx should lose acuity as well as contrast,  |
| Scroll-driven SVG path draw / marquee along an SVG path | **übernehmen** | Use — the strongest genuinely on-brand pattern in the entire catalogue for this brief, and the one that makes the site specifically a Fahrschule rathe |
| Beam/streak travelling along a border or line (border beam, grid beam, | **anpassen** | Adapt, extremely sparingly — as an indicator (Blinker), which is the one automotive light that is inherently a travelling repeated signal. Required ch |
| Scroll-scrubbed canvas image sequence hero (cinematic scrub) | **anpassen** | Adapt only if real Krebs footage exists; otherwise reject rather than substitute stock. This is the honest answer to 'living but controlled': the atmo |

### Navigation & Typografie

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Disclosure-pattern mega menu (button + aria-expanded, not role=menu) | **übernehmen** | Exactly the right chassis for the existing four-section nav (Führerschein / Beruf & Seminare / Ausbildung / Fahrschule) in src/content/navigation.ts.  |
| Single morphing panel container with layout-animated content swap | **anpassen** | The Führerschein panel (many classes, 3 columns + feature card) and the Fahrschule panel (2 short columns) are wildly different sizes. A morphing cont |
| Feature cell / editorial promo inside the mega panel | **übernehmen** | Already present as NavSection.feature and it is the single most important discoverability device for the ~30-page catalogue: a 17-year-old who does no |
| Scroll-state header (contrast shift) rather than hide-on-scroll | **anpassen** | Krebs pages are long chaptered scroll narratives (hero → finder → route → cockpit → simulator → calculator). Persistent navigation is exactly the case |
| Full-screen mobile overlay with accordion sections and scroll lock | **übernehmen** | Teenagers are the mobile-dominant audience and arrive without vocabulary for licence classes. A wall of ~35 links does the most damage here, so accord |
| Command palette / site-wide search as the escape hatch for a 30-page c | **anpassen** | Highest-leverage discoverability addition available. Three audiences use three vocabularies for one catalogue: a teen types 'Roller', a parent types ' |
| Mask-based line/word text reveal on scroll | **anpassen** | The site is structured as chapters (hero, finder, route, cockpit, simulator, calculator). One restrained reveal per chapter headline gives the premium |
| Scroll-velocity kinetic marquee | **anpassen** | Justifiable exactly once — a texture band between chapters or above the footer carrying class codes (B · BF17 · B197 · BE · A · CE · D) as atmosphere  |
| Cinematic curtain-reveal footer with oversized wordmark | **anpassen** | Strong fit with the existing 'finish line' hairline in site-footer.tsx — the route motif reaching its end. A restrained curtain reveal plus an oversiz |
| Fat footer as mini-sitemap plus verified contact block | **übernehmen** | Directly resolves the 'discoverable without a wall of links' tension by SPLITTING the job: the header uses disclosure + hints + a guided finder for pe |
| Breadcrumbs with BreadcrumbList structured data | **übernehmen** | The catalogue is deep enough that a visitor landing from Google on /fuehrerschein/ce needs to know CE lives under LKW under Führerschein, and needs a  |
| Animated underline / directional link hover for nav and footer links | **übernehmen** | Gives the header, mega-menu items and footer a consistent, restrained interaction language across all 30 pages with no per-page work. It is the counte |
| Audience self-identification entry point (teen / parent / business) | **anpassen** | The cleanest resolution of the three-audience problem. The primary nav stays a narrow four-item structure organised by SERVICE (which everyone can par |
| Persistent mobile action bar (call / consult) docked to the bottom | **anpassen** | Krebs pages are long scroll narratives with the conversion at the very end. A docked action bar keeps the phone number reachable at any scroll depth o |
| Character-scramble / particle / glitch typography | **verwerfen** | Paradoxically both generic (on every third portfolio site) and off-brand. Worst of both. |
| Novelty navigation shells (liquid morph pill, infinite 3D menu, fluid  | **verwerfen** | High and rising — liquid-glass morphing navigation is the 2026 equivalent of the parallax hero. It will date within a year, on a site meant to last. |

### Preisgekrönte Websites

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Igloo Inc — one controlling metaphor, shipped on a performance budget | **anpassen** | Krebs already has an available metaphor — the road/route from Anmeldung to Führerschein, and the cockpit. The lesson is that ONE metaphor must govern  |
| Don't Board Me — the practical local-service site that beat the experi | **übernehmen** | This is the single closest structural analogue to Fahrschule Krebs — a local, appointment-based, trust-driven service business where the conversion is |
| Lusion cork-coaster launch — treating a mundane object with flagship g | **anpassen** | A driving school's 'products' are mundane — a training car, a Prüfbescheinigung, a plastic Führerschein card, a set of keys. The cockpit-showcase chap |
| Iventions — lighting as the craft, GSAP as pacing, page as guided walk | **anpassen** | Krebs's licence classes (B, BE, A, AM, Mofa …) are currently card-grid material. The Iventions move is to spotlight one class at a time as a considere |
| By-Kin — the four-jury sweep as a robustness benchmark | **übernehmen** | Use this as the acceptance test rather than a visual reference: would this page score well if judged separately on design, on engineering, on innovati |
| IVRESS — WebGPU renderer with a WebGL fallback (tiered fidelity) | **anpassen** | WebGPU is overkill for a driving school. The transferable idea is tiered fidelity as an architectural decision: DOM/CSS baseline → CSS-enhanced → canv |
| Cartier / Shopify / Primland / Cult of the North — scroll as sequencer | **übernehmen** | The licence-route chapter is literally a route: Anmeldung → Theorie → Praxis → Prüfung → Führerschein. Entrance/hold/exit maps one-to-one onto those s |
| B-EGG Farm — total commitment to an unglamorous subject | **übernehmen** | The strongest argument against making Fahrschule Krebs look like a SaaS company. The assets are the specifics: Am Bahnhof 3 in Fulda, the actual theor |
| Jeton — dense informational product made to feel premium | **übernehmen** | Krebs's price-calculator and training-guide are exactly this kind of surface — legally-sensitive, numerically dense, high-anxiety content. This is the |
| Noomo Agency — narrative case-study structure over portfolio grid | **anpassen** | The digital-system and cockpit chapters are effectively case studies of how the school actually operates (app, booking, theory, progress tracking). Pr |
| Awwwards evaluation weighting — Design 40 / Usability 30 / Creativity  | **übernehmen** | A direct investment allocation. Spend proportionally: roughly as much effort on usability and content (the licence-finder flow, the calculator's clari |
| 2026 award rubrics weight performance above visual design | **übernehmen** | Concretely: the Next.js build's Core Web Vitals (LCP, INP, CLS) and the accessibility audit are worth ~30% of an award score combined — more than the  |
| The Codrops 2026 canon — progressively enhanced scroll rigs and Blende | **anpassen** | Sets the technical yardstick. If Krebs ships Locomotive-style hijacked smooth scroll and 2021 parallax, it will read as dated to anyone who judges the |
| Anti-AI 'human touch' design — visible authorship as the 2026 differen | **anpassen** | For a family-run Fulda driving school this is the highest-leverage, lowest-cost differentiator available. Real photographs of the actual cars, the act |
| Tactile brutalism / neobrutalism as proof-of-human | **verwerfen** | Neobrutalism has been template-ified faster than any style in years — thick black borders plus offset hard shadows plus one saturated accent is now it |
| The component-catalog layer (21st.dev) — the template vocabulary, usef | **verwerfen** | This IS the generic risk, in its purest available form. Note also that the query for 'not templated' returned templates: the retrieval layer cannot di |
| Scroll-jacking — the technique juries once rewarded and now penalise | **verwerfen** | Scroll-jacking is now itself a marker of a mid-2010s template rather than of premium work — the aesthetic association has inverted. |

### Automotive & Mobilität

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Single-accent chromatic discipline (colour as meaning, not decoration) | **übernehmen** | Already the system's stated law — src/app/globals.css lines 5-9 ('Colour is used for meaning (route, state, priority) — never for decoration') and the |
| One-light-source materiality (studio cove, falloff, grain-as-dither) | **übernehmen** | Already implemented well: .atmos-falloff (globals.css 155-163) is exactly the two-gradient studio cove, .edge-signal (202-208) is the inner-highlight- |
| Technical specification as typographic hierarchy (numbers as the hero) | **übernehmen** | Directly applicable to the licence-class data and already partly built. cockpit-screen.tsx line 70 ('tabular font-display text-3xl font-extrabold') an |
| Persistent summary rail with delta pricing (the configurator commit mo | **anpassen** | This is the highest-value borrow for price-calculator.tsx. Right now the totals live in a <tfoot> (lines 202-224) at the bottom of a table that is min |
| One decision per screen — progressive disclosure with a small, calm op | **übernehmen** | licence-finder.tsx already implements this almost exactly: auto-advance on change (line 87), question as legend in display type (line 70), tabular ste |
| Route-line progress with state-coded stations (mobility app journey vi | **übernehmen** | Built and strong: the Journey component (cockpit-screen.tsx 98-118) is exactly this — an ordered list with an absolutely positioned 1px spine, nodes w |
| Credible simulation marketing — the anti-game register | **übernehmen** | simulator-chapter.tsx is a model implementation and its header comment (lines 4-16) states the constraint precisely: the school demonstrably trains wi |
| Engineered motion — one easing family, few properties, causal only | **anpassen** | The system already defines exactly two curves — --ease-route and --ease-signal (globals.css 51-52) — which is the right discipline, and licence-finder |
| Masked, colour-graded editorial photography (aperture crops, never cat | **anpassen** | Currently the site uses zero photography — everything is SVG and CSS (Roadway, DriverView, CockpitScreen are all code-native). That is a defensible an |
| Vehicle hero beauty shot, 360° rotator and colour/wheel swatch picker | **verwerfen** | Not generic — the opposite problem. This is so strongly branded as automotive-retail that borrowing it would read as a car dealership site, which is p |
| Cinematic autoplay video hero with scroll-jacked product reveal | **verwerfen** | High and double-edged: scroll-jacking is simultaneously an automotive cliché and a generic template feature, so it manages to look both derivative and |

### Konversion & Werkzeuge

| Muster | Entscheidung | Warum |
| --- | --- | --- |
| Card-radio question step with explicit Continue (no auto-advance) | **anpassen** | src/components/classes/licence-finder.tsx currently calls choose(option.value) directly from the radio's onChange (line 87), so arrow-key navigation i |
| Adaptive question path — ask only what changes the answer | **anpassen** | src/lib/licence-finder.ts scores only within VEHICLE_CLASSES[vehicle], so the vehicle answer already collapses the candidate set to 2-4 classes. Given |
| Honest progress: a fixed, small, never-shrinking denominator | **übernehmen** | licence-finder.tsx derives questions.length from a filter on answers.vehicle (line 27), so the denominator is 6 before the vehicle is chosen and 5 aft |
| Persistent, editable answer summary instead of a review step | **anpassen** | The finder's recommend() returns reasons[] and blockers[] per class — the recommendation is already explainable. Pairing those reasons with a visible  |
| Twin control for quantities: slider bound to a number input | **anpassen** | The Übungsfahrstunde row is explicitly the position that moves the total most and is genuinely unknowable in advance (src/content/prices.ts line 70 an |
| Like-for-like comparison: two columns, one shared quantity | **übernehmen** | This is the project's answer to a hard constraint: src/content/prices.ts documents that no Krebs price list exists and that a circulating list belongs |
| Competitor 'Us vs Them' card — reject | **verwerfen** | Presenting the pattern as 'social proof' or 'positioning' obscures that each row is a legal statement. Also invites reciprocal harm: a named local com |
| Itemised cost breakdown that separates third-party fees from the schoo | **übernehmen** | src/content/prices.ts already models this exactly — a separate externalCosts array with from/to ranges and the rationale 'so that a comparison between |
| Debounced, terse, commit-time aria-live announcement of the calculated | **anpassen** | The calculator's live region is currently a full sentence recomputed on every render, so it re-announces on every single character typed into any of ~ |
| On-submit error summary plus inline field errors for the consultation  | **übernehmen** | src/app/kontakt/actions.ts + src/lib/contact-schema.ts is a server-action form, which is the right architecture: it works without JS and the schema is |
| Sticky result rail on desktop, docked summary bar on mobile | **anpassen** | The calculator's totals live in a <tfoot> at the bottom of a ~7-row table that is also horizontally scrolled on mobile, so a phone user adjusting the  |
| Animated number ticker for totals — adapt, with a static accessible va | **anpassen** | The project already has a .tabular utility and a formatEuroFromCents helper, so the substrate is there. Given the truth model, the animation must neve |
| FAQ accordion as the place where pricing caveats live | **übernehmen** | The absence of published prices is the most conspicuous thing about this site's pricing page, and an unexplained absence reads as evasion. An FAQ entr |
| Attributable testimonials, not an auto-rotating carousel | **anpassen** | Under this project's Fact discipline a testimonial is a claim like any other and belongs behind the same publicValue() gate — an invented quote is exa |

_Recherche durchgeführt am 27./28. Juli 2026._
