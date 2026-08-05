# Pilot videos

Three fully-scripted, fully-storyboarded pilots per the launch plan
(Phase 1 — one channel, three angles, same voice/hand/paper/music, compare
results before committing to a direction):

| Pilot | Angle | Planned runtime | Real runtime (actual narration) | Accent color |
|---|---|---|---|---|
| `pilot-01-cancel-subscriptions` | psychology + money | 9:50 | **7:11** | Money Green `#2E9E5B` |
| `pilot-02-sleep-deprivation` | body + decisions | 9:55 | **5:52** | Focus Blue `#2E6FE4` |
| `pilot-03-supermarket-psychology` | everyday hidden systems | 9:45 | **4:49** | Alert Amber `#F0A202` |

"Planned" was the target written into each script header before any voice
existed. "Real" is what the scripts actually run to once spoken by a real
voice (see `voiceovers/`) — noticeably shorter across all three, which
tracks: it's easy to misjudge spoken pacing when drafting on the page.
`storyboard.json` in each folder now matches the real runtime;
`storyboard-planned.json` keeps the original for reference. All three
still clear the 8-minute mid-roll-ad threshold only for Pilot 1 — worth
knowing before publishing 2 and 3 as-is (channel-bible/editorial-rules.md
§8 explicitly says not to pad runtime just to cross that line; a shorter,
tighter video is the right call here, not an inflated one).

Each pilot folder has the full production chain's output:

- `research-dossier.md` — sourced findings, tiered per
  `channel-bible/source-policy.md`, with explicit caveats (see especially
  pilot 2's deliberate rejection of "ego depletion" as a mechanism, kept in
  precisely because it demonstrates the replication-crisis check working)
- `script.md` — full narration, beat-by-beat, in the Story Writer agent's
  format, with a pronunciation appendix and inline source list
- `storyboard.json` — scene-by-scene, in the Storyboard Agent's schema,
  contiguous and duration-matched to the script
- `packaging.md` — 10 titles, 5 thumbnail concepts, a recommended pairing,
  and a clickbait risk score

## These storyboards render for real

All three `storyboard.json` files were rendered through
`remotion-engine/` (still frames + a real MP4 clip) during development —
this isn't a hypothetical schema, it's been exercised end to end. Try it
yourself:

```bash
cd ../remotion-engine
npm install
npx remotion still src/index.ts MainVideo /tmp/frame.png \
  --props=../pilots/pilot-01-cancel-subscriptions/storyboard.json --frame=200 \
  --browser-executable=/path/to/chromium # see remotion-engine/README.md
```

## Real narration exists — see `voiceovers/`

Each pilot has real generated narration audio (Higgsfield `seed_audio`,
voice "Arthur"), split into 10 segments matching the script's sections.
Storyboards above are already re-timed against the *real* measured
durations of that audio, not an estimate. The audio bytes themselves
couldn't be downloaded from inside the sandbox that built this (an
egress-policy block on Higgsfield's CDN, not a problem with the files) —
`voiceovers/mux-narration.js` downloads and muxes them onto the rendered
video from anywhere with normal internet access. See `voiceovers/README.md`.

## What's still a draft, not a finished video

- All three currently render with the placeholder icon library and hand
  illustration described in `remotion-engine/README.md`'s "Known
  limitations" — swap those for real channel-specific art before treating
  a render as publish-ready.
- Fact-check and human sign-off (`editorial-rules.md` §9) have not
  actually happened — these are drafts ready to be run through the
  pipeline's Fact Checker step and a real human review, not pre-approved.
- Pilots 2 and 3's real runtime (5:52, 4:49) falls under the 8-minute
  mid-roll-ad threshold — either accept lower ad density for those two, or
  extend the scripts with genuinely new content (not padding) before
  publishing, per editorial-rules.md §8.
