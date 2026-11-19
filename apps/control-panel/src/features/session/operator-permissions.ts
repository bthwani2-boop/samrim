import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";

export const operatorPermissions = [
  "operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies",
] as const;
export type OperatorPermission = (typeof operatorPermissions)[number];

export function isOperatorPermission(value: unknown): value is OperatorPermission {
  return typeof value === "string" && operatorPermissions.some((item) => item === value);
}

// Presentation-only hint. Identity must authorize every protected API request.
export function canShowNavigation(
  verified: boolean,
  grants: readonly OperatorPermission[],
  required: OperatorPermission | null,
): boolean {
  return verified && required !== null && grants.includes(required);
}

export function canEnterOperatorWorkspace(
  verifiedGrants: readonly OperatorPermission[],
  pathname: string,
): boolean {
  if (verifiedGrants.length === 0) return false;
  const entry = findWorkspaceEntry(pathname);
  if (!entry) return false;
  // Read-only landing without private metrics is available to any operator
  // holding at least one current Identity-owned permission.
  if (entry.href === "/workspace") return true;
  return canShowNavigation(true, verifiedGrants, entry.permission);
}
