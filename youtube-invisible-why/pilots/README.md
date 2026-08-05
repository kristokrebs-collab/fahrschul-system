# Pilot videos

Three fully-scripted, fully-storyboarded pilots per the launch plan
(Phase 1 — one channel, three angles, same voice/hand/paper/music, compare
results before committing to a direction):

| Pilot | Angle | Runtime | Accent color |
|---|---|---|---|
| `pilot-01-cancel-subscriptions` | psychology + money | 9:50 | Money Green `#2E9E5B` |
| `pilot-02-sleep-deprivation` | body + decisions | 9:55 | Focus Blue `#2E6FE4` |
| `pilot-03-supermarket-psychology` | everyday hidden systems | 9:45 | Alert Amber `#F0A202` |

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

## What's still a draft, not a finished video

- Storyboard timing is derived from the script's structure, not from a
  real generated voice track — in production, the n8n pipeline's
  ElevenLabs step generates actual narration audio first, and scene
  timings should be re-checked against its real timestamps (expect small
  adjustments, not a rewrite).
- All three currently render with the placeholder icon library and hand
  illustration described in `remotion-engine/README.md`'s "Known
  limitations" — swap those for real channel-specific art before treating
  a render as publish-ready.
- Fact-check and human sign-off (`editorial-rules.md` §9) have not
  actually happened — these are drafts ready to be run through the
  pipeline's Fact Checker step and a real human review, not pre-approved.
