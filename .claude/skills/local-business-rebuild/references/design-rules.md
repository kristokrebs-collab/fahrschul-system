# Design Rules — Anthropic Frontend-Design Skill Integration

These rules are drawn from Anthropic's official frontend-design SKILL.md. They are non-negotiable and apply to every component, page, and pixel.

## 1. Bold Aesthetic Direction

Before building anything, define the site's aesthetic across four dimensions:

- **Purpose:** What problem does this site solve? Who is the customer? What emotion within 3 seconds of landing?
- **Tone:** Pick one extreme and own it. Examples:
  - Brutally minimal
  - Maximalist
  - Retro-futuristic
  - Organic/natural
  - Luxury/refined
  - Playful/toy-like
  - Editorial/magazine
  - Brutalist/raw
  - Art deco/geometric
  - Soft/pastel
  - Industrial/utilitarian
  Design one that is true to THIS specific business.
- **Constraints:** Framework, performance targets, accessibility requirements.
- **Differentiation:** The single unforgettable thing someone will remember.

Bold maximalism and refined minimalism both work. The key is intentionality, not intensity. Execute the chosen direction with total commitment.

## 2. Typography Rules

Choose fonts that are beautiful, unique, and interesting. Pair a distinctive display/heading font with a refined, readable body font.

### BANNED Fonts (Never Use)
- Inter
- Roboto
- Arial
- Helvetica
- System fonts
- Space Grotesk
- Lato
- Open Sans
- Source Sans Pro

### Requirements
- Use Google Fonts or variable fonts
- Find characterful, unexpected choices designed for this specific business context
- Establish a clear typographic scale: display/hero, h1, h2, h3, body, small/caption — every size has a purpose
- Body text on light backgrounds: minimum 16px, line-height 1.5–1.65
- Body text on dark backgrounds: minimum 16px, line-height 1.6–1.75

## 3. Color System Rules

- Commit to a cohesive color system
- Use CSS custom properties (variables) for every color value — never hardcode hex outside token definitions
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Pick 1–2 dominant colors and 1 sharp accent. Let the accent do the heavy lifting.

### BANNED Color Schemes
- Purple gradients on white backgrounds
- Generic blue-on-white corporate palettes with no personality
- Rainbow/multicolor schemes with no hierarchy

No two sites built with this system should share a color palette. Design for THIS business.

## 4. Motion & Animation Rules

- Use animations for effects and micro-interactions
- CSS-only animations and transitions. No JavaScript animation libraries needed.
- Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) > scattered micro-interactions everywhere
- Scroll-triggered reveals and hover states that surprise. Think Apple, Stripe, Linear — not carousel slideshows and bouncing icons.
- Use Astro View Transitions for smooth page-to-page animations (zero JavaScript).
- All animations must run at 60fps
- Use `transform` and `opacity` only for GPU-composited animations
- Never animate `width`, `height`, `top`, `left`, or `margin`
- Animations must not interfere with readability at any point in their cycle
- Respect `prefers-reduced-motion`: wrap all animations in a media query and reduce or disable them

## 5. Spatial Composition Rules

- Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements.
- Generous negative space OR controlled density — pick one and be intentional
- Every section: clear visual hierarchy. Visitor's eye should be guided, not lost.
- No two consecutive sections should use the same layout pattern.

## 6. Background & Visual Depth Rules

- Create atmosphere and depth
- Never default to flat solid color backgrounds across the entire site
- Use contextual effects matching the aesthetic:
  - Gradient meshes
  - Noise textures
  - Geometric patterns
  - Layered transparencies
  - Dramatic shadows
  - Decorative borders
  - Grain overlays
- These must enhance readability — never compete with it.

## 7. What Never to Do

NEVER produce generic AI-generated aesthetics:
- Overused/banned font families
- Clichéd color schemes (especially purple gradients on white)
- Predictable, template-looking layouts
- Cookie-cutter component patterns with no context-specific character
- The same design twice — no two sites from this system should look related
