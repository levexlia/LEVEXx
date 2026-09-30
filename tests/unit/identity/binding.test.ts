import { describe, expect, it } from "vitest";
import { validateIdentityBinding } from "../../../packages/modules/identity/index";

describe("identity binding validation (not authentication)", () => {
  it.each(["oidc", "a.b-c_9", "a".repeat(64)])(
    "accepts provider %s",
    (provider) => {
      expect(() =>
        validateIdentityBinding({ provider, subject: "😀".repeat(255) })
      ).not.toThrow();
    }
  );
  it.each([
    "",
    "UPPER",
    " leading",
    "bad provider",
    "oidc\n",
    "oidc\r",
    "oidc\u2028",
    "a".repeat(65),
  ])("rejects invalid provider %s", (provider) => {
    expect(() =>
      validateIdentityBinding({ provider, subject: "subject" })
    ).toThrow("INVALID_IDENTITY_BINDING");
  });
  it.each(["", "x".repeat(256), "secret\0value"])(
    "rejects invalid subject without reflecting it",
    (subject) => {
      expect(() =>
        validateIdentityBinding({ provider: "oidc", subject })
      ).toThrow(/^INVALID_IDENTITY_BINDING$/);
    }
  );
});
