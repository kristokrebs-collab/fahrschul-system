# Setup — what you actually need to do

Everything in this repo automates the *work*. It cannot create accounts,
accept terms of service, pay for API usage, or make legal/creative
judgment calls on your behalf. This is the complete list of what's on you,
organized by how soon you'll hit it.

## 1. Before you can render anything

### A Claude API key (Anthropic Console)
Every agent in `agents/` is a system prompt meant to be sent to the Claude
API (`https://api.anthropic.com/v1/messages`, model `claude-sonnet-5` in
the n8n workflow — change the model string in `n8n/generate-workflow.js`
if you want a different one). Get a key from the Anthropic Console and
budget for usage — 8 agent calls per video, most with several thousand
input/output tokens (dossiers and scripts are long).

### Node.js + npm (for `remotion-engine/` and `scoring/`)
Already verified to work with the versions in this environment
(Node 22, npm 10). `cd remotion-engine && npm install` pulls in Remotion,
React, and TypeScript — no other setup.

### A real Chromium/headless-shell binary for Remotion
Remotion renders by driving a real browser. On most normal machines,
`npx remotion studio` or `npx remotion render` will download one
automatically the first time. If you're in a sandboxed/offline environment
like this one, you need `--browser-executable=/path/to/headless_shell` (or
set it in `remotion.config.ts` via `Config.setBrowserExecutable(...)`) —
see `remotion-engine/README.md` for the exact command that was used to
verify this repo's renders.

### ffmpeg (only if you want to inspect/re-encode renders yourself)
Remotion bundles its own encoder for the actual render — you don't need
system ffmpeg for `npx remotion render` to work. You'll want a *full*
ffmpeg build (not a minimal one) on your path if you plan to mix in
voiceover/music/SFX audio after Remotion's video-only render, since that's
not wired up yet (see `remotion-engine/README.md`).

## 2. Before you can run the n8n pipeline

### Self-hosted n8n (Docker recommended)
n8n Cloud will not work — this pipeline reads/writes files on disk
(dossiers, scripts, storyboards) from Code nodes. You need self-hosted
n8n with this repo's `youtube-invisible-why/` folder mounted in, and
`NODE_FUNCTION_ALLOW_BUILTIN=fs,path` set. Full docker command and every
required credential/env var: `n8n/README.md`.

### Anthropic API key, as an n8n credential
Same key as above, added as a Header Auth credential named exactly
`Anthropic API Key` (n8n/README.md has the full table).

### ElevenLabs account + API key
For the voiceover step. Needs a **paid** plan for commercial use/
monetization rights on the generated audio (their free tier's output
isn't cleared for that) — check ElevenLabs' current commercial terms
before you rely on this, pricing/terms pages change. Decide up front:
- **Clone your own voice** (with your own consent/ownership — don't clone
  anyone else's voice without clear rights to do so), or
- **Use their Voice Design tool** to create a unique synthetic voice, or
- **License a professional voice actor** and skip TTS for narration
  entirely (higher quality, higher cost, no per-minute API bill)

Whichever you pick, commit to *one* voice ID for the whole channel
(`channel-bible/voice-style.md`) and put it in `ELEVENLABS_VOICE_ID`.

### A YouTube channel + Google Cloud project for the Data API
1. Create the YouTube channel itself (branding, banner, etc. — not
   scripted here, it's a few minutes in YouTube Studio).
2. Create a Google Cloud project, enable the **YouTube Data API v3**.
3. Create OAuth 2.0 credentials and complete the consent screen.
4. **Get your API project verified by Google if you want more than
   private/unlisted-scale testing quotas** — unverified projects get
   restricted daily quota and uploads default to private, which is
   actually fine for this pipeline's design (everything uploads private
   for human review anyway) but worth knowing about before you're
   surprised by a quota wall.
5. Authorize it in n8n as the `YouTube OAuth2 (Invisible Why channel)`
   credential, with `youtube.upload`, `youtube.readonly`, and
   `yt-analytics.readonly` scopes (n8n/README.md).

### Slack incoming webhook (or swap for email/Telegram)
For the "ready for review" and weekly analytics notifications. One n8n
node each — trivial to swap for whatever you actually use.

### (Optional) SerpApi key
Only powers the Google Trends signal node, and that node has
`continueOnFail` set — the pipeline runs fine without it, just with one
less trend source feeding the Trend Scout agent.

## 3. Before you publish anything publicly

### YouTube Partner Program eligibility
Standard ad-revenue tier currently requires **1,000 subscribers** and
either **4,000 valid public watch hours in the trailing 12 months** or
**10 million valid Shorts views in the trailing 90 days**. A separate,
lower "Fan Funding" tier exists in eligible countries starting around 500
subscribers / 3 public uploads / 3,000 watch hours or 3M Shorts views.
**Verify current numbers on YouTube's own Partner Program page before
planning around them — these thresholds have changed before and could
again.**

### YouTube's synthetic/altered content disclosure
If a video contains realistic synthetic media of real people, places, or
events, YouTube requires disclosure. This channel's stylized line-drawing
art is not that — but if you ever use AI image/video generation for
anything more photorealistic than the current hand-drawn style, check
YouTube's current altered-content policy before publishing, not after.

### Rights clearance checklist, per video, before it goes public
- [ ] Voice: you have commercial rights to the exact voice used (see
  ElevenLabs note above, or your voice actor's contract)
- [ ] Music/SFX: licensed for commercial YouTube use (YouTube Audio
  Library, or a licensed library — nothing in this repo sources music yet)
- [ ] Fonts: licensed for the intended use if you add a custom display
  font (`remotion-engine/README.md` known limitations)
- [ ] Fact-check sign-off completed by a human (`editorial-rules.md` §9),
  not just the automated Fact Checker agent
- [ ] Sources section written into the video description
  (`editorial-rules.md` §10)

### FTC "click-to-cancel" rule status (relevant specifically to Pilot 1)
`pilots/pilot-01-cancel-subscriptions/research-dossier.md` cites a 2024
FTC rule that's faced legal challenges since. **Check its current status
before publishing that specific video** — the dossier's phrasing was
written to be true regardless of outcome ("regulators moved to require
X"), but verify nothing has changed enough to need a script update.

## 4. Ongoing / creative decisions nothing here can make for you

- **Commissioning real channel art**: the hand illustration and icon
  library in `remotion-engine/` are functional placeholders, not the
  final visual identity. Budget for an illustrator if the channel gets
  real traction — `channel-bible/visual-style.md` is the brief.
- **Final topic approval, script sign-off, title/thumbnail selection,
  and the actual "make public" click** — these are the four human gates
  by design (`editorial-rules.md` §9). Nothing in this repo should ever
  be wired to skip them.
- **Deciding when Phase 1 → Phase 2 → Phase 2-channel-two** happens, based
  on real performance data the pipeline collects into `analytics/` but
  doesn't interpret for you.
