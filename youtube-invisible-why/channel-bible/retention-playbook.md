# Retention Playbook — what the channels we're competing with actually do

Written after auditing the first three pilots and finding a measurable
problem. This document is the fix, and it overrides anything softer said
elsewhere in the channel bible.

## The diagnosis: we shipped three videos at 122–145 words per minute

| Pilot | Words | Runtime | Pace |
|---|---|---|---|
| 1 — Cancel Subscriptions | 900 | 7:11 | **125 wpm** |
| 2 — Sleep Deprivation | 718 | 5:52 | **122 wpm** |
| 3 — Supermarket | 700 | 4:49 | 145 wpm |

The scripts were *written* for 150–165 wpm (`voice-style.md`), but the
generated voice delivered them 20–25% slower than that, and nobody
measured until after three videos existed. 120–130 wpm is the pace used
for instructional content people are obliged to follow — a training
module, a compliance video. It is the wrong pace for content that has to
survive a viewer's thumb.

The industry range: most YouTube creators sit at 140–170 wpm; energetic,
forward-momentum content lands around 140–155; past ~160–170 comprehension
starts to suffer. Our target is **150–160 wpm** — brisk enough to feel
alive, slow enough to carry a real idea.

**The fix:** `seed_audio`'s `speech_rate` parameter. Measured on a real
segment (34 words):

| speech_rate | Duration | Pace |
|---|---|---|
| 0 (what we shipped) | 17.4s | 117 wpm |
| 20 | — | ~152 wpm ← channel default |
| 30 | 12.5s | 163 wpm |
| 40 | 11.1s | 183 wpm — too fast to follow |

Rate is per-pilot, because base density differs: pilots 1 and 2 need ~20,
pilot 3 only needs ~7 to reach the same place. Always measure the result
(`words / (seconds/60)`) rather than trusting the setting.

## What the channels we're competing with do

Sources at the bottom. The pattern across Johnny Harris, Cleo Abram,
Veritasium, Kurzgesagt and Real Engineering is remarkably consistent.

### 1. Retention comes from narrative structure, not cut frequency

The strongest documentary-style channels hold 50%+ on 20-minute videos
through deliberate pacing — not by cutting every two seconds. Fast cutting
on top of a flat story does not rescue it. This is good news for us: our
format can compete without becoming a jump-cut channel.

**We already do this.** Keep it.

### 2. Everything is Setup → Tension → Payoff loops, stacked in ascending order

The body of a strong video is 5–7 of these loops, each one bigger than the
last. Each setup has recognizable stakes; each tension teaches something
without revealing the answer yet.

**We partly do this.** Our seven-beat structure is a single large arc.
What's missing is that each beat should *close* a loop and *open* the next
one. Concretely: end every beat on an unanswered question, not a summary.

### 3. The hook must open a nameable curiosity gap within 15 seconds

The test: can you name the exact question the opening plants in the
viewer's head? If not, it's a statement, not a hook. All three elements —
you're in the right place, this matters, here's the gap — inside 15
seconds.

**We partly do this.** Our cold opens are good but slow to land. At 117
wpm the Pilot 1 hook takes 17 seconds to deliver 34 words. At 152 wpm the
same words land in 13 — inside the window instead of straddling it.

### 4. By ~30 seconds you should be *doing* the video, not still setting it up

Our "Promise" beat runs 20–50 seconds and is pure setup. That is a long
time to spend explaining what's about to happen.

**Fix:** compress Promise to a single sentence and start the first real
scene by 0:35.

### 5. Music carries the emotional shape

Johnny Harris shifts music between "thinky, feely, and fun" to control
tone. Our videos currently have **no music and no sound design at all** —
just a voice on silence. This is probably the single biggest remaining gap
after pace, and it's the cheapest to fix.

**Not yet done.** See "What we still owe" below.

## Where we can genuinely differentiate

Copying the above gets us to parity. These are the things the big channels
*can't* easily do:

1. **Speed and volume.** Kurzgesagt takes months per video. Our pipeline
   goes idea → finished video in a day. That means we can chase a
   curiosity gap while it's live, and publish 3–4× more often.
2. **The drawing itself is the pacing device.** Nobody in this niche uses
   a real-time drawing hand as the retention mechanism. A stroke landing
   exactly on a stressed word is a beat no stock-footage channel can hit.
   We should lean into this much harder — sync draws to emphasis, not just
   to scene boundaries.
3. **Showing our sources on screen.** The niche is full of confident
   assertion. Putting the actual paper title on screen for a beat, as a
   drawn element, is both differentiating and honest — and it's exactly
   what our source policy already requires in the description.
4. **A visible "what would change my mind" beat.** Every pilot already has
   a fairness/counter-argument beat (`editorial-rules.md` §2). Almost
   nobody does this. Naming it on screen turns a compliance obligation
   into a trust signal.

## What we still owe (in priority order)

1. **Regenerate all narration at the corrected pace.** Biggest single win,
   fully mechanical.
2. **Music bed + sound design.** No licensed music is sourced yet — this
   needs a real decision (YouTube Audio Library is free and cleared;
   Epidemic/Artlist are paid and better). `scene.sound_effect` is already
   in the storyboard schema and completely unused.
3. **Tighten the Promise beat** to one sentence across all three scripts.
4. **End each beat on an open loop** rather than a summary line.
5. **Sync draw timing to stressed words**, not just scene starts.

## Sources

- [Video Pacing for YouTube Retention](https://increditors.com/video-pacing-youtube-retention-science/) — retention from narrative pacing vs. cut frequency
- [Pitch via Video like Johnny Harris](https://www.scribblejerk.com/blog/pitch-via-video-like-johnny-harris) — three-act structure, music as tone control
- [First 30 Seconds of YouTube Videos](https://prepublish.ai/guides/first-30-seconds) — the 15-second curiosity-gap window
- [YouTube Script Writing for Retention](https://learn.tubeai.app/blog/youtube-script-writing-retention) — Setup-Tension-Payoff loops in ascending order
- [Choosing AI Voiceover Speed and Tone by Genre](https://channel.farm/blog/how-to-choose-ai-voiceover-speed-tone-youtube-video-genres) — pace bands per content type
- [Words Per Minute Speaking](https://flowshorts.app/blog/words-per-minute-speaking) — 140–170 wpm creator range
