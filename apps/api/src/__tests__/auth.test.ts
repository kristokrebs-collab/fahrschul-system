import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildTestApp,
  ensureMigrated,
  extractCookie,
  seedFixtures,
  testDatabaseUrl,
  truncateAll,
  type SeededFixtures,
} from "./helpers.js";

describe("auth flow", () => {
  const databaseUrl = testDatabaseUrl();
  let app: FastifyInstance;
  let fixtures: SeededFixtures;

  beforeAll(async () => {
    await ensureMigrated(databaseUrl);
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(databaseUrl);
    fixtures = await seedFixtures(databaseUrl);
  });

  it("logs in with correct credentials and sets a session cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "schueler@test.local", password: fixtures.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();
    const body = res.json();
    expect(body.user.email).toBe("schueler@test.local");
    expect(body.user.rolle).toBe("schueler");
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "schueler@test.local", password: "totally-wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects login for an unknown email with the same generic error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "does-not-exist@test.local", password: "whatever12" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
  });

  it("requires a session for protected routes", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });

  it("allows access to protected routes with a valid session cookie", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "schueler@test.local", password: fixtures.password },
    });
    const cookie = extractCookie(loginRes.headers["set-cookie"]);

    const meRes = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.email).toBe("schueler@test.local");
  });

  it("rejects staff (buero) login without completed MFA setup", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "buero@test.local", password: fixtures.password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("mfa_setup_required");
  });

  it("invalidates the session after logout", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "schueler@test.local", password: fixtures.password },
    });
    const cookie = extractCookie(loginRes.headers["set-cookie"]);

    const logoutRes = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await app.inject({ method: "GET", url: "/me", headers: { cookie } });
    expect(meRes.statusCode).toBe(401);
  });
});
