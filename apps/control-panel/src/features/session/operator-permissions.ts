import {
  findWorkspaceEntry, type WorkspaceEntry, workspaceRegistry,
} from "../navigation/workspace-registry.ts";

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
  const entry = findWorkspaceEntry(pathname);
  return entry !== null && canOpenWorkspaceEntry(verifiedGrants, entry);
}

function canOpenWorkspaceEntry(grants: readonly OperatorPermission[], entry: WorkspaceEntry): boolean {
  if (grants.length === 0) return false;
  // Read-only landing without private metrics is available to any operator
  // holding at least one current Identity-owned permission.
  if (entry.href === "/workspace") return true;
  return canShowNavigation(true, grants, entry.permission);
}

export function visibleWorkspaceEntries(grants: readonly OperatorPermission[]): WorkspaceEntry[] {
  return workspaceRegistry.filter(entry => canOpenWorkspaceEntry(grants, entry));
}

/** One tab per permitted section, derived from the same permission-filtered route registry. */
export function operatorSectionTabs(grants: readonly OperatorPermission[]): WorkspaceEntry[] {
  const seen = new Set<WorkspaceEntry["group"]>();
  return visibleWorkspaceEntries(grants).filter((entry) => {
    if (seen.has(entry.group)) return false;
    seen.add(entry.group);
    return true;
  });
}
