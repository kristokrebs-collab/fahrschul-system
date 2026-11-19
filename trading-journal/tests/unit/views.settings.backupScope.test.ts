/**
 * Funktionsprüfung Runde 18: backup → wipe → restore brought the journal back, but saved views and the Labor's versions were gone –
 * and the card had never said they are not part of the backup. The card now names both sides. This test pins the sentence against
 * the code: what it lists as „Im Backup“ is what the backup writes, what it lists as device-only really has its own storage key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATA_KEYS, KEYS, storageKey } from "@/store/storage";
import { DATA_STRINGS } from "@/views/settings/DataCard";

const read = (p: string) => readFileSync(p, "utf8");

describe("Einstellungen › Daten: the card says what the backup holds and what stays on the device", () => {
  it("names both sides and is rendered by the card", () => {
    const [inBackup, onDevice] = DATA_STRINGS.scope.split("Nur in diesem Browser");
    expect(inBackup).toMatch(/^Im Backup: Trades, Tagesnotizen und Einstellungen/);
    for (const w of ["gespeicherte Ansichten", "Labor-Entwürfe", "-Versionen", "-Läufe", "Simulationen", "Cockpit-Layout", "Datenarchiv"]) expect(onDevice, w).toContain(w);
    expect(read("src/views/settings/DataCard.tsx")).toContain("{DATA_STRINGS.scope}");
  });

  it("the journal is exactly the four synced parts – none of the device-only stores is among them", () => {
    expect([...DATA_KEYS].sort()).toEqual([KEYS.days, KEYS.hyblock, KEYS.settings, KEYS.trades].sort());
    // each device-only thing the sentence names has a storage key of its own, in the file that owns it
    const own: [string, string][] = [
      ["views", "src/store/viewsStore.ts"],
      ["labor-drafts", "src/views/labor/laborStore.ts"],
      ["labor-draft-versions", "src/views/labor/versionsStore.ts"],
      ["labor-runs", "src/views/labor/laborStore.ts"],
      ["timemachine", "src/views/timemachine/simStore.ts"],
      ["cockpit", "src/views/cockpit/cockpitStore.ts"],
    ];
    for (const [key, file] of own) {
      expect(read(file), `${file} owns ${key}`).toContain(`storageKey("${key}")`);
      expect(DATA_KEYS).not.toContain(storageKey(key));
    }
  });
});
