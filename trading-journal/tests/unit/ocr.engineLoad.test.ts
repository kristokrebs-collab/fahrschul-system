/**
 * Runde 13 (Funktionsprüfung): the screenshot reader fetches its engine (≈ 8 MB, self-hosted `/ocr/…`) on the first use. Found by blocking
 * those files in the production build: offline on the first use the sheet only said „Das Auslesen hat nicht geklappt.“ – no word about
 * the connection or about the one-off download (and in some browsers it would have shown a raw English „Failed to fetch“).
 */
import { describe, expect, it, vi } from "vitest";
import { ENGINE_LOAD_MESSAGE, EngineLoadError, PictureError, startEngine } from "@/journal/ocr/browser";

const engine = vi.hoisted(() => ({ failWith: null as unknown }));
vi.mock("@/journal/ocr/engine", () => ({
  createTesseractEngine: async () => {
    if (engine.failWith !== null) throw engine.failWith;
    return { recognize: async () => [], terminate: async () => undefined };
  },
}));

describe("startEngine", () => {
  it("any failure to fetch or start the engine becomes one German sentence that names the connection and the one-off download", async () => {
    for (const failure of [new TypeError("Failed to fetch"), new Error(""), new Event("error"), "NetworkError when attempting to fetch resource.", undefined]) {
      engine.failWith = failure ?? new Error("x");
      const err = await startEngine().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, String(failure)).toBeInstanceOf(EngineLoadError);
      expect(err, String(failure)).toBeInstanceOf(PictureError);
      expect((err as Error).message).toBe(ENGINE_LOAD_MESSAGE);
      expect((err as Error).message).not.toMatch(/Failed|NetworkError|fetch/);
    }
    expect(ENGINE_LOAD_MESSAGE).toContain("Internetverbindung");
    expect(ENGINE_LOAD_MESSAGE).toContain("einmalig");
  });

  it("keeps the cause for the console and starts fine when the files are there", async () => {
    const boom = new TypeError("Failed to fetch");
    engine.failWith = boom;
    const err = (await startEngine().catch((e: unknown) => e)) as EngineLoadError;
    expect(err.cause).toBe(boom);
    engine.failWith = null;
    const ok = await startEngine();
    expect(typeof ok.recognize).toBe("function");
  });
});
