# `src/views/community` – "Community" (P12)

`CommunityView` (export of `index.ts`, `h1` "Community") and the public share page `SharedView`. Data, flows and privacy
rules live in `src/social` (see its README); this folder is layout and effects only.

## States

| `data-state` | when | content |
|---|---|---|
| `off` | no cloud (file builds, `file://`, claude.ai, no `VITE_SUPABASE_*`) | `NoCloudState`: "Community braucht die Cloud" – an animated dot-matrix constellation (finite frames), the privacy principles, what the page would offer, and what still works locally (trade as picture). No request is ever made |
| `out` | cloud yes, signed out or 2FA pending | `SignedOutState`: the pitch + "Anmelden" / "Konto anlegen" (or the 2FA step) in the P09 auth sheet; a pending `?invite=` waits for the login |
| `in` | signed in | the page below |

## Page (lg, 12 columns)

| cell | component | effects |
|---|---|---|
| header | `PageHeader` (lead with `COMMUNITY_LEAD_FILL` = `storageKey("fill-community")`) | – |
| 5 | `YouCard` – pseudonym (+ re-roll), ranking opt-in, own 90-day figures (server or this device), percentile | pseudonym decodes (`TextScramble`), figures `NumberCascade`, percentile **`RingGauge` with the median marker**, `DistributionStrip` (p10–p90 band, you as a red tick) |
| 7 | `LeaderboardCard` – metric switch (`Segmented`), global / group, podium + rows, own row pinned | ranks / values **`TextRoll` mode `roll`**, rows **`HoverPillFor`** (group `community-board` → `layoutId="hover-community-board"`), own row **`SpotlightSweep`**, podium winner one `BorderBeam` lap |
| 12 | `GroupsSection` – `GroupSwitcher`, `GroupPanel` (members, roles, share level, invites, team seats, leave / delete), `MentorDesk` (review queue + goals), `ReviewFeed` | switcher = **`MagnifyRow` with `DotMatrix` monograms**, mentor queue **`CardSpread`**, comments **`StaggerItem`**, destructive actions `HoldConfirm` (+ inline Ja / Nein) |
| 7 | `SharesCard` – own links (views, expiry, revoke), share stats / a setup | list `Reveal` |
| 5 | `FeedbackCard` – Idee / Fehler / Lob, works signed out too | – |
| 12 | `CommunityMarquee` – promises true by construction + real numbers only (k-anonymous distribution, own group count) | **`Marquee`** drift (pauses off screen / on hover, static under reduced motion) |

Page sheets (create group, join, pick a trade, propose a goal) are store-driven (`openSheet`) and mounted once by
`CommunitySheets` at the page root – never inside a card (cards may carry a transform, which would trap a fixed sheet).
The share sheet is the app-level `SocialHost` (`@/social/ui`): its card is born via **`GlyphZoom`**, a copied link
confirms with a `ToastIsland` toast.

Phones: one column in the same order, the group switcher scrolls sideways, no horizontal page scroll at 390 px. Every
cell is a `Reveal` that ends at `transform: none`; decorative graphics are `aria-hidden`; only `ToastIsland` is
`aria-live`. Reduced motion (`useReducedFx`): every effect shows its end state.

## `SharedView` (route `#share/<token>`)

Public, no login: fetches `/api/v1/social/shared/<token>` once, shows the redacted card (`PayloadCard big`, one red
`SpotlightSweep`), date / expiry / views, "Als Grundlage übernehmen" for a shared setup (`withAdoptedSetup` → the visitor's own
journal settings), "Zum eigenen Journal" (`onOpenApp`), report (login needed). Expired / revoked / unknown links →
"Link nicht mehr gültig"; without cloud → says so. `data-phase`: `loading` · `ok` · `gone` · `error` · `off`.

## P14 wiring

- page `community` lazy: `import("@/views/community").then((m) => ({ default: m.CommunityView }))`; hide it from the
  nav when `!isCloudAvailable()` is fine but not needed (the view explains itself).
- router: `#share/<token>` → `<SharedView token={parseShareHash(location.hash)!} onOpenApp={() => navigate("overview")} />`
  (`parseShareHash` from `@/social/links`); `#community?invite=CODE` is read by the view itself.
- `App`: `<SocialHost />` once (after `SetupEditor`, before `Celebrate`); `TradeDetail`: `<ShareButton tradeId={t.id} />`.

Dev harness: `dev/community.html` (`#community`, `#trades` demo with a share button, `#share/<token>`, `?cloud=off`).
Tests: `tests/unit/social.ui.test.tsx`, `tests/e2e/community.spec.ts`.
