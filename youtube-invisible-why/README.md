# The Invisible Why

A faceless, hand-drawn explainer YouTube channel about the hidden
mechanisms behind money, psychology, the body, and everyday systems —
built for ~80% automation with Claude doing the ideation/research/writing
work and a human holding the four sign-off gates that actually matter
(topic, fact-check, packaging, publish).

Full strategic rationale (why this format over faceless story/gameplay
content, monetization thresholds, RPM vs. CPM, etc.) lives in the
conversation that produced this folder — this README covers the system
that was actually built. Start here, then follow the links.

## What's in this folder

| Path | What it is | Status |
|---|---|---|
| `channel-bible/` | Audience, editorial rules, visual style, voice style, source policy — the constitution every agent is built against | Written |
| `agents/` | 8 full Claude agent specs (system prompts), one per pipeline stage | Written |
| `scoring/` | Deterministic idea-scoring rubric + a tested Node script implementing it | Written & tested |
| `n8n/` | The full production pipeline as an importable n8n workflow, plus a weekly analytics workflow | Written, structurally self-validated, **not test-imported into a live n8n instance** |
| `remotion-engine/` | A hand-drawing explainer video engine (React/Remotion) — storyboard JSON in, MP4 out | Written **and verified**: installs, typechecks, and renders real MP4s |
| `pilots/` | 3 complete video packages (script, research, storyboard, titles/thumbnails) ready to run through the pipeline | Written, storyboards render-tested |
| `ideas/`, `research/`, `scripts/`, `storyboards/` | Empty working directories the live pipeline writes into | Scaffolded, empty until you run the pipeline |
| `docs/SETUP.md` | Exactly what you need to create/configure to make any of this actually run | Written |

## What's real vs. what's a template

This is not a slide deck of a plan — most of it was actually run:

- `scoring/score_idea.js` was executed against test data and produces
  correct pass/maybe/reject verdicts (see the file's inline usage).
- `remotion-engine/` was `npm install`'d, typechecked with `tsc --noEmit`,
  and used to render real still frames and a real H.264 MP4 — including
  rendering all three pilot storyboards, hand-tracking a drawing path
  correctly, and gracefully skipping a deliberately-missing icon
  (`NEW_ASSET_NEEDED`) without crashing.
- `n8n/generate-workflow.js` self-validates the workflow JSON it produces
  (no orphan nodes, no dangling connections) — but n8n itself wasn't
  available to actually import and click through, so treat that one
  workflow as "structurally correct, verify against your n8n version,"
  not "guaranteed zero-touch import." See `n8n/README.md` for exactly what
  to check.

## Where to start

1. Read `channel-bible/` (5 short files) — this is what every agent is
   built against, and it's the fastest way to see the channel's actual
   editorial spine.
2. Read one full pilot end to end:
   `pilots/pilot-01-cancel-subscriptions/` — research dossier → script →
   storyboard → packaging, in that order. This is the clearest way to see
   how the pieces fit together.
3. Read `docs/SETUP.md` and decide which accounts/services you're
   actually willing to pay for and set up — nothing in `n8n/` or
   `remotion-engine/` runs against real APIs without them.
4. Render a pilot yourself (`remotion-engine/README.md` has the exact
   commands) before spending money on ElevenLabs or YouTube API setup —
   it's the fastest way to judge whether the current placeholder hand/icon
   art is good enough to start with, or worth commissioning first.

## Suggested order of operations from here

1. Decide on voice: ElevenLabs cloned/designed voice vs. a hired voice
   actor (`channel-bible/voice-style.md`, `docs/SETUP.md`).
2. Commission (or personally illustrate) a real hand + pen asset to
   replace `remotion-engine/src/components/AnimatedHand.tsx`'s
   placeholder — this is the single highest-leverage visual upgrade,
   since it's reused in every scene of every video.
3. Stand up self-hosted n8n per `n8n/README.md`, wire the 4 credentials,
   and manually step through the pipeline once on Pilot 1 before trusting
   it to run on a schedule.
4. Run all three pilots through fact-check and real voiceover generation,
   compare retention once published (private → a small trusted-tester
   pass is reasonable before fully public), then commit to Phase 2 (10
   videos in the strongest angle) per the original strategy discussion.
