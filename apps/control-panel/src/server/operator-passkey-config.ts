// Only the explicitly isolated Operator test BFF uses these helpers.
// A bearer issued by Identity is never delivered to browser JavaScript.
export const OPERATOR_REFRESH_COOKIE = process.env.BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani_surface_operator_refresh" : "bthwani_operator_refresh";
export const OPERATOR_COOKIE = process.env.BTHWANI_SURFACE_PREVIEW === "1"
  ? "bthwani_surface_operator_session" : "bthwani_operator_session";

export type OperatorPasskeyConfig = {
  browserOrigin: string;
  identityOrigin: string;
};

type Settings = Record<string, string | undefined>;

const localHostnames = new Set(["localhost", "127.0.0.1"]);

function localOrigin(raw: string | undefined, allowedHosts: Set<string>): string | null {
  if (!raw?.startsWith("http://")) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "http:" ||
      !allowedHosts.has(parsed.hostname) ||
      !parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== raw
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// WebAuthn RP ID is localhost; the 127.0.0.1 alias is not a valid login origin.
// The only automatic redirect is between the two fixed loopback addresses.
export function canonicalOperatorEntryRedirect(host: string | null): string | null {
  return host === "127.0.0.1:13000" ? "http://localhost:13000/" : null;
}

export function resolveIsolatedOperatorConfig(env: Settings): OperatorPasskeyConfig | null {
  if (env.BTHWANI_ISOLATED_TEST_MODE !== "true" ||
      env.OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF !== "true") return null;
  const browserOrigin = localOrigin(
    env.OPERATOR_PASSKEY_BROWSER_ORIGIN,
    new Set(["localhost"]),
  );
  const identityOrigin = localOrigin(
    env.OPERATOR_PASSKEY_IDENTITY_ORIGIN,
    localHostnames,
  );
  return browserOrigin && identityOrigin ? { browserOrigin, identityOrigin } : null;
}

// Existing-account recovery is independently disabled until the canonical
// Identity owner and the control panel both explicitly opt in. This never
// enables first-Owner bootstrap or grants any new Operator permission.
export function resolveOperatorRecoveryConfig(env: Settings): OperatorPasskeyConfig | null {
  return env.OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF === "true"
    ? resolveIsolatedOperatorConfig(env) : null;
}

// Next.js normalizes request.url to its own loopback listen origin when an
// existing SSH TCP tunnel forwards localhost:13000 to the server's localhost:23010 URL.
// Only the exact fixed tunnel may use that internal URL. The actual HTTP
// Host, browser Origin (for mutations), and RP ID remain externally bound.
export function isTrustedOperatorLoopbackTarget(
  request: Request, browserOrigin: string, allowQuery = false,
): boolean {
  const target = new URL(request.url);
  const browserHost = new URL(browserOrigin).host;
  const internalTunnel = browserOrigin === "http://localhost:13000" &&
    target.origin === "http://localhost:23010";
  if ((target.origin !== browserOrigin && !internalTunnel) ||
      (!allowQuery && target.search !== "") || target.hash !== "" ||
      request.headers.get("host") !== browserHost) return false;
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && forwardedHost !== browserHost) return false;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto && forwardedProto !== "http") return false;
  for (const key of ["authorization", "x-actor-id", "x-operator-role", "x-role"]) {
    if (request.headers.has(key)) return false;
  }
  return true;
}

export function isTrustedOperatorRequest(
  request: Request, config: OperatorPasskeyConfig, method: "POST" | "PATCH" = "POST",
): boolean {
  return request.method === method &&
    request.headers.get("origin") === config.browserOrigin &&
    isTrustedOperatorLoopbackTarget(request, config.browserOrigin);
}

/** Additional explicit opt-in: an isolated WebAuthn login flag NEVER enables Root creation. */
export function resolveInitialOperatorBootstrapConfig(env: Settings): OperatorPasskeyConfig | null {
  const config = resolveIsolatedOperatorConfig(env);
  const browserOrigin = env.BTHWANI_SURFACE_PREVIEW === "1"
    ? "http://localhost:23100" : "http://localhost:13000";
  return config && env.OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF === "true" &&
    config.browserOrigin === browserOrigin ? config : null;
}
