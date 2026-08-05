# Voice Style — The Invisible Why

## Narration voice (the character)

- Warm, intelligent, mildly conspiratorial — someone letting you in on
  something, not lecturing you
- US-neutral accent, sounds 30–45 years old
- Curious more than authoritative: asks questions the viewer is already
  thinking, then answers them
- Confident on established facts, explicitly hedged on contested ones
  ("the honest answer is, nobody's fully sure why")
- Never uses hyperbolic list-video language ("you WON'T BELIEVE," "INSANE,"
  "changes EVERYTHING")

## Writing-for-voice rules

1. **Contractions always** ("it's," "you'll," "doesn't") — written-not-spoken
   English kills retention
2. **Short sentences carry the plot; longer sentences carry the nuance.**
   Never stack two complex clauses back to back
3. **Second person throughout.** "You" is the protagonist of every video,
   not "people" or "humans" in the abstract
4. **One idea per sentence.** If a sentence needs "and" to hold two facts,
   split it
5. **Rhetorical questions as scene transitions**, max one every ~45 seconds
   — used to earn the next beat, not as a crutch
6. **No filler intensifiers** ("very," "really," "literally") unless doing
   real work
7. Numbers are spoken the way a person would say them out loud ("about one
   in five," not "20.4%") unless precision is the point of the sentence

## Pacing

| Content type | Target pace |
|---|---|
| Explainer narration (default) | 150–160 wpm |
| Tension / escalation beats | 160–170 wpm |
| Key insight / payoff line | slow down ~20%, add a beat of silence before and after |

**Measure the output, don't trust the target.** The first three pilots
were written to this table and still shipped at 122–145 wpm, because the
generated voice delivers considerably slower than the written target and
nobody checked until three videos existed. Every render: count words,
divide by minutes, compare. `seed_audio`'s `speech_rate` (channel default
**20**) is the correction — but the right value depends on how dense the
script is, so re-measure after any significant rewrite. Full diagnosis and
the measured rate table: `channel-bible/retention-playbook.md`.

**Voice: Arthur** (`30fc8796-ceb6-4a66-b3a7-4a145ef7f346`), one voice for
the whole channel. Tested alternatives at identical settings: Skye is
equivalent on pace and would differentiate more in a niche full of calm
male narrators; **Brooks delivers at ~93 wpm and must not be used** for
this format regardless of how it sounds in isolation.

## Pronunciation & terminology

- Every script ships with a **pronunciation appendix** for names, numbers,
  units, and technical terms, consumed by the TTS/SSML step
- A running `voice-style/glossary.md` (to be built as the channel grows)
  tracks how recurring terms are pronounced/phrased, so the voice stays
  consistent video to video (e.g., always "your brain," never "the human
  brain," to preserve the second-person frame)

## TTS delivery notes (for the ElevenLabs step)

- Use SSML-equivalent breaks: a `500ms` pause before a reveal line, `250ms`
  after a rhetorical question
- Keep the same voice ID and stability/similarity settings across every
  video for a consistent channel "voice fingerprint"
- Never blend multiple stock voices across videos — pick one (cloned or
  designed) and commit to it; see `docs/SETUP.md` for the account decision
  this requires from you
