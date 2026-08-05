# Remotion drawing engine — The Invisible Why

A storyboard-JSON-driven "hand draws it on paper" explainer engine, built on
[Remotion](https://www.remotion.dev) (React + Chromium rendering) instead of
a templated whiteboard-animation tool, so the channel has a visual identity
nobody can license their way into.

**This has been built and verified to actually render** — `npm install`,
`npx tsc --noEmit`, and a real still-frame + short MP4 render were all run
against this exact code during development. See "Verifying it yourself"
below to reproduce that.

## How it works

1. A `Storyboard` (see `src/types.ts`) is a JSON object: `video_id`,
   `accent_color`, and an array of `scenes`, each with narration, a list of
   `drawing_elements` (icon names), optional `on_screen_text`, and a
   `camera` move — exactly the schema `agents/06-storyboard-agent.md`
   produces.
2. `src/Root.tsx` registers one Composition, `MainVideo`, whose duration is
   computed from the storyboard's total scene time (`calculateMetadata`).
3. `src/MainVideo.tsx` lays out one Remotion `<Sequence>` per scene.
4. Inside each scene, `SceneRenderer` auto-lays-out that scene's
   `drawing_elements` in a centered row, and for each one:
   - reveals it stroke-by-stroke via `stroke-dasharray`/`stroke-dashoffset`
     (`components/DrawnShape.tsx`), driven by `IconOnPaper`
   - computes where the pen tip currently is on that stroke using
     `SVGPathElement.getPointAtLength()` on a **detached** path element
     (`lib/pathMath.ts` — this works without DOM attachment, since path
     geometry doesn't depend on layout, which sidesteps any ref/effect
     timing issues in Remotion's per-frame render model)
   - positions `AnimatedHand` at that point
5. `CameraRig` applies one continuous pan/zoom per scene based on the
   scene's `camera` field.
6. `TextOverlay` pops in `on_screen_text` partway through the scene.

## Icon library

`src/icons/index.ts` — about 20 line-art icons (clock, brain, credit-card,
cart, bed, calendar, etc.), each authored as an ordered list of SVG path
`d` strings on a 0–100 viewBox, drawn one after another. Add new icons here;
reference them by name from a storyboard's `drawing_elements`. Unknown
names (or ones a Storyboard Agent flagged `NEW_ASSET_NEEDED: ...`) are
silently skipped rather than crashing a render — build the icon, then
re-render.

## Verifying it yourself

```bash
npm install
npx tsc --noEmit                 # typecheck

# Render needs a real Chromium/headless-shell binary. If `npx remotion
# studio` can't find one automatically, point it at one explicitly, e.g.
# on this box's pre-installed Playwright Chromium:
npx remotion still src/index.ts MainVideo out/still.png --frame=90 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell

npx remotion render src/index.ts MainVideo out/clip.mp4 --frames=0-60 \
  --browser-executable=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```

Interactive preview: `npm run studio` (opens Remotion Studio in a browser —
scrub the timeline, swap `defaultProps` for a different storyboard, etc.)

## Rendering a real pilot video

```bash
npx remotion render src/index.ts MainVideo ../renders/<video-id>.mp4 \
  --props=../storyboards/<video-id>.json
```

This is exactly what the n8n pipeline's "Trigger Remotion Render" node runs
(see `n8n/README.md`).

## Known limitations (MVP — read before assuming production quality)

- **Auto-layout, not art-directed layout.** `SceneRenderer` spaces a
  scene's icons evenly in a row. It has no idea about composition, overlap,
  or visual hierarchy. For a real channel launch, either (a) extend the
  storyboard schema with explicit per-element `x`/`y`/`size` and have the
  Storyboard Agent (or a human) set them, or (b) accept the auto-layout
  look for pilots and revisit after seeing what actually needs art
  direction.
- **The hand is a placeholder illustration**, not the professionally
  illustrated, channel-defining asset described in `channel-bible/visual-
  style.md`. It's structurally wired correctly (tip-tracking, rotation,
  entry direction) — swap `components/AnimatedHand.tsx`'s `HandSVG` for a
  real illustration and everything downstream keeps working unchanged.
- **No sound.** `scene.sound_effect` and the voiceover audio aren't wired
  into the composition yet — the n8n pipeline generates and saves the
  voiceover MP3 separately (`voiceovers/<id>.mp3`); mixing narration +
  SFX + music under the video is the next real piece of work (`@remotion/
  media` / `<Audio>` + `<OffthreadVideo>`, or an FFmpeg mix pass after
  Remotion's video-only render — either is straightforward from here).
- **No custom fonts.** `TextOverlay` uses a system font stack. Loading a
  licensed display font via `@remotion/fonts` or `@remotion/google-fonts`
  is a small, well-documented addition once you've picked one.
- **Icon set is generic**, not hand-illustrated for this channel's exact
  style. It's intentionally simple/geometric so it's easy to extend — treat
  it as a working placeholder library, not the final asset set.
- **Elements don't persist across scene boundaries.** `visual-style.md`
  describes the whole video as "one continuous drawing" that the camera
  pans across; the current engine clears the paper at every `<Sequence>`
  (= every scene) and redraws that scene's elements from scratch. Real
  continuity — drawings from scene 3 still visible, smaller, in the
  background of scene 7 — would mean composing the whole video as one
  giant canvas with the camera moving through it, rather than per-scene
  sequences. That's a bigger architectural change worth doing once a
  pilot's storyboard makes clear how much continuity actually matters in
  practice.
