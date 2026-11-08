/**
 * The deterministic synthetic market lives in `src/showroom/mock/synth.ts` since Paket S (the Showroom's in-app Binance fixtures use the same
 * price path and ratio scripts as the e2e suite). Pure, no Playwright – this file only keeps the old import path.
 */
export * from "../../../src/showroom/mock/synth";
