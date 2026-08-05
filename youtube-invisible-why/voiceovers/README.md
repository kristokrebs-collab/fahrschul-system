# voiceovers/

Real narration audio for each pilot, generated via the Higgsfield MCP
connector's `generate_audio` (model `seed_audio`, voice **Arthur**,
`voice_id 30fc8796-ceb6-4a66-b3a7-4a145ef7f346`) — no ElevenLabs signup
needed, paid from an existing Higgsfield credit balance instead of the
Anthropic API.

## Finished narration tracks (one file per pilot)

| Pilot | Duration | Download |
|---|---|---|
| Pilot 1 — cancel subscriptions | 7:11 | [narration.mp3](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/fb4479e2-9815-460d-82d8-fd4e6bebe880.mp3) |
| Pilot 2 — sleep deprivation | 5:52 | [narration.mp3](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/1a148507-063c-4eaf-afd9-12be24e20dc2.mp3) |
| Pilot 3 — supermarket psychology | 4:49 | [narration.mp3](https://d2ol7oe51mr4n9.cloudfront.net/user_3GXtk2iVh7ppwEX0NgoGQBMd3aE/b6e8bf25-f1ce-47cb-9f80-20833222152d.mp3) |

Each is the full script, all 10 sections concatenated in order, 160 kbps
mono MP3. These same URLs are in each pilot's `segments-manifest.json` as
`narration_url`.

## Getting to a finished video

```bash
cd voiceovers
node mux-narration.js all     # downloads narration + muxes onto the renders
```

That writes `renders/<video-id>-final.mp4` per pilot. Requires `ffmpeg` on
PATH and the silent renders already present in `renders/` (see
`remotion-engine/README.md` for the render command).

Or do it by hand, per pilot:

```bash
ffmpeg -i renders/cancel-subscriptions.mp4 -i narration.mp3 \
       -c:v copy -c:a aac -b:a 160k -shortest \
       renders/cancel-subscriptions-final.mp4
```

Video and audio durations already match to within ~0.05s — the storyboards
were re-timed against these exact recordings, so no sync work is needed.

## How this was built (and why the storyboards changed)

Each script was split at its 10 section boundaries (Cold Open, Promise,
Setup, … Payoff — see `pilots/*/script.md`), since `seed_audio` caps a
single generation at 2048 characters. Generating per-section also gives
real per-section speech durations, which were then used to **re-time every
`storyboard.json`**: spoken, the scripts run considerably faster than the
page-based estimates (Pilot 1 was planned at 9:50, real is 7:11).
`storyboard-planned.json` in each pilot folder preserves the original
timing.

## Per-segment files

`<pilot-id>/segments-manifest.json` lists all 10 source segments with
their individual URLs and durations — useful for regenerating a single
section after a script edit, rather than redoing a whole video. Those URLs
sit on a different CDN host (`d8j0ntlcm91z4.cloudfront.net`) which some
restricted networks block; the concatenated `narration_url` above is on a
host that is generally reachable.

Higgsfield-hosted URLs may expire eventually. If they 403/404, regenerate
from the prompts stored in `segments-manifest.json` using the same voice
ID above, rather than trying to re-download.
