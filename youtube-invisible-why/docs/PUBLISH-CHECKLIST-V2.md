# Publish checklist — pilots 4, 5, 6

These three were built after the first batch was judged too slow, too
sparse and too repetitive. What changed, and what you still have to do.

## The one step that is not done: joining voice to picture

The renders are silent. The narration exists and is finished. They are not
combined, because they could not be: the narration lives on a CDN this
build environment's network policy blocks, and the video was rendered
locally. Neither side could reach the other, and the upload host that would
have bridged them (`upload.higgsfield.ai`) is blocked as well.

On your machine both are reachable, so this is one command:

```bash
cd youtube-invisible-why/voiceovers
bash mux-v2.sh                      # all three
bash mux-v2.sh pilot-06-waiting-time   # or one
```

It downloads the narration chunks, joins them, and writes
`renders/<pilot>-final.mp4`, ready to upload. Requires `ffmpeg` and `curl`.

Video and audio already match to within 0.1s, because the storyboards were
timed against the recordings' **measured** durations rather than an
estimate. No sync work is needed.

## Assets

| Asset | Pilot 4 (phone) | Pilot 5 (decoy) | Pilot 6 (waiting) |
|---|---|---|---|
| Script | ✅ | ✅ | ✅ |
| Storyboard, timed to real audio | ✅ | ✅ | ✅ |
| Narration (voice "Arthur") | ✅ 3:25 | ✅ 3:39 | ✅ 3:19 |
| Rendered video (silent) | ✅ | ✅ | ✅ |
| Thumbnail | ✅ | ✅ | ✅ |
| Title / description / tags / chapters | ✅ | ✅ | ✅ |
| **Voice joined to video** | ❌ run `mux-v2.sh` | ❌ | ❌ |

Narration URLs and per-chunk durations: `voiceovers/narration-v2.json`.
Thumbnail URLs: each pilot's `youtube-metadata.md`.

## What changed from pilots 1–3

- **No hand.** A bare pen draws instead. The hand covered a large wedge of
  every frame and read as wrong whenever the anatomy was even slightly off.
- **The page is full.** Compositions are per-element-count with a
  deliberate hero, and elements are ~45% larger. The old renderer put
  everything in one centred row and left the top and bottom thirds empty.
- **41 icons, up from 21**, drawn for specific beats rather than as generic
  symbols. The repetition in the first batch came from re-using a handful
  of shapes across three videos.
- **Scenes are 5–12s** instead of one scene per 45-second script beat, so
  new line work keeps arriving instead of the page finishing early and
  sitting still.
- **Pace measured, not assumed:** 184 / 159 / 165 wpm. The first batch
  shipped at 122–145.

## Still missing, deliberately named

- **Pilot 4 runs at 184 wpm**, above the 150–165 house target. `seed_audio`
  returned wildly different pacing for the same text across runs
  (independently of `speech_rate`), and this was the slowest usable take of
  the ones generated. Regenerate that chunk and re-time if it bothers you
  on watching — `narration-v2.json` has the chunk boundaries.
- **No music or sound design.** `sound_effect` is in the schema and still
  unused. YouTube's Audio Library is free and cleared for monetization.
- **No captions.** Auto-captions will cope; a reviewed `.srt` is better.
- **Nobody has watched these end to end.** Do that before publishing.

## Fact-check before publishing

- **Pilot 4:** the dopamine framing is deliberately narrow — anticipation,
  not reward. Do not let it drift toward "notifications give you a dopamine
  hit." The slot-machine comparison is mechanism-identical,
  intent-unproven, and worded that way on purpose.
- **Pilot 5:** the Economist numbers (16/0/84 → 68/32) are from Ariely's
  own account. The fairness beat citing Frederick et al.'s replication
  difficulties is not optional — it is what keeps the claim honest.
- **Pilot 6:** the Houston figures are as reported by the New York Times,
  not a controlled study. The script says "the airport found," never
  "researchers proved."

## Upload

Same as before: upload `<pilot>-final.mp4` as Private, paste title /
description / tags from `youtube-metadata.md`, set the thumbnail, category
Education, made-for-kids No, watch it once, then publish.
