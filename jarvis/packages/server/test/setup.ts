/**
 * Test setup. Runs before any module — importantly before `config.ts` reads the
 * environment.
 *
 * Tests must not depend on a developer's `.env` being present, or on which
 * directory vitest happens to be launched from. Pinning the values here makes
 * the crypto paths exercised deterministically everywhere, including CI.
 */
process.env.JARVIS_MASTER_KEY ??= '0'.repeat(63) + '1'   // 32 bytes, hex
process.env.JARVIS_SESSION_SECRET ??= 'test-session-secret-not-used-in-production'
process.env.NODE_ENV = 'test'
process.env.JARVIS_OFFLINE ??= 'true'                    // no outbound calls from tests
process.env.JARVIS_EMBEDDINGS ??= 'local-lexical'
process.env.JARVIS_LOG_LEVEL ??= 'error'
// Keep test artefacts out of the real data directory.
process.env.JARVIS_DATA_DIR ??= './.test-data'
