# Accessibility & Contrast Specification

This is the complete accessibility specification for the website rebuild process. Accessibility failures (dark text on dark backgrounds, light text on light backgrounds, unreadable interactive states) were a critical deficiency in v1. These requirements are mandatory at every phase.

## Contrast Ratio Minimums (WCAG AA)

| Text Type | Minimum Contrast Ratio | Target |
|---|---|---|
| Normal body text (< 18px) | 4.5 : 1 | 7 : 1 |
| Large text (>= 18px or >= 14px bold) | 3 : 1 | 4.5 : 1 |
| UI components & states (borders, icons) | 3 : 1 | 4.5 : 1 |
| Placeholder text in inputs | 4.5 : 1 | 7 : 1 |
| Focus indicators | 3 : 1 against adjacent colors | 4.5 : 1 |
| Disabled state text | No minimum (mark with aria-disabled) | N/A |

## Verification at Build Time

1. During QA, use `preview_eval` to run axe-core checks via CDN on each page:
   ```js
   (async () => {
     const script = document.createElement('script');
     script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js';
     document.head.appendChild(script);
     await new Promise(r => script.onload = r);
     const results = await axe.run();
     return { violations: results.violations.length, critical: results.violations.filter(v => v.impact === 'critical'), serious: results.violations.filter(v => v.impact === 'serious') };
   })()
   ```
2. Fix every CRITICAL and SERIOUS violation before moving to the next phase — do not defer
3. For every color combination in the design system, verify WCAG AA contrast ratios (document them as comments in global.css)
4. Never trust visual inspection alone — always verify computed ratios

## Common Contrast Failure Patterns

These are the most frequent failures. Actively check for and prevent each one:

### Light gray text on white backgrounds
Any gray lighter than #595959 on white (#FFF) fails AA for normal text. This is the most common failure.

### White or light text on pale brand colors
Example: light blue CTA button (#BFDBFE) with white text (#FFF) = ~1.2:1 contrast ratio. Catastrophically bad.

### Dark text on dark hero backgrounds
Dark navy text on deep charcoal hero section. Both look different enough to the designer's eye but fail computationally.

### Colored text on colored backgrounds
Brand accent on brand secondary without verifying the computed ratio. "It looks fine" is not verification.

### Hover/focus states that reduce contrast
Text lightening on hover can drop below the minimum. Check every interactive state.

### Placeholder text in form inputs
Most browser defaults are too light. Override them explicitly.

### Overlay text on images
The overlay must be dark/opaque enough that text contrast is maintained across the ENTIRE image — not just the dark parts. Test against the lightest region of the image.

### Gradient text
Verify that the lightest point of the gradient still meets contrast requirements against its background.

## Accessibility Checklist (Beyond Contrast)

- [ ] Every image has a descriptive `alt` attribute. Decorative images use `alt=""`
- [ ] Every interactive element is reachable and operable via keyboard alone
- [ ] Focus indicators are visible and meet contrast requirements
- [ ] Skip-to-main-content link is the first focusable element on every page
- [ ] All form inputs have associated `<label>` elements (not just placeholder text)
- [ ] ARIA roles and labels used correctly — only add ARIA when native HTML semantics are insufficient
- [ ] Color is never the sole means of conveying information (error states use both color AND icon/text)
- [ ] Heading hierarchy is logical: one `<h1>` per page, never skipping levels
- [ ] Motion respects `prefers-reduced-motion` media query
- [ ] Videos have captions; audio has transcripts

## ACCESSIBILITY_AUDIT.md Format

Document all accessibility work in this file. Include:
- Tool used (axe-core version, wcag-contrast version)
- Violations found (categorized by severity)
- Violations fixed (with before/after)
- Contrast ratios for ALL color pairs in the design system (as a table)
- Date of each audit pass
