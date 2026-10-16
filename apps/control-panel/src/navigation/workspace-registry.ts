import type { OperatorPermission } from "@bthwani/identity";
import { policyCapabilities as workspacePolicyResources } from "../features/policies/policy-capabilities";

type WorkspaceChild = Readonly<{
  href: string;
  label: string;
  searchAliases?: string;
  showInWorkspaceNavigation?: boolean;
}>;

export type WorkspaceDestination = Readonly<{
  href: string;
  label: string;
  children: readonly WorkspaceChild[];
  permission?: OperatorPermission;
  initialOperatorAdminOnly?: boolean;
  showInWorkspaceNavigation?: boolean;
}>;

export const workspaceCatalogResources = [
  { key: "products", href: "/catalog/products", label: "المنتجات", description: "هوية المنتج ونسخه المركزية." },
  { key: "categories", href: "/catalog/categories", label: "الفئات", description: "شجرة فئات المنتجات المشتركة وقوالبها." },
  { key: "trash", href: "/catalog/trash", label: "سلة المحذوفات", description: "استعادة المنتجات المحذوفة دون المساس بالطلبات أو السجلات السابقة." },
  { key: "proposals", href: "/catalog/proposals", label: "المراجعة", description: "طابور مراجعة مقترحات الشركاء واعتمادها." },
  { key: "import", href: "/catalog/import", label: "الاستيراد", description: "ملف مصدر آمن، معاينة، ثم التزام." }
] as const;

export type CatalogResourceKey = (typeof workspaceCatalogResources)[number]["key"];

// Product, category, and proposal registries share /catalog; retain separate import/recovery workflows.
const catalogChildren: readonly WorkspaceChild[] = [];

// The policies' names, scopes and supported capabilities have one discoverable owner.

// Policy editors are reached inside the one canonical policies surface. Existing deep links stay valid.
const policyChildren: readonly WorkspaceChild[] = [];

