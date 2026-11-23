import { type IdentityOperatorPermission, identityOperatorPermissions } from "@bthwani/identity";
import {
  findWorkspaceEntry, type WorkspaceEntry, workspaceRegistry,
} from "../navigation/workspace-registry.ts";

export const operatorPermissions = identityOperatorPermissions;
export type OperatorPermission = IdentityOperatorPermission;
export const operatorPermissionLabels: Record<OperatorPermission, string> = {
  operations: "العمليات",
  merchant: "التجّار",
  catalog: "الكتالوج",
  marketing: "التسويق",
  finance: "المالية",
  hr: "الموظفون",
  platform_policies: "سياسات المنصّة",
};

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
  originalOperator = false,
): boolean {
  const entry = findWorkspaceEntry(pathname);
  return entry !== null && canOpenWorkspaceEntry(verifiedGrants, entry, originalOperator);
}

function canOpenWorkspaceEntry(
  grants: readonly OperatorPermission[], entry: WorkspaceEntry, originalOperator: boolean,
): boolean {
  if (entry.href === "/access") return originalOperator;
  if (grants.length === 0) return false;
  // Read-only landing without private metrics is available to any operator
  // holding at least one current Identity-owned permission.
  if (entry.href === "/workspace") return true;
  return canShowNavigation(true, grants, entry.permission);
}

export function visibleWorkspaceEntries(
  grants: readonly OperatorPermission[], originalOperator = false,
): WorkspaceEntry[] {
  return workspaceRegistry.filter(entry => canOpenWorkspaceEntry(grants, entry, originalOperator));
}
