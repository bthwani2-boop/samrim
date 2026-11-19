import type { MerchantOwnedStore } from "../access/dsh-standing";

export const merchantNavigation = [
  { id: "home", label: "الرئيسية", description: "ملخص المتاجر المرتبطة بحسابك" },
  { id: "stores", label: "المتاجر", description: "ابحث عن متجرك وراجع حالة نشره" },
  { id: "orders", label: "الطلبات", description: "إدارة الطلبات غير متاحة حاليًا" },
  { id: "products", label: "المنتجات", description: "إدارة المنتجات غير متاحة حاليًا" },
  { id: "wallet", label: "المحفظة", description: "الأرصدة والحركات غير متاحة حاليًا" },
  { id: "more", label: "المزيد", description: "اختصارات مساحة التاجر" },
] as const;

export type MerchantSection = (typeof merchantNavigation)[number]["id"];

export const merchantMobileSections: readonly MerchantSection[] = [
  "home", "orders", "products", "wallet", "more",
];

export function merchantStoreSummary(stores: readonly MerchantOwnedStore[]) {
  const published = stores.filter(store => store.published).length;
  return { total: stores.length, published, unpublished: stores.length - published };
}

export type MerchantPublicationFilter = "all" | "published" | "unpublished";

export function filterMerchantStores(
  stores: readonly MerchantOwnedStore[],
  query: string,
  publication: MerchantPublicationFilter,
) {
  const term = query.trim().normalize("NFKC").toLowerCase();
  return stores.filter(store =>
    (publication === "all" || store.published === (publication === "published")) &&
    (store.name.normalize("NFKC").toLowerCase().includes(term) || store.id.includes(term)),
  );
}
