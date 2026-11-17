/** Launch-Audit D1, B10: operator setup hints never show in front of a visitor – only on request (`?debug`). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wantsOperatorHints } from "@/lib/operatorHints";

describe("operator hints", () => {
  it("an ordinary address does not ask for them", () => {
    for (const href of ["https://j.example/", "https://j.example/#konto", "https://j.example/?order=premium.year.1#preise", "https://j.example/#community?tab=gruppen", "kein url"]) {
      expect(wantsOperatorHints(href), href).toBe(false);
    }
  });

  it("`?debug` in the search or in the hash query asks for them, with any value", () => {
    for (const href of ["https://j.example/?debug", "https://j.example/?debug=layers#konto", "https://j.example/#konto?debug", "https://j.example/#community?tab=gruppen&debug=1"]) {
      expect(wantsOperatorHints(href), href).toBe(true);
    }
  });

  it("both places that name environment variables ask first", () => {
    for (const file of ["src/cloud/ui/CloudUnavailableCard.tsx", "src/views/community/NoCloudState.tsx"]) {
      const src = readFileSync(file, "utf8");
      const line = src.split("\n").find((l) => /unavailableOwner|noCloudOwner/.test(l)) ?? "";
      expect(line, file).toContain("operatorHints() &&");
    }
  });
});
