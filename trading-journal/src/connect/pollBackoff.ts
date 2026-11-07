/**
 * Poll rhythm of the signal list (B3): fast while somebody waits for the test signal, then slower and slower – 2 s, 3.2 s, 5.1 s … at most
 * 20 s – and back to fast as soon as something new arrives (`nextAttempt`). The caller pauses while the tab is hidden and stops after
 * `POLL_TOTAL_MS`. (Supabase Realtime would need the table in its publication and a browser client per dialog; one small request is enough.)
 */
export const POLL_FIRST_MS = 2_000;
export const POLL_MAX_MS = 20_000;
export const POLL_TOTAL_MS = 10 * 60_000;

let scale = 1;
/** Tests only: shortens every wait (0.02 → 40 ms … 400 ms) so a test can watch the rhythm with real timers. */
export function setPollScaleForTests(s: number): void {
  scale = s > 0 ? s : 1;
}

/** Delay before poll number `attempt` (0 = the first wait). */
export const nextDelay = (attempt: number): number => Math.round(Math.min(POLL_MAX_MS, Math.round(POLL_FIRST_MS * 1.6 ** Math.max(0, attempt))) * scale);

/** The attempt counter after a poll: back to 0 when the newest entry changed, else one step slower. */
export const nextAttempt = (attempt: number, changed: boolean): number => (changed ? 0 : attempt + 1);