export const workspaceFinanceResources = [
  { key: "cash-custody", href: "/finance/cash-custody", label: "حفظ النقد", description: "قراءة الالتزامات النقدية المحصلة عند الاستلام." },
  { key: "partner-store-commissions", href: "/finance/partner-store-commissions", label: "اتفاقات المتاجر", description: "إدارة اتفاقية كل متجر ومراجعة النسب المقترحة للتفاوض حسب نوع المتجر." },
  { key: "beneficiary-settlement-partners", href: "/finance/beneficiary-settlement/partners", label: "مستحقات الشركاء", description: "سجل الشركاء وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "beneficiary-settlement-captains", href: "/finance/beneficiary-settlement/captains", label: "مستحقات الكباتن", description: "سجل كباتن بثواني وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "beneficiary-settlement-field", href: "/finance/beneficiary-settlement/field", label: "مستحقات الميدان", description: "سجل الميدان وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "customer-withdrawals", href: "/finance/customer-withdrawals", label: "سحوبات العملاء الاستثنائية", description: "طابور مالي نادر للتحقق من الوجهة وقبول طلب العميل أو رفضه." },
  { key: "partner-commission-receivables", href: "/finance/partner-commission-receivables", label: "تحصيل عمولة المنصة", description: "قراءة ذمم العمولة المستحقة على الشريك وتسجيل الحوالة المتحقق منها." }
] as const;

export type FinanceResourceKey = (typeof workspaceFinanceResources)[number]["key"];

// The finance workbench owns the visible navigation; legacy detail routes remain valid.
const financeChildren: readonly WorkspaceChild[] = [];
const financeWorkflowLinks = {
  "cash-custody": "custody",
  "partner-store-commissions": "agreements",
  "beneficiary-settlement-partners": "settlement-partner",
  "beneficiary-settlement-captains": "settlement-captain",
  "beneficiary-settlement-field": "settlement-field",
  "customer-withdrawals": "withdrawals",
  "partner-commission-receivables": "commissions",
} as const satisfies Record<FinanceResourceKey, string>;

export const workspaceMarketingResources = [
  { key: "customers", href: "/marketing/customers", label: "العملاء", description: "سجل العملاء وتحليل النشاط الشرائي وفتح ملف العميل الموحد." },
  { key: "promotions", href: "/marketing/promotions", label: "العروض", description: "إنشاء العروض ومراجعة نشرها وإيقافها." },
  { key: "content", href: "/marketing/content", label: "محتوى الاكتشاف", description: "إنشاء بطاقات الاكتشاف ومراجعة نشرها." }
] as const;

export type MarketingResourceKey = (typeof workspaceMarketingResources)[number]["key"];

// Both marketing resources are visible in one canonical workspace; legacy deep links remain available.
const marketingChildren: readonly WorkspaceChild[] = [
  { href: "/marketing/customers", label: "العملاء", searchAliases: "Customer 360 ملف العميل شرائح العملاء نشاط العملاء" },
];

export const workspaceDestinations: readonly WorkspaceDestination[] = [
  { href: "/workspace", label: "الرئيسية", children: [] },
  { href: "/notifications", label: "الإشعارات", children: [], showInWorkspaceNavigation: false },
  {
    href: "/operations",
    label: "العمليات",
    permission: "operations",
    children: [{ href: "/captains", label: "الكباتن" }, { href: "/operations/customer-withdrawals", label: "طلبات سحب العملاء الاستثنائية", showInWorkspaceNavigation: false }]
  },
  {
    href: "/partners",
    label: "الشركاء",
    permission: "partners",
    children: [
      { href: "/partners", label: "الشركاء والمتاجر", searchAliases: "سجل الشركاء سجل المتاجر حسابات الشركاء", showInWorkspaceNavigation: false },
      { href: "/fields", label: "الميداني" }
    ]
  },
  { href: "/catalog", label: "الكتالوج", children: catalogChildren, permission: "catalog" },
  { href: "/marketing", label: "التسويق والمحتوى", children: marketingChildren, permission: "marketing" },
  { href: "/finance", label: "المالية", children: financeChildren, permission: "finance" },
  { href: "/hr", label: "الموارد البشرية", children: [{ href: "/hr/employees", label: "الموظفون" }], permission: "hr" },
  { href: "/policies", label: "السياسات", children: policyChildren, permission: "platform_policies" },
  { href: "/access", label: "الوصول والصلاحيات", children: [], initialOperatorAdminOnly: true }
];

export const workspaceSearchEntries = [...workspaceDestinations.filter((destination) => destination.showInWorkspaceNavigation !== false).flatMap((destination) => [
  ...(destination.children.some((child) => child.href === destination.href) ? [] : [{
    href: destination.href,
    label: destination.label,
    context: destination.label,
    searchText: `${destination.label} ${destination.href}`,
  }]),
  ...destination.children.map((child) => ({
    href: child.href,
    label: child.label,
    context: destination.label,
    searchText: `${child.label} ${destination.label} ${child.href} ${child.searchAliases ?? ""}`,
  })),
]),
  ...workspaceCatalogResources.filter(({ key }) => key !== "trash" && key !== "import").map(({ href, label }) => ({ href, label, context: "الكتالوج", searchText: `${label} الكتالوج ${href}` })),
  ...workspacePolicyResources.map(({ href, label }) => ({ href, label, context: "السياسات", searchText: `${label} السياسات ${href}` })),
  ...workspaceMarketingResources.filter(({ key }) => key !== "customers").map(({ href, label }) => ({ href, label, context: "التسويق والمحتوى", searchText: `${label} التسويق ${href}` })),
  ...workspaceFinanceResources.map(({ key, label, href }) => ({
    href: `/finance?workflow=${financeWorkflowLinks[key]}`,
    label,
    context: "المالية",
    searchText: `${label} المالية ${href}`,
  })),
];

export function isCurrentWorkspacePath(pathname: string, href: string) {
  return href === "/workspace" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function isCurrentWorkspaceDestination(pathname: string, destination: WorkspaceDestination) {
  return isCurrentWorkspacePath(pathname, destination.href) || destination.children.some((child) => isCurrentWorkspacePath(pathname, child.href));
}

export function currentWorkspaceDestination(pathname: string) {
  return workspaceDestinations.find((destination) => isCurrentWorkspaceDestination(pathname, destination)) ?? workspaceDestinations[0]!;
}

export function currentWorkspaceChild(pathname: string, destination: WorkspaceDestination) {
  if (destination.href === "/partners") {
    if (isCurrentWorkspacePath(pathname, "/fields")) return destination.children.find((child) => child.href === "/fields") ?? null;
    // Detailed joining, account and access routes belong to the single partners workbench.
    return destination.children.find((child) => child.href === "/partners") ?? null;
  }
  return destination.children.find((child) =>
    child.href === destination.href ? pathname === child.href : isCurrentWorkspacePath(pathname, child.href)
  ) ?? null;
}

export function dynamicWorkspaceRouteLabel(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "partners" && segments.length === 2) {
    if (segments[1] === "new") return "طلب انضمام جديد";
    if (["joining", "joining-cases", "store-access", "stores", "actors", "service-cities"].includes(segments[1]!)) return null;
    return "تفاصيل طلب الانضمام";
  }
  if (segments[0] === "partners" && segments[1] === "stores" && segments.length === 3) return "ملف المتجر";
  if (segments[0] === "partners" && segments[1] === "actors" && segments.length === 3) return "ملف الشريك";
  if (segments[0] === "customers" && segments.length === 2) return "ملف العميل";
  if (segments[0] === "marketing" && segments[1] === "customers" && segments.length === 3) return "ملف العميل";
  if (segments[0] === "operations" && segments.length === 2) return "تفاصيل الطلب";
  return null;
}
