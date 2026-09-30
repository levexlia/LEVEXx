/** Transport identity is never a canonical actor or role claim. */
export interface AuthenticatedIdentity {
  provider: string;
  subject: string;
}

export function validateIdentityBinding(identity: AuthenticatedIdentity): void {
  if (
    identity.provider !== identity.provider.trim() ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(identity.provider)
  ) {
    throw new Error("INVALID_IDENTITY_BINDING");
  }
  // PostgreSQL varchar length counts code points, not UTF-16 code units.
  const length = [...identity.subject].length;
  if (length < 1 || length > 255 || identity.subject.includes("\0")) {
    throw new Error("INVALID_IDENTITY_BINDING");
  }
}
