import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, ensureMigrated, extractCookie, idemKey, seedFixtures, testDatabaseUrl, truncateAll, type SeededFixtures } from "./helpers.js";

async function loginAs(app: FastifyInstance, email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return extractCookie(res.headers["set-cookie"]);
}

describe("role-based middleware", () => {
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

  it("blocks a schueler from creating an appointment (403, not 500 or 200)", async () => {
    const cookie = await loginAs(app, "schueler@test.local", fixtures.password);

    const res = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": idemKey(), cookie },
      payload: {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: "2026-08-03T09:00:00.000Z",
        endeAt: "2026-08-03T10:00:00.000Z",
        art: "Übungsstunde",
        klasse: "B",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("forbidden");
  });

  it("allows a fahrlehrer (who has appointments:create) to create an appointment", async () => {
    const cookie = await loginAs(app, "fahrlehrer@test.local", fixtures.password);

    const res = await app.inject({
      method: "POST",
      url: "/appointments",
      headers: { "idempotency-key": idemKey(), cookie },
      payload: {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        fahrzeugId: fixtures.fahrzeugId,
        beginnAt: "2026-08-03T09:00:00.000Z",
        endeAt: "2026-08-03T10:00:00.000Z",
        art: "Übungsstunde",
        klasse: "B",
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it("rejects unauthenticated requests to /appointments with 401, not 403", async () => {
    const res = await app.inject({ headers: { "idempotency-key": idemKey() },
      method: "POST",
      url: "/appointments",
      payload: {
        schuelerId: fixtures.schuelerId,
        fahrlehrerId: fixtures.fahrlehrerId,
        beginnAt: "2026-08-03T09:00:00.000Z",
        endeAt: "2026-08-03T10:00:00.000Z",
        art: "Übungsstunde",
        klasse: "B",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
