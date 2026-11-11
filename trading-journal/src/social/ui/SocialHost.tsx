import { ShareSheet } from "./ShareSheet";

/**
 * Leaf host of the community (P12): the one share sheet of the app. P14 mounts it once in `App` (after `SetupEditor`,
 * before `Celebrate`, with `data-layer` like the other hosts). Inert until `openShare(…)`; no network on mount.
 */
export function SocialHost() {
  return <ShareSheet />;
}
