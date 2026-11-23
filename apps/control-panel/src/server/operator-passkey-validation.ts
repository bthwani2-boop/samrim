const validBase64Url = /^[A-Za-z0-9_-]+$/;

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function exactKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every(field => Object.hasOwn(value, field));
}

function validOwnerDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validOwnerActorId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
      new TextEncoder().encode(value).length > 128) return false;
  // Identity rejects Unicode control code points and malformed UTF-8.
  // A lone UTF-16 surrogate would be silently replaced by TextEncoder.
  return Array.from(value).every(char => {
    const point = char.codePointAt(0);
    return point !== undefined && point >= 32 &&
      (point < 127 || point > 159) && (point < 0xd800 || point > 0xdfff);
  });
}

function validBinary(value: unknown, minimum = 1): value is string {
  return typeof value === "string" && value.length >= minimum &&
    value.length <= 1024 && validBase64Url.test(value);
}

export function parsePasskeyOptions(value: unknown): unknown | null {
  const envelope = object(value);
  const options = object(envelope?.options);
  const publicKey = object(options?.publicKey);
  const ceremonyId = envelope?.ceremonyId;
  if (!validBinary(ceremonyId, 43) || ceremonyId.length !== 43 ||
      !validBinary(publicKey?.challenge, 43) || publicKey?.rpId !== "localhost" ||
      publicKey?.userVerification !== "required") return null;
  return value;
}

export type IssuedOperatorToken = {
  accessToken: string;
  sessionExpiresAt: string;
};

export type VerifiedOperatorPrincipal = {
  actorId: string;
  role: "operator";
  sessionExpiresAt: string;
};

export function cookieLifetimeSeconds(value: string, now = Date.now()): number {
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= now) return 0;
  return Math.max(0, Math.min(1800, Math.floor((expiry - now) / 1000)));
}

export function parseIssuedOperatorToken(
  value: unknown,
  now = Date.now(),
): IssuedOperatorToken | null {
  const body = object(value);
  if (!body || !exactKeys(body, ["accessToken", "sessionExpiresAt"]) ||
      !validBinary(body.accessToken, 43) ||
      body.accessToken.length !== 43 || !validOwnerDateTime(body.sessionExpiresAt)) return null;
  const lifetime = Date.parse(body.sessionExpiresAt) - now;
  if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 31 * 60 * 1000) return null;
  return { accessToken: body.accessToken, sessionExpiresAt: body.sessionExpiresAt };
}

export function parseVerifiedOperatorPrincipal(
  value: unknown,
  token: IssuedOperatorToken,
  now = Date.now(),
): VerifiedOperatorPrincipal | null {
  const principal = object(value);
  if (!principal || !exactKeys(principal, ["actorId", "role", "sessionExpiresAt"]) ||
      !validOwnerActorId(principal.actorId) || principal.role !== "operator" ||
      !validOwnerDateTime(principal.sessionExpiresAt) ||
      Date.parse(principal.sessionExpiresAt) !== Date.parse(token.sessionExpiresAt) ||
      cookieLifetimeSeconds(principal.sessionExpiresAt, now) <= 0) return null;
  return {
    actorId: principal.actorId,
    role: "operator",
    sessionExpiresAt: principal.sessionExpiresAt,
  };
}

export function validAssertion(value: unknown): value is { ceremonyId: string; credential: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, "ceremonyId") ||
    !Object.hasOwn(body, "credential")) return false;
  if (typeof body.ceremonyId !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.ceremonyId)) return false;
  if (!body.credential || typeof body.credential !== "object" || Array.isArray(body.credential)) return false;
  const credential = body.credential as Record<string, unknown>;
  return credential.type === "public-key" &&
    typeof credential.id === "string" && credential.id.length > 0 && credential.id.length <= 2048 &&
    typeof credential.rawId === "string" && credential.rawId.length > 0 &&
    credential.rawId.length <= 2048 &&
    !!credential.response && typeof credential.response === "object" &&
    !Array.isArray(credential.response);
}

export function validInitialOperatorPayload(value: unknown, finish: boolean): boolean {
  const body = object(value);
  if (!body) return false;
  const keys = Object.keys(body).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (keys.join(",") !== (finish ? "ceremonyId,credential,proof" : "proof")) return false;
  if (typeof body.proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.proof)) return false;
  if (!finish) return true;
  if (typeof body.ceremonyId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.ceremonyId)) return false;
  const credential = object(body.credential);
  return credential?.type === "public-key" &&
    typeof credential.id === "string" && credential.id.length > 0 && credential.id.length <= 2048 &&
    typeof credential.rawId === "string" && credential.rawId.length > 0 && credential.rawId.length <= 2048 &&
    object(credential.response) !== null;
}

export function parseInitialOperatorOptions(value: unknown): unknown | null {
  const body = object(value);
  const opts = object(body?.options);
  const key = object(opts?.publicKey);
  const rp = object(key?.rp);
  const selection = object(key?.authenticatorSelection);
  const user = object(key?.user);
  if (typeof body?.ceremonyId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.ceremonyId) ||
      typeof key?.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key.challenge) ||
      rp?.id !== "localhost" || selection?.userVerification !== "required" ||
      selection?.residentKey !== "required" ||
      typeof user?.id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(user.id)) {
    return null;
  }
  return value;
}
