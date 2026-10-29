import type { OperationalIconName } from "../../shell/workspace-icon";

/**
 * One UI discovery manifest for owner-backed operational policies.
 * This does not create new policy behaviors or a second source of business truth.
 * A new entry is valid only after its owning service, contracts and editor exist.
 */
export const policyCapabilities = [
  {
    key: "store-type-cancellation", href: "/policies?policy=store-type-cancellation&action=manage", label: "إلغاء الطلبات",
    description: "تحديد إمكانية إلغاء العميل قبل قبول المتجر، أو مراجعة العمليات فقط حسب نوع المتجر.",
    icon: "review", context: "أنواع المتاجر", summary: "سياسة الإلغاء حسب نوع المتجر",
    scope: "نوع المتجر", owner: "DSH", createLabel: null, additionalPermission: null, list: null,
  },
  {
    key: "service-cities", href: "/policies?policy=service-cities&action=manage", label: "مدن الخدمة",
    description: "إدارة المدن المعتمدة المستخدمة في أهلية الخدمة والانضمام.",
    icon: "map", context: "تغطية المنصة", summary: "المدن المعتمدة وحالة إتاحتها",
    scope: "مدينة", owner: "DSH", createLabel: "إضافة مدينة", additionalPermission: null,
    list: { path: "/api/service-cities?includeInactive=true", collection: "cities" },
  },
  {
    key: "wallet-providers", href: "/policies?policy=wallet-providers&action=manage", label: "مزودو المحافظ الرسمية",
    description: "إدارة أسماء المحافظ الرسمية التي تظهر في قوائم الاختيار.",
    icon: "finance", context: "وسائل الدفع", summary: "مزودو المحافظ الرسمية وحالتهم",
    scope: "مزوّد محفظة", owner: "DSH", createLabel: "إضافة محفظة", additionalPermission: null,
    list: { path: "/api/wallet-providers?includeInactive=true", collection: "walletProviders" },
  },
  {
    key: "delivery-fees", href: "/policies?policy=delivery-fees&action=manage", label: "رسوم التوصيل",
    description: "إدارة سياسة الرسوم المحسوبة خادميًا في السجل المالي.",
    icon: "rider", context: "التسعير", summary: "قواعد رسوم التوصيل حسب المدينة",
    scope: "مدينة خدمة", owner: "WLT", createLabel: null, additionalPermission: null, list: null,
  },
  {
    key: "captain-minimum-balance", href: "/policies?policy=captain-minimum-balance", label: "الحد الأدنى لرصيد الكابتن",
    description: "حد الرصيد المتاح المطلوب لكابتن بثواني لاستقبال الطلبات بجميع طرق الدفع.",
    icon: "finance", context: "أهلية كابتن بثواني", summary: "حد الرصيد المتاح لجميع طرق الدفع",
    scope: "كابتن بثواني", owner: "WLT", createLabel: null, additionalPermission: null, list: null,
  },
  {
    key: "partner-financial-terms", href: "/policies?policy=partner-financial-terms&action=manage", label: "شروط الشريك المالية",
    description: "تحديد فترة التسوية المعتمدة لملفات الشركاء الجديدة والعالقة.",
    icon: "review", context: "مالية الشركاء", summary: "فترة تسوية الشريك المعتمدة",
    scope: "ملفات الشركاء", owner: "WLT", createLabel: null, additionalPermission: "finance", list: null,
  },
] as const satisfies ReadonlyArray<{
  key: string; href: string; label: string; description: string;
  icon: OperationalIconName; context: string; summary: string;
  scope: string; owner: "DSH" | "WLT";
  createLabel: string | null; list: { path: string; collection: string } | null;
  additionalPermission: "finance" | null;
}>;

export type PolicyResourceKey = (typeof policyCapabilities)[number]["key"];
export type PolicyCapability = (typeof policyCapabilities)[number];

export function policyCapability(key: PolicyResourceKey): PolicyCapability {
  // Every supported key comes from the above bounded manifest.
  return policyCapabilities.find((item) => item.key === key)!;
}

export function isPolicyKey(value: string | null): value is PolicyResourceKey {
  return policyCapabilities.some((item) => item.key === value);
}

/** Single UI capability check; service owners must independently authorize every write. */
export function canManagePolicy(key: PolicyResourceKey, permissions: readonly string[] | undefined): boolean {
  const additional = policyCapability(key).additionalPermission;
  return permissions?.includes("platform_policies") === true
    && (additional === null || permissions?.includes(additional) === true);
}
