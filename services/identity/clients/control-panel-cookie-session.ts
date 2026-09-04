export type ControlPanelCookieSessionOutcome =
  | "ready"
  | "expired"
  | "unavailable"
  | "concurrent";

export const CONTROL_PANEL_SESSION_EXPIRED_EVENT = "bthwani:identity-session-expired";

const CONTROL_PANEL_SESSION_ENDPOINT = "/api/auth/session";
const CONTROL_PANEL_SESSION_LOCK = "bthwani:control-panel-cookie-session";

type BrowserLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

let controlPanelSessionRecoveryInFlight: Promise<ControlPanelCookieSessionOutcome> | null = null;

function browserLockManager(): BrowserLockManager | null {
  if (typeof globalThis !== "object" || !("navigator" in globalThis)) return null;
  const candidate = (globalThis as typeof globalThis & {
    navigator?: { readonly locks?: BrowserLockManager };
  }).navigator?.locks;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

async function responseCode(response: Response): Promise<string> {
  const body = await response.clone().json().catch(() => null) as { code?: unknown } | null;
  return typeof body?.code === "string" ? body.code : "";
}

async function inspectControlPanelCookieSession(): Promise<ControlPanelCookieSessionOutcome> {
  let response: Response;
  try {
    response = await fetch(CONTROL_PANEL_SESSION_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return "unavailable";
  }

  if (response.ok) return "ready";

  const code = await responseCode(response);
  if (response.status === 409 && code === "REFRESH_ALREADY_ROTATED") return "concurrent";
  if (response.status === 401 || response.status === 403) return "expired";
  if (response.status === 502 || response.status === 503 || response.status === 504) return "unavailable";
  return "unavailable";
}

async function convergeControlPanelCookieSession(): Promise<ControlPanelCookieSessionOutcome> {
  const first = await inspectControlPanelCookieSession();
  if (first !== "concurrent") return first;

  // A 409 means another request owns the rotation. Re-check under the same
  // browser-wide lock so the shared HttpOnly cookie jar can observe the
  // winner's Set-Cookie without treating the loser as a signed-out session.
  await Promise.resolve();
  return inspectControlPanelCookieSession();
}

async function runControlPanelCookieSessionRecovery(): Promise<ControlPanelCookieSessionOutcome> {
  const locks = browserLockManager();
  return locks
    ? locks.request(CONTROL_PANEL_SESSION_LOCK, convergeControlPanelCookieSession)
    : convergeControlPanelCookieSession();
}

export async function ensureControlPanelCookieSession(): Promise<ControlPanelCookieSessionOutcome> {
  if (controlPanelSessionRecoveryInFlight) return controlPanelSessionRecoveryInFlight;

  const recovery = runControlPanelCookieSessionRecovery();
  controlPanelSessionRecoveryInFlight = recovery;
  try {
    return await recovery;
  } finally {
    if (controlPanelSessionRecoveryInFlight === recovery) {
      controlPanelSessionRecoveryInFlight = null;
    }
  }
}

export function notifyControlPanelSessionExpired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONTROL_PANEL_SESSION_EXPIRED_EVENT));
  }
}

async function responseNeedsControlPanelSessionRecovery(response: Response): Promise<boolean> {
  if (response.status === 401) return true;
  return response.status === 409
    && (await responseCode(response)) === "REFRESH_ALREADY_ROTATED";
}

function syntheticSessionResponse(
  status: 409 | 503,
  code: "REFRESH_ALREADY_ROTATED" | "IDENTITY_UNAVAILABLE",
): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Shared control-panel browser retry boundary for every cookie-authenticated
 * service client. It is the only browser owner of session recovery semantics:
 * exact session inspection/rotation happens server-side, browser tabs serialize
 * with Web Locks where available, and only authoritative expiry emits the
 * session-expired event.
 */
export async function executeWithControlPanelCookieSession(
  execute: () => Promise<Response>,
  cookieMode: boolean,
): Promise<Response> {
  let response = await execute();
  if (!cookieMode || !(await responseNeedsControlPanelSessionRecovery(response))) {
    return response;
  }

  const outcome = await ensureControlPanelCookieSession();
  switch (outcome) {
    case "ready":
      response = await execute();
      if (await responseNeedsControlPanelSessionRecovery(response)) {
        if (response.status === 401) notifyControlPanelSessionExpired();
      }
      return response;
    case "expired":
      notifyControlPanelSessionExpired();
      return response;
    case "concurrent":
      return syntheticSessionResponse(409, "REFRESH_ALREADY_ROTATED");
    case "unavailable":
      return syntheticSessionResponse(503, "IDENTITY_UNAVAILABLE");
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
