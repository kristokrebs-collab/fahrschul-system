/** HeroBackdrop: `document.fonts.ready` is read once per session (reading it forces a style + layout of the page). */
import { afterEach, describe, expect, it } from "vitest";
import { fontsReadyOnce, resetFontsReadyForTests } from "@/primitives/HeroBackdrop";

describe("fontsReadyOnce", () => {
  afterEach(() => {
    resetFontsReadyForTests();
    delete (document as { fonts?: unknown }).fonts;
  });
  /** jsdom has no FontFaceSet: install one on the document. */
  const install = (fonts: unknown) => Object.defineProperty(document, "fonts", { value: fonts, configurable: true });

  it("reads document.fonts.ready once: the same promise while pending, nothing once settled", async () => {
    let reads = 0;
    let resolve!: () => void;
    const ready = new Promise<void>((r) => (resolve = r));
    const fonts = Object.defineProperty({}, "ready", { get: () => (reads++, ready) });
    install(fonts);
    const a = fontsReadyOnce();
    const b = fontsReadyOnce();
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(reads).toBe(1);
    resolve();
    await a;
    expect(fontsReadyOnce()).toBeNull();
    expect(reads).toBe(1);
  });

  it("no FontFaceSet (old engines, jsdom): null, nothing read", () => {
    install(undefined);
    expect(fontsReadyOnce()).toBeNull();
  });
});
