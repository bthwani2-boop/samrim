import type { OperatorPermission } from "../session/operator-permissions";

export type WorkspaceGroup = "home" | "operations" | "stores" | "catalog" | "marketing" | "finance" | "administration" | "policies";
export type WorkspaceEntry = Readonly<{
  href: string;
  label: string;
  group: WorkspaceGroup;
  permission: OperatorPermission | null;
  owner: "Identity" | "DSH" | "WLT" | "multiple";
}>;

// Null requires a separate verified access rule; it NEVER means a public route.
// Navigation metadata is not service authorization.
export const workspaceRegistry: readonly WorkspaceEntry[] = [
  { href: "/workspace", label: "الرئيسية", group: "home", permission: null, owner: "multiple" },
  { href: "/operations", label: "العمليات والطلبات", group: "operations", permission: "operations", owner: "DSH" },
  { href: "/captains", label: "الكباتن", group: "operations", permission: "operations", owner: "DSH" },
  { href: "/merchants", label: "الشركاء والمتاجر", group: "stores", permission: "partners", owner: "DSH" },
  { href: "/catalog", label: "الكتالوج", group: "catalog", permission: "catalog", owner: "DSH" },
  { href: "/marketing", label: "التسويق", group: "marketing", permission: "marketing", owner: "DSH" },
  { href: "/studio", label: "استوديو التصميم", group: "marketing", permission: "marketing", owner: "DSH" },
  { href: "/customers", label: "العملاء", group: "marketing", permission: null, owner: "Identity" },
  { href: "/finance", label: "المالية", group: "finance", permission: "finance", owner: "WLT" },
  { href: "/hr", label: "الموظفون", group: "administration", permission: "hr", owner: "DSH" },
  { href: "/access", label: "الوصول والصلاحيات", group: "administration", permission: null, owner: "Identity" },
  { href: "/notifications", label: "الإشعارات", group: "administration", permission: null, owner: "multiple" },
  { href: "/policies", label: "السياسات", group: "policies", permission: "platform_policies", owner: "multiple" },
] as const;

export function findWorkspaceEntry(pathname: string): WorkspaceEntry | null {
  let normalized = (pathname.split("?")[0] ?? "").split("#")[0] ?? "/";
  while (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized) normalized = "/";
  return [...workspaceRegistry]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => normalized === item.href || normalized.startsWith(`${item.href}/`)) ?? null;
}
