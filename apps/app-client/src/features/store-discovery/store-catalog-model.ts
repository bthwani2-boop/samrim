import type { PublicCatalogResponse } from "@bthwani/dsh";

export type StoreCatalogRow =
  | { kind: "grid"; key: string; offers: PublicCatalogResponse["offers"] }
  | { kind: "filters"; key: string }
  | { kind: "heading"; key: string; title: string; subtitle: string }
  | { kind: "empty"; key: string; title: string }
  | { kind: "offer"; key: string; offer: PublicCatalogResponse["offers"][number] };

export function buildDisplayCatalogRows(rows: StoreCatalogRow[], gridMode: boolean): StoreCatalogRow[] {
  if (!gridMode) return rows.filter((row) => row.kind !== "filters");
  const result: StoreCatalogRow[] = [];
  let pending: PublicCatalogResponse["offers"][number][] = [];
  const flush = () => {
    if (pending.length) {
      result.push({ kind: "grid", key: "grid:" + pending[0]!.offerId, offers: pending });
      pending = [];
    }
  };
  for (const row of rows) {
    if (row.kind === "offer") {
      pending.push(row.offer);
      if (pending.length === 2) flush();
      continue;
    }
    flush();
    if (row.kind !== "filters") result.push(row);
  }
  flush();
  return result;
}

export function categoryTrail(categoryId: string, categories: PublicCatalogResponse["categories"]): ReadonlyArray<PublicCatalogResponse["categories"][number]> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const trail: Array<PublicCatalogResponse["categories"][number]> = [];
  const visited = new Set<string>();
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    trail.unshift(current);
    current = current.parentCategoryId ? byId.get(current.parentCategoryId) : undefined;
  }
  return trail;
}

export function filterCatalogToProduct(catalog: PublicCatalogResponse, productID: string): PublicCatalogResponse {
  const offers = catalog.offers.filter((offer) => offer.productId === productID);
  const offerIDs = new Set(offers.map((offer) => offer.offerId));
  return { ...catalog, offers, sections: catalog.sections.map((section) => ({ ...section, offerIds: section.offerIds.filter((offerID) => offerIDs.has(offerID)) })).filter((section) => section.offerIds.length > 0) };
}

export function mergeCatalog(current: PublicCatalogResponse, next: PublicCatalogResponse): PublicCatalogResponse {
  const seen = new Set<string>();
  const offers = [...current.offers, ...next.offers].filter((offer) => {
    if (seen.has(offer.offerId)) return false;
    seen.add(offer.offerId);
    return true;
  });
  return { ...current, offers, nextCursor: next.nextCursor };
}

export function formatQuantity(baseUnit: string, quantity: number): string {
  const localized = (value: number) => new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 3 }).format(value);
  if (baseUnit === "GRAM") return quantity >= 1000 ? `${localized(quantity / 1000)} كجم` : `${localized(quantity)} غ`;
  if (baseUnit === "MILLILITER") return quantity >= 1000 ? `${localized(quantity / 1000)} لتر` : `${localized(quantity)} مل`;
  return `${localized(quantity)} حبة`;
}

