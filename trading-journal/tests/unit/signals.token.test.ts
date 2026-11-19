// @vitest-environment node
/// <reference types="node" />
/**
 * Token check of the signal receiver (B3): ONE constant-time comparison on every path – valid token, unknown token, wrong shape, revoked,
 * wrong scope – so the work done does not tell which case it was; and the comparison is `timingSafeEqual`, not `===`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:crypto")>();
  return { ...orig, timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => (calls.n++, orig.timingSafeEqual(a, b)) };
});

import { resolveSignalOwner } from "../../netlify/functions/_lib/signals/receive";
import { createToken } from "../../netlify/functions/_lib/exchanges/tokens";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { fakeAdmin, type State } from "./helpers/connectFake";

const U1 = "11111111-1111-4111-8111-111111111111";
let state: State;

beforeEach(() => {
  state = { tables: {}, claims: null, rpcCalls: [] };
  setSupabaseAdminForTests(fakeAdmin(state));
  calls.n = 0;
});
afterEach(() => setSupabaseAdminForTests(null));

describe("resolveSignalOwner", () => {
  it("compares exactly once per call on every path, with timingSafeEqual", async () => {
    const good = (await createToken(U1, "a", ["webhook:tradingview"])).token;
    const noScope = (await createToken(U1, "b", ["trades:read"])).token;
    const gone = (await createToken(U1, "c", ["webhook:tradingview"])).token;
    for (const t of state.tables.api_tokens!) if (t.name === "c") t.revoked_at = new Date().toISOString();
    calls.n = 0;
    await expect(resolveSignalOwner(good)).resolves.toMatchObject({ userId: U1 });
    expect(calls.n).toBe(1);
    for (const t of [`tj_${"U".repeat(43)}`, "nonsense", "", noScope, gone]) {
      calls.n = 0;
      await expect(resolveSignalOwner(t), t).rejects.toMatchObject({ status: 401, code: "invalid_token" });
      expect(calls.n, t).toBe(1);
    }
  });

  it("every failure is the same error object content", async () => {
    const msgs = new Set<string>();
    for (const t of ["x", `tj_${"U".repeat(43)}`]) {
      try {
        await resolveSignalOwner(t);
      } catch (e) {
        msgs.add(JSON.stringify([(e as { status: number }).status, (e as { code: string }).code, (e as Error).message]));
      }
    }
    expect(msgs.size).toBe(1);
  });
});
