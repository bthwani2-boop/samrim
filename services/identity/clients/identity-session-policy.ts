import type { ActorIdentity } from "./identity-client.ts";
import type { IdentitySessionState } from "./identity-session-store.ts";

export type IdentitySessionAction =
  | "configure"
  | "retry_bootstrap"
  | "login"
  | "request_activation"
  | "consume_activation"
  | "read_session"
  | "list_sessions"
  | "revoke_session"
  | "logout"
  | "change_password"
  | "delete_account";

export type IdentityErrorPresentation = {
  readonly title: string;
  readonly description: string;
  readonly retryable: boolean;
};

const ROLE_SURFACE = Object.freeze({
  operator: "control-panel",
  client: "app-client",
  partner: "app-partner",
  field: "app-field",
  captain: "app-captain",
} as const);

export type GovernedIdentityRole = keyof typeof ROLE_SURFACE;
export type GovernedIdentitySurface = (typeof ROLE_SURFACE)[GovernedIdentityRole];

export function governedIdentitySurfaceForRole(role: string): GovernedIdentitySurface | null {
  return Object.hasOwn(ROLE_SURFACE, role)
    ? ROLE_SURFACE[role as GovernedIdentityRole]
    : null;
}

/**
 * Canonical authentication boundary for a concrete product surface.
 *
 * surfaceAccess says the actor is allowed to use the surface at all;
 * sessionSurface says this exact live session was issued for that surface.
 * Both must be true. This intentionally does not impose a business role:
 * control-panel employees, for example, are authorized by their permissions
 * after the session has passed this surface boundary.
 */
export function identitySessionIsBoundToSurface(
  identity: unknown,
  requiredSurface: string,
): identity is ActorIdentity {
  if (!identity || typeof identity !== "object") return false;
  const candidate = identity as Partial<ActorIdentity>;
  const surfaceAccess = candidate.surfaceAccess;
  return candidate.authState === "authenticated"
    && candidate.sessionSurface === requiredSurface
    && typeof surfaceAccess === "object"
    && surfaceAccess !== null
    && surfaceAccess[requiredSurface] === true;
}

/**
 * Canonical role + surface authorization used by role-owned application
 * surfaces. The role-to-surface mapping and the exact active session binding
 * must both agree.
 */
export function identitySessionAuthorizesSurface(
  identity: unknown,
  requiredRole: string,
  requiredSurface: string,
): identity is ActorIdentity {
  if (!identitySessionIsBoundToSurface(identity, requiredSurface)) return false;
  const expectedSurface = governedIdentitySurfaceForRole(requiredRole);
  return expectedSurface === requiredSurface
    && identity.roles.some((role) => role === requiredRole);
}

export function identitySessionAllowedActions(state: IdentitySessionState): readonly IdentitySessionAction[] {
  switch (state.kind) {
    case "unconfigured":
      return ["configure"];
    case "restoring":
    case "authenticating":
      return [];
    case "service_unavailable":
      return ["retry_bootstrap"];
    case "signed_out":
    case "error":
      return ["login", "request_activation", "consume_activation"];
    case "authenticated":
      return [
        "read_session",
        "list_sessions",
        "revoke_session",
        "logout",
        "change_password",
        "delete_account",
      ];
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function identityErrorPresentation(code: string): IdentityErrorPresentation {
  switch (code) {
    case "FORBIDDEN":
    case "CORS_ORIGIN_FORBIDDEN":
    case "SESSION_SURFACE_MISMATCH":
    case "CONTROL_PANEL_FORBIDDEN":
      return {
        title: "الوصول غير مسموح",
        description: "لا يملك هذا الحساب أو هذه الجلسة صلاحية استخدام السطح المطلوب.",
        retryable: false,
      };
    case "ACTOR_DEACTIVATED":
      return {
        title: "الحساب معطل",
        description: "تم حظر هذا الحساب. يرجى التواصل مع الدعم.",
        retryable: false,
      };
    case "PHONE_ALREADY_BOUND":
    case "USERNAME_TAKEN":
    case "SESSION_NOT_FOUND":
      return {
        title: "تعارض في الهوية",
        description: "تغيّرت حالة الحساب. حدّث البيانات ثم أعد المحاولة.",
        retryable: true,
      };
    case "ACTIVATION_RATE_LIMITED":
    case "LOGIN_RATE_LIMITED":
      return {
        title: "محاولات كثيرة",
        description: "انتظر قليلًا قبل إعادة المحاولة.",
        retryable: true,
      };
    case "IDENTITY_SESSION_INVALID":
    case "INVALID_REFRESH_TOKEN":
    case "UNAUTHENTICATED":
      return {
        title: "انتهت الجلسة",
        description: "سجّل الدخول أو فعّل الحساب من جديد.",
        retryable: true,
      };
    case "IDENTITY_UNAVAILABLE":
    case "IDENTITY_NOT_READY":
    case "BFF_UPSTREAM_UNAVAILABLE":
    case "BFF_UPSTREAM_NOT_CONFIGURED":
    case "INTERNAL_API_UNAVAILABLE":
      return {
        title: "خدمة الهوية غير متاحة",
        description: "تعذر الوصول إلى الخادم. تحقق من اتصالك بالإنترنت أو أعد المحاولة لاحقاً.",
        retryable: true,
      };
    default:
      return {
        title: "تعذر إكمال العملية",
        description: `أعد المحاولة. إذا استمرت المشكلة تواصل مع الدعم واذكر رمز الخطأ: ${code}`,
        retryable: true,
      };
  }
}
