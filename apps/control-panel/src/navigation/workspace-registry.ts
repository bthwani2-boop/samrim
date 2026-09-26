import type { OperatorPermission } from "@bthwani/identity";

type WorkspaceChild = Readonly<{
  href: string;
  label: string;
  showInWorkspaceNavigation?: boolean;
}>;

export type WorkspaceDestination = Readonly<{
  href: string;
  label: string;
  children: readonly WorkspaceChild[];
  childrenNavigation?: "sidebar" | "top";
  permission?: OperatorPermission;
  initialOperatorAdminOnly?: boolean;
  showInWorkspaceNavigation?: boolean;
}>;

export const workspaceCatalogResources = [
  { key: "products", href: "/catalog/products", label: "المنتجات", description: "هوية المنتج ونسخه المركزية." },
  { key: "categories", href: "/catalog/categories", label: "الفئات", description: "شجرة فئات المنتجات المشتركة وقوالبها." },
  { key: "proposals", href: "/catalog/proposals", label: "المقترحات", description: "طابور مراجعة مقترحات الشركاء." },
  { key: "import", href: "/catalog/import", label: "الاستيراد", description: "ملف مصدر آمن، معاينة، ثم التزام." }
] as const;

export type CatalogResourceKey = (typeof workspaceCatalogResources)[number]["key"];

const catalogChildren: readonly WorkspaceChild[] = workspaceCatalogResources.map(({ href, label }) => ({ href, label }));

export const workspacePolicyResources = [
  { key: "overview", href: "/policies", label: "نظرة عامة", description: "إدارة سياسات المنصة من ملاكها القانونيين." },
  { key: "service-cities", href: "/policies/service-cities", label: "مدن الخدمة", description: "إدارة المدن الكانونية المستخدمة في أهلية الخدمة والانضمام." },
  { key: "delivery-fees", href: "/policies/delivery-fees", label: "رسوم التوصيل", description: "إدارة سياسة الرسوم المحسوبة خادميًا في WLT." },
  { key: "field-rewards", href: "/policies/field-rewards", label: "مكافآت الميدان", description: "إدارة سياسات مكافأة الميدان في WLT." },
  { key: "partner-financial-terms", href: "/policies/partner-financial-terms", label: "شروط الشريك المالية", description: "تحديد العمولة وفترة التسوية المعتمدتين مركزيًا في WLT لملفات الشركاء الجديدة والعالقة." }
] as const;
export type PolicyResourceKey = (typeof workspacePolicyResources)[number]["key"];
const policyChildren: readonly WorkspaceChild[] = workspacePolicyResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspaceFinanceResources = [
  { key: "overview", href: "/finance", label: "نظرة عامة", description: "اختر مورد المالية المطلوب." },
  { key: "cash-custody", href: "/finance/cash-custody", label: "حفظ النقد", description: "قراءة الالتزامات النقدية المحصلة عند الاستلام." },
  { key: "partner-store-commissions", href: "/finance/partner-store-commissions", label: "عمولات المتاجر", description: "إدارة نسبة كل متجر لكل وضع توصيل بإصدار وسبب موثقين." },
  { key: "beneficiary-settlement-partners", href: "/finance/beneficiary-settlement/partners", label: "مستحقات الشركاء", description: "سجل الشركاء وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "beneficiary-settlement-captains", href: "/finance/beneficiary-settlement/captains", label: "مستحقات الكباتن", description: "سجل كباتن بثواني وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "beneficiary-settlement-field", href: "/finance/beneficiary-settlement/field", label: "مستحقات الميدان", description: "سجل الميدان وطلبات الصرف وتنفيذ الدفعات ومطابقتها." },
  { key: "customer-withdrawals", href: "/finance/customer-withdrawals", label: "سحوبات العملاء الاستثنائية", description: "طابور مالي نادر للتحقق من الوجهة وقبول طلب العميل أو رفضه." },
  { key: "partner-commission-receivables", href: "/finance/partner-commission-receivables", label: "تحصيل عمولة المنصة", description: "قراءة ذمم العمولة المستحقة على الشريك وتسجيل الحوالة المتحقق منها." }
] as const;

export type FinanceResourceKey = (typeof workspaceFinanceResources)[number]["key"];

const financeChildren: readonly WorkspaceChild[] = workspaceFinanceResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspaceMarketingResources = [
  { key: "overview", href: "/marketing", label: "نظرة عامة", description: "اختر مورد التسويق المطلوب." },
  { key: "promotions", href: "/marketing/promotions", label: "العروض", description: "إنشاء العروض ومراجعة نشرها وإيقافها." },
  { key: "content", href: "/marketing/content", label: "محتوى الاكتشاف", description: "إنشاء بطاقات الاكتشاف ومراجعة نشرها." }
] as const;

export type MarketingResourceKey = (typeof workspaceMarketingResources)[number]["key"];

const marketingChildren: readonly WorkspaceChild[] = workspaceMarketingResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspaceDestinations: readonly WorkspaceDestination[] = [
  { href: "/workspace", label: "الرئيسية", children: [] },
  { href: "/notifications", label: "الإشعارات", children: [], showInWorkspaceNavigation: false },
  {
    href: "/operations",
    label: "العمليات",
    permission: "operations",
    childrenNavigation: "top",
    children: [{ href: "/captains", label: "الكباتن" }, { href: "/operations/customer-withdrawals", label: "طلبات سحب العملاء الاستثنائية" }]
  },
  {
    href: "/partners",
    label: "الشركاء",
    permission: "partners",
    childrenNavigation: "top",
    children: [
      { href: "/partners/joining", label: "طلبات الانضمام" },
      { href: "/partners/stores", label: "المتاجر" },
      { href: "/fields", label: "الميدان" }
    ]
  },
  { href: "/catalog", label: "الكتالوج", children: catalogChildren, childrenNavigation: "top", permission: "catalog" },
  { href: "/marketing", label: "التسويق والمحتوى", children: marketingChildren, permission: "marketing" },
  { href: "/finance", label: "المالية", children: financeChildren, permission: "finance" },
  { href: "/policies", label: "السياسات", children: policyChildren, permission: "platform_policies" },
  { href: "/access", label: "الوصول والصلاحيات", children: [], initialOperatorAdminOnly: true }
];

export const workspaceSearchEntries = workspaceDestinations.filter((destination) => destination.showInWorkspaceNavigation !== false).flatMap((destination) => [
  {
    href: destination.href,
    label: destination.label,
    context: destination.label,
    searchText: `${destination.label} ${destination.href}`,
  },
  ...destination.children.map((child) => ({
    href: child.href,
    label: child.label,
    context: destination.label,
    searchText: `${child.label} ${destination.label} ${child.href}`,
  })),
]);

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
  return destination.children.find((child) => isCurrentWorkspacePath(pathname, child.href)) ?? null;
}

export function dynamicWorkspaceRouteLabel(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "partners" && segments.length === 2) {
    if (segments[1] === "new") return "إضافة شريك";
    if (["joining", "joining-cases", "stores", "actors", "service-cities"].includes(segments[1]!)) return null;
    return "تفاصيل طلب الانضمام";
  }
  if (segments[0] === "partners" && segments[1] === "stores" && segments.length === 3) return "ملف المتجر";
  if (segments[0] === "partners" && segments[1] === "actors" && segments.length === 3) return "الملف المالي للشريك";
  if (segments[0] === "operations" && segments.length === 2) return "تفاصيل الطلب";
  return null;
}
