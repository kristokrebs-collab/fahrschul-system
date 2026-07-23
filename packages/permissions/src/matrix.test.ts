import { describe, expect, it } from "vitest";
import { ROLES } from "@fahrschul/domain";
import { hasPermission, ROLE_PERMISSIONS } from "./matrix.js";

describe("role-permission matrix", () => {
  it("defines an entry for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });

  it("gives schueler no access to any-scope student data", () => {
    expect(hasPermission("schueler", "students:read:any")).toBe(false);
    expect(hasPermission("schueler", "students:read:own")).toBe(true);
  });

  it("gives systemdienst only technical permissions, no student data", () => {
    expect(hasPermission("systemdienst", "students:read:any")).toBe(false);
    expect(hasPermission("systemdienst", "students:read:own")).toBe(false);
    expect(hasPermission("systemdienst", "system:admin")).toBe(true);
  });

  it("gives finanzen payment/bank permissions but not appointment booking", () => {
    expect(hasPermission("finanzen", "payments:manage")).toBe(true);
    expect(hasPermission("finanzen", "bank:reconcile")).toBe(true);
    expect(hasPermission("finanzen", "appointments:create")).toBe(false);
  });

  it("gives buero appointment creation and document verification", () => {
    expect(hasPermission("buero", "appointments:create")).toBe(true);
    expect(hasPermission("buero", "documents:verify")).toBe(true);
  });

  it("lets schueler accept an offer but not create arbitrary appointments", () => {
    expect(hasPermission("schueler", "appointments:accept:own")).toBe(true);
    expect(hasPermission("schueler", "appointments:create")).toBe(false);
  });

  it("only fahrlehrer/buero may set an exam clearance, never schueler", () => {
    expect(hasPermission("fahrlehrer", "exam:clearance:set")).toBe(true);
    expect(hasPermission("buero", "exam:clearance:set")).toBe(true);
    expect(hasPermission("schueler", "exam:clearance:set")).toBe(false);
  });

  it("schueler is read-only on exam readiness", () => {
    expect(hasPermission("schueler", "exam:read:own")).toBe(true);
    expect(hasPermission("schueler", "exam:clearance:set")).toBe(false);
  });
});
