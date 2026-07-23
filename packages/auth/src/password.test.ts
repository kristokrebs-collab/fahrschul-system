import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const a = await hashPassword("correct-horse-battery-staple");
    const b = await hashPassword("correct-horse-battery-staple");
    expect(a).not.toBe(b);
  });
});
