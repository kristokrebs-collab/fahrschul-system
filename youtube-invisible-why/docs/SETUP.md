# Setup — what you actually need to do

Everything in this repo automates the *work*. It cannot create accounts,
accept terms of service, pay for API usage, or make legal/creative
judgment calls on your behalf — those require your identity, your payment
method, and your legal signature, so they have to happen in your browser,
not in an agent session. This is the complete list of what's on you,
organized by how soon you'll hit it. Every fact below was checked against
live web search on 2026-08-05, not just training knowledge — dated
so you know how fresh it is.

## API keys — where to get every one, in the order you'll need them

| # | Service | Get it at | Needed for |
|---|---|---|---|
| 1 | **Anthropic (Claude)** | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | Every one of the 8 agents — this is the one you need first |
| 2 | **ElevenLabs** | [elevenlabs.io](https://elevenlabs.io) → sign up → Profile → API Keys | Voiceover generation |
| 3 | **Google Cloud / YouTube Data API** | [console.cloud.google.com](https://console.cloud.google.com) → new project → enable "YouTube Data API v3" → Credentials → OAuth client ID | Private upload + analytics |
| 4 | **SerpApi** (optional) | [serpapi.com](https://serpapi.com) | Google Trends signal only — pipeline works without it |
| 5 | **Slack incoming webhook** (optional) | your Slack workspace → Apps → Incoming Webhooks | Review/analytics notifications — swap for email/Telegram if you don't use Slack |

### 1. Anthropic — do this one first
1. Go to **console.anthropic.com**, sign up or log in.
2. **Settings → Billing → add a payment method.** Requests are rejected
   until the account can be billed — do this before generating a key or
   you'll just get confused 400s later.
3. **Settings → API Keys → Create Key.** Name it something like
   "invisible-why-pipeline". The key is shown exactly once — copy it
   immediately, it isn't stored anywhere you can retrieve later (you'd
   have to revoke and make a new one).
4. Keys look like `sk-ant-...`. Put it in n8n as the `Anthropic API Key`
   credential (n8n/README.md) — **don't paste it into a chat with me or
   any other AI assistant**; treat it like a password.
5. Budget for usage: 8 agent calls per video, several thousand input/
   output tokens each (dossiers and scripts are long). Watch usage in the
   Console's Usage tab for the first few videos to calibrate real cost.

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
For the voiceover step. As of 2026, ElevenLabs' **Free plan is explicitly
non-commercial** (attribution required, no commercial rights) — you need
at least the **Starter plan (~$5/month)**, which is the tier where
commercial usage rights and instant voice cloning both switch on. Higher
tiers (Creator/Pro/Scale) add more monthly characters and better voice
models, not different rights — Starter is enough to legally start.
Confirm current terms at elevenlabs.io/pricing before relying on this;
pricing pages change more often than legal terms do. Decide up front:
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

### YouTube Partner Program eligibility (verified current as of 2026-08-05)
Standard ad-revenue tier requires **1,000 subscribers** and either
**4,000 valid public watch hours in the trailing 12 months** or **10
million valid Shorts views in the trailing 90 days** (Shorts watch time
does not count toward the 4,000-hour figure — they're separate paths, not
combinable). A lower **"Early Access" fan-funding tier** (Super Thanks,
Memberships, etc., not ads) now has two entry points: 500 subscribers +
3,000 watch hours (or 3M Shorts views in 90 days), or 1,000 subscribers on
the Shorts-views path. Both tiers additionally require **two-factor
authentication enabled on the channel's Google account** and no active
Community Guidelines strikes. Always re-check
[support.google.com/youtube/answer/72851](https://support.google.com/youtube/answer/72851)
before planning around exact numbers — they've moved before.

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

### FTC "click-to-cancel" rule status (relevant specifically to Pilot 1) — updated 2026-08-05
The dossier and script have been updated with the current, verified
timeline: the Eighth Circuit **vacated** the FTC's Negative Option
("click-to-cancel") Rule on July 8, 2025 on procedural grounds (the FTC
skipped a required economic-impact analysis) — not because regulators
changed their mind on the substance. The FTC has since **restarted**
rulemaking: it sent a draft ANPRM to OIRA in January 2026 and issued the
Advance Notice of Proposed Rulemaking in March 2026, aimed at curing the
procedural defect rather than rewriting the policy. Separately, the FTC's
underlying enforcement authority against deceptive cancellation practices
under ROSCA (a different, older statute) was never affected by the
vacatur and continues. Re-check this before publishing — rulemaking
timelines move, and this could easily be further along (or resolved) by
the time you actually render this video.

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
