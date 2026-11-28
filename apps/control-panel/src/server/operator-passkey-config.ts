/** Server-side isolated Operator origin and cookie boundary. Identity owns credentials and grants. */
export const OPERATOR_COOKIE = "bthwani_operator_session";
export const OPERATOR_REFRESH_COOKIE = "bthwani_operator_refresh";

export type OperatorPasskeyConfig = Readonly<{
  browserOrigin: string;
  identityOrigin: string;
}>;

type Settings = Record<string, string | undefined>;

const canonicalBrowserOrigin = "http://localhost:13000";
const retiredBrowserOrigins = new Set(["http://localhost:23010", "http://localhost:23100"]);

function explicitLoopback(raw: string | undefined, browser: boolean): URL | null {
  if (typeof raw !== "string" || !raw.startsWith("http://")) return null;
  try {
    const url = new URL(raw);
    const allowedHost = url.hostname === "localhost" || (!browser && url.hostname === "127.0.0.1");
    return allowedHost && url.protocol === "http:" && url.port &&
      !url.username && !url.password && url.pathname === "/" &&
      !url.search && !url.hash && raw === url.origin &&
      (!browser || !retiredBrowserOrigins.has(url.origin)) ? url : null;
  } catch {
    return null;
  }
}

// A fixed UI entry redirect does not authorize an authentication request.
export function canonicalOperatorEntryRedirect(host: string | null): string | null {
  return host === "127.0.0.1:13000" ? canonicalBrowserOrigin + "/" : null;
}

export function resolveIsolatedOperatorConfig(env: Settings): OperatorPasskeyConfig | null {
  if (env.BTHWANI_ISOLATED_TEST_MODE !== "true" ||
      env.OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF !== "true") return null;
  const browser = explicitLoopback(env.OPERATOR_PASSKEY_BROWSER_ORIGIN, true);
  const identity = explicitLoopback(env.OPERATOR_PASSKEY_IDENTITY_ORIGIN, false);
  return browser && identity ? { browserOrigin: browser.origin, identityOrigin: identity.origin } : null;
}

export function resolveOperatorRecoveryConfig(env: Settings): OperatorPasskeyConfig | null {
  return env.OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF === "true"
    ? resolveIsolatedOperatorConfig(env) : null;
}

export function resolveInitialOperatorBootstrapConfig(env: Settings): OperatorPasskeyConfig | null {
  if (env.OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF !== "true") return null;
  const config = resolveIsolatedOperatorConfig(env);
  return config?.browserOrigin === canonicalBrowserOrigin ? config : null;
}

export function isTrustedOperatorLoopbackTarget(
  request: Request, browserOrigin: string, allowQuery = false,
): boolean {
  const browser = explicitLoopback(browserOrigin, true);
  if (!browser) return false;
  try {
    const target = new URL(request.url);
    if (target.origin !== browser.origin || target.username || target.password ||
        (!allowQuery && target.search) || target.hash ||
        request.headers.get("host") !== browser.host) return false;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if ((forwardedHost !== null && forwardedHost !== browser.host) ||
        (forwardedProto !== null && forwardedProto !== "http")) return false;
    return !["authorization", "x-actor-id", "x-operator-role", "x-role"]
      .some(header => request.headers.has(header));
  } catch {
    return false;
  }
}

export function isTrustedOperatorRequest(
  request: Request, config: OperatorPasskeyConfig, method: "POST" | "PATCH" = "POST",
): boolean {
  return request.method === method &&
    request.headers.get("origin") === config.browserOrigin &&
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    isTrustedOperatorLoopbackTarget(request, config.browserOrigin);
}
