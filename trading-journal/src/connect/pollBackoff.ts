/**
 * Poll rhythm of the signal list (B3): fast while somebody waits for the test signal, then slower and slower – 2 s, 3.2 s, 5.1 s … at most
 * 20 s – and back to fast as soon as something new arrives. The caller pauses while the tab is hidden and stops after `POLL_TOTAL_MS`.
 * (Supabase Realtime would need the table in its publication and a browser client per dialog; a poll of one small request is enough here.)
 */
export const POLL_FIRST_MS = 2_000;
export const POLL_MAX_MS = 20_000;
export const POLL_TOTAL_MS = 10 * 60_000;

/** Delay before poll number `attempt` (0 = the first wait). */
export const nextDelay = (attempt: number): number => Math.min(POLL_MAX_MS, Math.round(POLL_FIRST_MS * 1.6 ** Math.max(0, attempt)));
