import type { MerchantOwnedStore } from "../access/dsh-standing";

export const merchantNavigation = [
  { id: "home", label: "الرئيسية", description: "ملخص المتاجر المرتبطة بحسابك" },
  { id: "stores", label: "المتاجر", description: "متاجرك المعتمدة لدى DSH" },
  { id: "orders", label: "الطلبات", description: "الطلبات تحتاج إلى صلاحياتها وعقودها الحية من DSH" },
  { id: "products", label: "المنتجات", description: "المنتجات تحتاج إلى ربط الكتالوج المصرّح به من DSH" },
  { id: "wallet", label: "المحفظة", description: "الأرصدة والحركات المالية لا تُعرض قبل التحقق من WLT" },
  { id: "more", label: "المزيد", description: "إعدادات الحساب وبقية وظائف مساحة التاجر" },
] as const;

export type MerchantSection = (typeof merchantNavigation)[number]["id"];

export const merchantMobileSections: readonly MerchantSection[] = [
  "home", "orders", "products", "wallet", "more",
];

export function merchantStoreSummary(stores: readonly MerchantOwnedStore[]) {
  const published = stores.filter(store => store.published).length;
  return { total: stores.length, published, unpublished: stores.length - published };
}
