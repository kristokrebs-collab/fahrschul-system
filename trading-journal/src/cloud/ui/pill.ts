import type { StatusTone } from "@/motion/StatusPill";
import type { CloudPhase } from "../session";
import type { SyncPhase } from "../sync/status";
import { PILL } from "./pillStrings";

/** `layoutId` the header pill and the login sheet share (the sheet morphs out of the pill). */
export const AUTH_LAYOUT_ID = "auth-sheet";

/** Tone + label of the account / sync pill for a sync phase. */
export function syncPill(sync: SyncPhase, auth: CloudPhase): { tone: StatusTone; label: string } {
  if (auth !== "signedIn") return { tone: "muted", label: PILL.signIn };
  switch (sync) {
    case "live":
      return { tone: "live", label: PILL.live };
    case "connecting":
      return { tone: "muted", label: PILL.connecting };
    case "syncing":
      return { tone: "muted", label: PILL.syncing };
    case "offline":
      return { tone: "warn", label: PILL.offline };
    case "error":
      return { tone: "error", label: PILL.error };
    case "paused":
      return { tone: "muted", label: PILL.paused };
    case "locked":
      return { tone: "warn", label: PILL.locked };
    default:
      return { tone: "muted", label: PILL.signedIn };
  }
}
