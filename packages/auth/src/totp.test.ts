import { authenticator } from "otplib";
import { describe, expect, it } from "vitest";
import { generateTotpSecret, verifyTotpToken } from "./totp.js";

describe("TOTP", () => {
  it("accepts a token generated from the same secret", () => {
    const secret = generateTotpSecret();
    const token = authenticator.generate(secret);
    expect(verifyTotpToken(token, secret)).toBe(true);
  });

  it("rejects a bogus token", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpToken("000000", secret)).toBe(false);
  });
});
