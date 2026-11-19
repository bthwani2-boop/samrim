import type { OperatorPermission } from "../session/operator-permissions";

export type WorkspaceGroup = "home" | "operations" | "stores" | "catalog" | "marketing" | "finance" | "administration" | "policies";
export type WorkspaceEntry = Readonly<{
  href: string;
  label: string;
  group: WorkspaceGroup;
  permission: OperatorPermission | null;
  owner: "Identity" | "DSH" | "WLT" | "multiple";
}>;

export const workspaceGroupLabels: Readonly<Record<WorkspaceGroup, string>> = {
  home: "الرئيسية",
  operations: "العمليات",
  stores: "المتاجر",
  catalog: "الكتالوج",
  marketing: "التسويق والتصميم",
  finance: "المالية",
  administration: "الإدارة والموظفون",
  policies: "السياسات",
};

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

export type WorkspaceSubsection = Readonly<{ parent: string; href: string; label: string }>;

// Existing pages only. Every subsection inherits the parent route's Identity gate;
// this is navigation metadata and never grants authorization by itself.
export const workspaceSubsections: readonly WorkspaceSubsection[] = [
  { parent: "/merchants", href: "/merchants/joining", label: "طلبات انضمام الشركاء" },
  { parent: "/merchants", href: "/merchants/new", label: "إضافة شريك" },
  { parent: "/merchants", href: "/merchants/store-access", label: "صلاحيات المتاجر" },
  { parent: "/merchants", href: "/merchants/public-stores", label: "متاجر السوق" },
  { parent: "/catalog", href: "/catalog/products", label: "المنتجات" },
  { parent: "/catalog", href: "/catalog/categories", label: "الفئات" },
  { parent: "/catalog", href: "/catalog/proposals", label: "المقترحات" },
  { parent: "/catalog", href: "/catalog/import", label: "استيراد الكتالوج" },
  { parent: "/catalog", href: "/catalog/trash", label: "المحذوفات" },
  { parent: "/marketing", href: "/marketing/content", label: "المحتوى" },
  { parent: "/marketing", href: "/marketing/promotions", label: "العروض الترويجية" },
  { parent: "/marketing", href: "/marketing/customers", label: "جمهور العملاء" },
  { parent: "/finance", href: "/finance/cash-custody", label: "العهد النقدية" },
  { parent: "/finance", href: "/finance/customer-withdrawals", label: "سحوبات العملاء" },
  { parent: "/finance", href: "/finance/partner-store-commissions", label: "عمولات المتاجر" },
  { parent: "/finance", href: "/finance/partner-commission-receivables", label: "مستحقات العمولات" },
  { parent: "/hr", href: "/hr/employees", label: "الموظفون" },
  { parent: "/policies", href: "/policies/stage-sla", label: "أزمنة المراحل" },
];

export function findWorkspaceEntry(pathname: string): WorkspaceEntry | null {
  let normalized = (pathname.split("?")[0] ?? "").split("#")[0] ?? "/";
  while (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (!normalized) normalized = "/";
  return [...workspaceRegistry]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => normalized === item.href || normalized.startsWith(`${item.href}/`)) ?? null;
}
