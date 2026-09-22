type WorkspaceChild = Readonly<{
  href: string;
  label: string;
}>;

export type WorkspaceDestination = Readonly<{
  href: string;
  label: string;
  section: string;
  children: readonly WorkspaceChild[];
}>;

export const workspaceCatalogResources = [
  { key: "overview", href: "/catalog", label: "نظرة عامة", description: "اختر مساحة الكتالوج المطلوبة." },
  { key: "products", href: "/catalog/products", label: "المنتجات", description: "هوية المنتج ونسخه المركزية." },
  { key: "categories", href: "/catalog/categories", label: "التصنيفات", description: "تصنيفات المنتجات التابعة للمجالات." },
  { key: "verticals", href: "/catalog/verticals", label: "المجالات", description: "قاموس المجالات التجارية." },
  { key: "proposals", href: "/catalog/proposals", label: "المقترحات", description: "طابور مراجعة مقترحات الشركاء." },
  { key: "import", href: "/catalog/import", label: "الاستيراد", description: "ملف مصدر آمن، معاينة، ثم التزام." }
] as const;

export type CatalogResourceKey = (typeof workspaceCatalogResources)[number]["key"];

const catalogChildren: readonly WorkspaceChild[] = workspaceCatalogResources.slice(1).map(({ href, label }) => ({ href, label }));

export const workspaceFinanceResources = [
  { key: "overview", href: "/finance", label: "نظرة عامة", description: "اختر مورد المالية المطلوب." },
  { key: "cash-custody", href: "/finance/cash-custody", label: "حفظ النقد", description: "قراءة الالتزامات النقدية المحصلة عند الاستلام." },
  { key: "delivery-fee-policy", href: "/finance/delivery-fee-policy", label: "سياسة رسوم التوصيل", description: "إدارة إصدار سياسة الرسوم المحسوبة خادميًا." },
  { key: "field-commission-policy", href: "/finance/field-commission-policy", label: "سياسة مكافأة الميدان", description: "تحديد سياسة مكافأة الميدان القانونية." },
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
  { href: "/workspace", label: "الرئيسية", section: "نظرة عامة", children: [] },
  {
    href: "/operations",
    label: "العمليات",
    section: "المجالات التشغيلية",
    children: [{ href: "/captains", label: "الكباتن" }]
  },
  {
    href: "/partners",
    label: "الشركاء",
    section: "المجالات التشغيلية",
    children: [
      { href: "/partners/new", label: "إضافة شريك" },
      { href: "/partners/service-cities", label: "مدن الخدمة" },
      { href: "/fields", label: "الميدان" }
    ]
  },
  { href: "/catalog", label: "الكتالوج", section: "المجالات التشغيلية", children: catalogChildren },
  { href: "/marketing", label: "التسويق والمحتوى", section: "الإدارة", children: marketingChildren },
  { href: "/finance", label: "المالية", section: "الإدارة", children: financeChildren },
  { href: "/access", label: "إعدادات المنصة والصلاحيات", section: "المنصة", children: [] }
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
  return destination.children.find((child) => isCurrentWorkspacePath(pathname, child.href)) ?? null;
}
