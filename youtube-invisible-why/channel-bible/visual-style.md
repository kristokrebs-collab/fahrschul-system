# Visual Style — The Invisible Why

## Core concept

A single hand draws the entire explanation in real time on a textured paper
background — "whiteboard animation," but with a distinct, non-template look
built in Remotion instead of an off-the-shelf tool, so the channel has a
defensible visual identity.

## Look & feel

- **Canvas**: warm off-white paper texture (subtle grain, very light vignette),
  not clinical white
- **Line art**: consistent 3–4px black ink stroke weight, occasional single
  accent color per video (chosen per-topic from a fixed 6-color accent
  palette — see below) — never full-color illustration
- **Hand**: a single stylized hand + pen, always entering from the same
  default direction (lower-right), consistent across all videos
- **Camera**: slow, continuous pans and slow zooms over the "paper" — never a
  hard cut mid-sentence; cuts happen only at scene boundaries
- **Typography**: one display face for on-screen key words/numbers (short,
  punchy — 2–5 words), one hand-lettered-style face for incidental labels
- **Motion grammar**:
  - concepts *appear* by being drawn (stroke-dasharray reveal), not by
    fading in
  - emphasis = underline or circle drawn on top of existing art, not color
    flashing
  - transitions between scenes = camera pan/zoom to a new area of an
    infinite canvas, reinforcing "one continuous drawing," not slide cuts

## Fixed accent palette (pick exactly one per video)

| Name | Hex | Typical use |
|---|---|---|
| Signal Red | `#E4572E` | danger, cost, warning |
| Focus Blue | `#2E6FE4` | mechanism, brain, system |
| Money Green | `#2E9E5B` | finance topics |
| Alert Amber | `#F0A202` | attention, timing |
| Neutral Ink | `#1A1A1A` | base line art (always) |
| Paper | `#F5F0E6` | base background (always) |

## Explicit non-goals (things that make channels look templated)

- No stock "whiteboard animation" hand/marker assets
- No generic flat-icon libraries (no interchangeable Noun Project icons)
- No default text-reveal/typewriter effects without a hand motivating them
- No stock motion-graphics countdown/subscribe-bell animations

## Recurring visual motifs (build a library, reuse across videos)

- "Zoom out to reveal the whole system" — used at least once per video near
  the reframe/twist beat
- A recurring simple character (a rounded, faceless-or-simple-dot-eyed
  stick figure) used whenever we need "a person" in a scenario
- A consistent icon set built once in `remotion-engine/src/assets` and
  reused: clock, brain, coin, cart, bed, phone, arrow-up, arrow-down

## Deliverable format

- 16:9, 1920×1080, 30fps for main uploads
- 9:16, 1080×1920 vertical crops for Shorts, re-timed to the strongest
  15–45s beat, not a naive center-crop
