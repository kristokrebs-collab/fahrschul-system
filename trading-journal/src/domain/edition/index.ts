/**
 * Edition data switch. `__TJ_EDITION__` is a build-time constant, so the ternary folds and the other (pure) module
 * is dropped from the bundle: personal (web root, "persönlich" file) → `./personal`, share (`/teilen/`, "zum Teilen"
 * file) → `./share`. Both modules have the same shape: `RULES, SETUPS, BACKTEST, MARKET, CAPITAL, LEVERAGE_RULE, COPY`.
 * Never import `./personal` directly from app code (the share build would carry it; the privacy guard fails the build).
 */
import { EDITION } from "@/edition";
import * as personal from "./personal";
import * as share from "./share";

export const ED = EDITION === "share" ? share : personal;
export type EditionData = typeof personal | typeof share;
export type EditionCopy = (typeof ED)["COPY"];
