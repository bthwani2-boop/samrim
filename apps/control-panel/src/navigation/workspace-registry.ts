type WorkspaceChild = Readonly<{
  href: string;
  label: string;
}>;

export type WorkspaceDestination = Readonly<{
  href: string;
  label: string;
  children: readonly WorkspaceChild[];
  showInWorkspaceNavigation?: boolean;
}>;

export const workspaceCatalogResources = [
  { key: "overview", href: "/catalog", label: "نظرة عامة", description: "اختر مساحة الكتالوج المطلوبة." },
  { key: "products", href: "/catalog/products", label: "المنتجات", description: "هوية المنتج ونسخه المركزية." },
  { key: "proposals", href: "/catalog/proposals", label: "المقترحات", description: "طابور مراجعة مقترحات الشركاء." },
  { key: "import", href: "/catalog/import", label: "الاستيراد", description: "ملف مصدر آمن، معاينة، ثم التزام." }
] as const;

export type CatalogResourceKey = (typeof workspaceCatalogResources)[number]["key"];

const catalogChildren: readonly WorkspaceChild[] = workspaceCatalogResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspacePolicyResources = [
  { key: "overview", href: "/policies", label: "نظرة عامة", description: "إدارة سياسات المنصة من ملاكها القانونيين." },
  { key: "service-cities", href: "/policies/service-cities", label: "مدن الخدمة", description: "إدارة المدن الكانونية المستخدمة في أهلية الخدمة والانضمام." },
  { key: "verticals", href: "/policies/verticals", label: "المجالات التجارية", description: "إدارة قاموس المجالات التجارية في DSH." },
  { key: "categories", href: "/policies/categories", label: "شجرة التصنيفات", description: "إدارة شجرة التصنيفات وقواعد خصائصها في DSH." },
  { key: "attributes", href: "/policies/attributes", label: "قواعد الخصائص", description: "تعريف خصائص المنتجات ومتطلبات العرض والبحث." },
  { key: "delivery-fees", href: "/policies/delivery-fees", label: "رسوم التوصيل", description: "إدارة سياسة الرسوم المحسوبة خادميًا في WLT." },
  { key: "field-rewards", href: "/policies/field-rewards", label: "مكافآت الميدان", description: "إدارة سياسات مكافأة الميدان في WLT." }
] as const;
export type PolicyResourceKey = (typeof workspacePolicyResources)[number]["key"];
const policyChildren: readonly WorkspaceChild[] = workspacePolicyResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspaceFinanceResources = [
  { key: "overview", href: "/finance", label: "نظرة عامة", description: "اختر مورد المالية المطلوب." },
  { key: "cash-custody", href: "/finance/cash-custody", label: "حفظ النقد", description: "قراءة الالتزامات النقدية المحصلة عند الاستلام." },
  { key: "partner-store-commissions", href: "/finance/partner-store-commissions", label: "عمولات المتاجر", description: "إدارة نسبة كل متجر لكل وضع توصيل بإصدار وسبب موثقين." },
  { key: "field-earnings", href: "/finance/field-earnings", label: "مستحقات الميدان", description: "قراءة المستحقات المحسوبة للميدانيين." },
  { key: "partner-earnings", href: "/finance/partner-earnings", label: "مستحقات الشركاء", description: "قراءة المستحقات المحسوبة للشركاء." },
  { key: "beneficiary-settlement", href: "/finance/beneficiary-settlement", label: "تسويات المستفيدين", description: "إدارة وجهة المستفيد وحالة التسوية الرسمية." }
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
    children: [{ href: "/captains", label: "الكباتن" }]
  },
  {
    href: "/partners",
    label: "الشركاء",
    children: [
      { href: "/partners/new", label: "إضافة شريك" },
      { href: "/fields", label: "الميدان" }
    ]
  },
  { href: "/catalog", label: "الكتالوج", children: catalogChildren },
  { href: "/marketing", label: "التسويق والمحتوى", children: marketingChildren },
  { href: "/finance", label: "المالية", children: financeChildren },
  { href: "/policies", label: "السياسات", children: policyChildren },
  { href: "/access", label: "الوصول والصلاحيات", children: [] }
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