export function isQuantityAllowed(offer: PublicCatalogResponse["offers"][number], quantity: number): boolean {
  return quantity >= offer.quantityMinBaseUnits && quantity <= offer.quantityMaxBaseUnits && (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}

function modifierGroupError(group: PublicCatalogResponse["offers"][number]["modifierGroups"][number], selectedIds: ReadonlyArray<string>): string {
  const selectedCount = group.options.filter((option) => selectedIds.includes(option.id)).length;
  if (selectedCount < group.minSelections) return `اختر ${group.minSelections} خيارًا على الأقل من ${group.nameAr}.`;
  if (selectedCount > group.maxSelections) return `اختر ${group.maxSelections} خيارًا كحد أقصى من ${group.nameAr}.`;
  return "";
}

export function validateModifierSelection(offer: PublicCatalogResponse["offers"][number], selectedIds: ReadonlyArray<string>): string {
  if (new Set(selectedIds).size !== selectedIds.length) return "اختيارات الإضافات غير صالحة. أعد تحديد الخيارات.";
  const admittedOptions = new Map(offer.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
  for (const optionId of selectedIds) {
    const option = admittedOptions.get(optionId);
    if (!option?.availability) return "أحد الخيارات المحددة لم يعد متاحًا. حدّث الكتالوج ثم أعد المحاولة.";
  }
  for (const group of offer.modifierGroups) {
    const error = modifierGroupError(group, selectedIds);
    if (error) return error;
  }
  return "";
}

export function dshMutationErrorMessage(cause: unknown, fallback: string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  if (code === "OFFER_UNAVAILABLE") return "لم يعد هذا المنتج متاحًا. حدّث الكتالوج ثم أعد المحاولة.";
  if (code === "INVALID_INPUT") return "تحقق من الكمية والخيارات المحددة ثم أعد المحاولة.";
  if (code === "UNAUTHENTICATED") return "سجّل الدخول لإضافة المنتج إلى السلة.";
  if (code === "STALE_CHECKOUT") return "تغيرت السلة أو بيانات المنتج. افتح السلة لقراءة الحالة الحالية.";
  return fallback;
}

export function buildCatalogRows(catalog: PublicCatalogResponse, favoritesView: boolean, popularView: boolean, categoryID: string | null, sectionID: string | null, query: string, refreshing = false): StoreCatalogRow[] {
  const activeSections = catalog.sections.filter((section) => section.active);
  const selectedSection = activeSections.find((section) => section.id === sectionID);
  const sectionOfferIds = new Set(activeSections.flatMap((section) => section.offerIds));
  const sectionOffers = selectedSection
    ? selectedSection.offerIds.map((offerID) => catalog.offers.find((offer) => offer.offerId === offerID)).filter((offer): offer is PublicCatalogResponse["offers"][number] => offer !== undefined)
    : catalog.offers;
  const emptyOfferMessage = favoritesView
    ? "لم تحفظ منتجات من هذا المتجر بعد"
    : selectedSection
      ? query.trim()
        ? `لا توجد منتجات مطابقة في ${selectedSection.nameAr}`
        : catalog.nextCursor
          ? `حمّل المزيد لعرض بقية منتجات ${selectedSection.nameAr}`
          : `لا توجد منتجات متاحة في ${selectedSection.nameAr} حاليًا`
    : popularView
      ? query.trim()
        ? "لا توجد منتجات مطابقة"
        : categoryID
          ? "لا توجد منتجات رائجة في هذا التصنيف خلال آخر 30 يومًا"
          : "لا توجد منتجات مطلوبة خلال آخر 30 يومًا"
      : "لا توجد منتجات متاحة حاليًا";
  const catalogRows: StoreCatalogRow[] = [];
  const seenOfferIDs = new Set<string>();

  if (sectionOffers.length === 0) catalogRows.push({ kind: "empty", key: "catalog-empty", title: emptyOfferMessage });
  const appendOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    if (seenOfferIDs.has(offer.offerId)) return;
    seenOfferIDs.add(offer.offerId);
    catalogRows.push({ kind: "offer", key: `offer:${offer.offerId}`, offer });
  };
  if (sectionOffers.length > 0 && selectedSection) {
    sectionOffers.forEach(appendOffer);
  } else if (sectionOffers.length > 0 && !favoritesView && !popularView) {
    for (const section of activeSections) {
      const sectionOffers = section.offerIds
        .map((offerID) => catalog.offers.find((offer) => offer.offerId === offerID))
        .filter((offer): offer is PublicCatalogResponse["offers"][number] => offer !== undefined && !seenOfferIDs.has(offer.offerId));
      if (sectionOffers.length === 0) continue;
      sectionOffers.forEach(appendOffer);
    }
    sectionOffers.filter((offer) => !sectionOfferIds.has(offer.offerId)).forEach(appendOffer);
  } else if (sectionOffers.length > 0) {
    sectionOffers.forEach(appendOffer);
  }

  return catalogRows;
}
