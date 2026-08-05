# Publish checklist — the 3 pilots

Everything that could be produced without your accounts is done. This is
the exact remaining path to three public videos.

## Assets, all produced

| Asset | Pilot 1 (cancel subs) | Pilot 2 (sleep) | Pilot 3 (supermarket) |
|---|---|---|---|
| Script | ✅ `script.md` | ✅ | ✅ |
| Research dossier (sourced) | ✅ `research-dossier.md` | ✅ | ✅ |
| Storyboard, re-timed to real audio | ✅ `storyboard.json` | ✅ | ✅ |
| Narration audio (voice "Arthur") | ✅ 7:11 | ✅ 5:52 | ✅ 4:49 |
| Rendered video (silent) | ✅ 24 MB | ✅ 30 MB | ✅ 23 MB |
| Thumbnail | ✅ | ✅ | ✅ |
| Title / description / tags / chapters | ✅ `youtube-metadata.md` | ✅ | ✅ |

Download links for narration and thumbnails are in `voiceovers/README.md`
and each pilot's `youtube-metadata.md`.

## Step 1 — Nothing. The finished videos already exist.

Video and narration are already combined. Download and go:

| Video | Runtime | Size | Download |
|---|---|---|---|
| 1 — Why Your Brain Refuses to Cancel Subscriptions | 7:11 | 15.8 MB | [MP4](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/b7cbe5ff-e671-43be-a07e-1f093b88ab20.mp4) |
| 2 — What 36 Hours Without Sleep Does to Your Decisions | 5:52 | 12.6 MB | [MP4](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/2b7378f2-eee4-492d-a568-e6f82220ec17.mp4) |
| 3 — The Hidden Psychology Behind Every Supermarket | 4:49 | 10.1 MB | [MP4](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/e922839f-2ce5-4f2a-ac07-fa53f97bcc63.mp4) |

1920×1080, H.264 video + 160 kbps AAC narration, `+faststart` so they
begin playing before the whole file has downloaded.

If you ever need to rebuild them (after a script edit, say): render the
silent video with Remotion, then `cd voiceovers && node mux-narration.js
all`. One caveat learned the hard way — do **not** pass ffmpeg's
`-shortest` alongside `-c:v copy`. It silently truncated the audio to six
seconds while still reporting the full duration and both streams present.
`mux-narration.js` no longer uses it.

## Step 2 — Watch them (do not skip)

Nothing here has been watched end to end by a human. Before anything goes
public, watch each one and check:

- Does the drawing keep pace with what's being said?
- Does the hand ever sit still awkwardly, or draw something unrelated?
- Does the voice mispronounce anything? (Check the pronunciation
  appendices in each `script.md` — "Gruen transfer", "ROSCA", the BAC
  numbers.)
- Does the ending land, or does it just stop?

Expect to want changes. The whole system is built to make a re-render
cheap: edit `script.md`, regenerate just the affected narration segment,
re-run the timing step, re-render.

## Step 3 — Fact-check sign-off (mandatory)

`channel-bible/editorial-rules.md` §9 makes this a human gate, and Pilots
1 and 2 both touch regulated-adjacent territory (financial behaviour,
health claims). At minimum, verify:

- **Pilot 1**: the FTC rule status. Current as of 2026-08-05: rule vacated
  by the Eighth Circuit July 2025 on procedural grounds, FTC reopened
  rulemaking with an ANPRM in early 2026, ROSCA enforcement unaffected.
  The script is worded to survive further movement, but check before
  publishing.
- **Pilot 2**: the alcohol-equivalence framing. The script says
  "performed about as well as" — never "is the same as". Keep it that way.
- **Pilot 3**: keep the Gruen transfer framed as a design-criticism term,
  not a measured statistic. The script already does.

## Step 4 — Music and sound effects (not produced)

There's no music bed or SFX. The storyboards carry `sound_effect` cues
that nothing consumes yet. Either publish voice-only (defensible for this
format) or add a licensed track — YouTube's Audio Library is free and
cleared for monetization. Do not use anything you haven't licensed for
commercial use.

## Step 5 — Upload

1. Create the YouTube channel if you haven't (needs your Google account).
2. Upload each `-final.mp4` as **Private**.
3. Paste title, description, and tags from that pilot's
   `youtube-metadata.md`. The description already contains chapters and
   the sources section required by `editorial-rules.md` §10.
4. Set the thumbnail (links in the same file).
5. Category: Education. Made for kids: No. Altered-content disclosure: not
   required for this stylized art.
6. Watch the private version once more, then publish.

You do not need the YouTube Data API or n8n for these three. That setup
(`docs/SETUP.md`, `n8n/README.md`) is for automating video 4 onward.

## Known gaps, deliberately not papered over

- **The hand and icons are placeholders**, not commissioned channel art.
  This is the highest-leverage visual upgrade and it's reused in every
  scene of every video — see `remotion-engine/README.md`.
- **Pilots 2 and 3 run under 8 minutes** (5:52, 4:49) so no mid-roll ads.
  `editorial-rules.md` §8 says don't pad to cross that line; extend with
  real content or accept it.
- **Scenes don't visually persist across cuts**, so the "one continuous
  drawing" idea in `visual-style.md` isn't fully realized yet.
- **No captions/subtitles.** YouTube auto-captions will do a decent job on
  this voice, but a reviewed `.srt` is better for retention and accessibility.
