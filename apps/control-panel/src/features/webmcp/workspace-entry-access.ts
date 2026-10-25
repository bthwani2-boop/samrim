import type { ActorIdentity } from "@bthwani/identity";
import { workspaceDestinations, workspaceSearchEntries } from "../../navigation/workspace-registry";
import { policyCapabilities } from "../policies/policy-capabilities";

export type WorkspaceEntry = Readonly<{ href: string; label: string; context: string }>;

const categoryRoute = (href: string) => {
  const path = href.split("?")[0] ?? href;
  if (path.startsWith("/fields")) return "/partners";
  const destination = workspaceDestinations
    .filter(entry => path === entry.href || path.startsWith(entry.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return destination?.href ?? null;
};

/** Registry-backed destinations only: never take an arbitrary URL from an agent. */
export function allowedWorkspaceEntries(identity: ActorIdentity): WorkspaceEntry[] {
  if (identity.role !== "operator") return [];
  const canOpen = (href: string) => {
    const root = categoryRoute(href);
    if (!root) return false;
    const destination = workspaceDestinations.find(entry => entry.href === root);
    if (!destination) return false;
    if (destination.initialOperatorAdminOnly && !identity.canManageOperatorPermissions) return false;
    if (destination.permission && !identity.permissions?.includes(destination.permission)) return false;
    const policy = policyCapabilities.find(value => value.href === href);
    if (policy && policy.additionalPermission && !identity.permissions?.includes(policy.additionalPermission)) return false;
    return true;
  };
  return workspaceSearchEntries
    .filter(entry => canOpen(entry.href))
    .map(entry => ({ href: entry.href, label: entry.label, context: entry.context }));
}

/** Never use generic draft assistance to modify money, access, HR or order-sensitive screens. */
export function canDraftWorkspaceFields(pathname: string): boolean {
  return ["/catalog", "/partners", "/marketing", "/fields"].some(prefix =>
    pathname === prefix || pathname.startsWith(prefix + "/")
  ) && !pathname.startsWith("/partners/actors/");
}
