import { borders, elevation, radius, type resolveTheme, sizing, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, fulfillmentModeLabel, formatMoney, type CustomerFulfillmentMode, type PublicCatalogResponse, type PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { addCatalogOfferToCart, listFavoriteStoreIDs, readPublicStoreCatalog, readPublishedStore, setFavoriteStore } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

export default function ClientStoreDetail({ storeId, categoryId = "", productId = "" }: { storeId: string; categoryId?: string; productId?: string }) {
  const router = useRouter();
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedModifierOptionIds, setSelectedModifierOptionIds] = useState<Record<string, ReadonlyArray<string>>>({});
  const [busyOfferId, setBusyOfferId] = useState("");
  const [addedOfferId, setAddedOfferId] = useState("");
  const [selectedSectionID, setSelectedSectionID] = useState<string | null>(null);
  const [selectedCategoryID, setSelectedCategoryID] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const catalogRequestID = useRef(0);
  const [error, setError] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [selectedFulfillmentMode, setSelectedFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);
  const mutationBusy = Boolean(busyOfferId);

  const load = useCallback(async () => {
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    setSelectedSectionID(null);
    setSelectedCategoryID(categoryId.trim() || null);
    setCatalogQuery("");
    setCatalogRefreshing(false);
    setLoadingMore(false);
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const [store, rawCatalog] = await Promise.all([readPublishedStore(storeId, selectedCityID), readPublicStoreCatalog(storeId, selectedCityID, categoryId.trim(), "", 20)]);
      const catalog = productId.trim() ? filterCatalogToProduct(rawCatalog, productId.trim()) : rawCatalog;
      let favorite = false;
      if (currentIdentityState().kind === "authenticated") {
        try {
          favorite = (await listFavoriteStoreIDs()).includes(storeId);
        } catch {
          favorite = false;
        }
      }
      if (requestID !== catalogRequestID.current) return;
      setIsFavorite(favorite);
      setState({ kind: "ready", store, catalog });
    } catch {
      if (requestID !== catalogRequestID.current) return;
      setState({ kind: "error" });
    }
  }, [categoryId, productId, selectedCityID, storeId]);

  const reloadCatalog = useCallback(async (categoryID: string | null, query: string) => {
    if (!storeId.trim() || !selectedCityID) return;
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    setCatalogRefreshing(true);
    setError("");
    try {
      const catalog = await readPublicStoreCatalog(storeId, selectedCityID, categoryID ?? "", query.trim(), 20);
      if (requestID !== catalogRequestID.current) return;
      setSelectedSectionID(null);
      setSelectedCategoryID(categoryID);
      setState((current) => current.kind === "ready" ? { kind: "ready", store: current.store, catalog } : current);
    } catch {
      if (requestID === catalogRequestID.current) setError("تعذر تحديث الكتالوج. يمكنك متابعة العناصر الحالية أو إعادة المحاولة.");
    } finally {
      if (requestID === catalogRequestID.current) setCatalogRefreshing(false);
    }
  }, [selectedCityID, storeId]);

  useEffect(() => { void load(); }, [load]);

  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز المتجر"><BthwaniSkeleton width="30%" height={28} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={160} /><BthwaniSkeleton height={160} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة المتجر</Text><Text style={styles.muted}>قد لا يكون المتجر متاحًا في مدينة الخدمة الحالية.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة" onPress={() => router.back()} variant="secondary" /></View>;
  }

  const activeSections = state.catalog.sections.filter((section) => section.active);
  const sectionOfferIds = new Set(activeSections.flatMap((section) => section.offerIds));
  const visibleSections = selectedSectionID ? activeSections.filter((section) => section.id === selectedSectionID) : activeSections;
  const visibleOfferCount = selectedSectionID
    ? visibleSections.reduce((total, section) => total + section.offerIds.filter((offerId) => state.catalog.offers.some((offer) => offer.offerId === offerId)).length, 0)
    : state.catalog.offers.length;

  async function loadMore() {
    if (loadingMore || catalogRefreshing || state.kind !== "ready" || !selectedCityID || !state.catalog.nextCursor) return;
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    setLoadingMore(true);
    setError("");
    try {
      const catalog = await readPublicStoreCatalog(storeId, selectedCityID, selectedCategoryID ?? "", catalogQuery.trim(), 20, state.catalog.nextCursor);
      if (requestID !== catalogRequestID.current) return;
      setState((current) => current.kind === "ready" ? { kind: "ready", store: current.store, catalog: mergeCatalog(current.catalog, catalog) } : current);
    } catch {
      if (requestID === catalogRequestID.current) setError("تعذر تحميل المزيد من المنتجات. أعد المحاولة.");
    } finally {
      if (requestID === catalogRequestID.current) setLoadingMore(false);
    }
  }
  function toggleModifier(offer: PublicCatalogResponse["offers"][number], groupId: string, optionId: string, maxSelections: number) {
    if (mutationBusy) return;
    setSelectedModifierOptionIds((current) => {
      const selected = [...(current[offer.offerId] ?? [])];
      const optionIndex = selected.indexOf(optionId);
      const groupOptionIds = new Set(offer.modifierGroups.find((group) => group.id === groupId)?.options.map((item) => item.id) ?? []);
      if (optionIndex >= 0) {
        selected.splice(optionIndex, 1);
      } else {
        const withoutGroup = selected.filter((id) => !groupOptionIds.has(id));
        if (maxSelections === 1) selected.splice(0, selected.length, ...withoutGroup, optionId);
        else if (selected.filter((id) => groupOptionIds.has(id)).length < maxSelections) selected.push(optionId);
      }
      return { ...current, [offer.offerId]: selected };
    });
  }

  async function add(offer: PublicCatalogResponse["offers"][number]) {
    if (busyOfferId) return;
    if (!selectedFulfillmentMode) {
      setError("اختر طريقة الطلب من الخيارات المتاحة لهذا المتجر أولًا.");
      return;
    }
    if (currentIdentityState().kind !== "authenticated") {
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    const quantity = Number(quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits));
    if (!Number.isSafeInteger(quantity) || !isQuantityAllowed(offer, quantity)) {
      setError("الكمية لا تطابق الحد الأدنى أو الأقصى أو خطوة الكمية لهذا العرض.");
      return;
    }
    const modifierError = validateModifierSelection(offer, selectedModifierOptionIds[offer.offerId] ?? []);
    if (modifierError) {
      setError(modifierError);
      return;
    }
    setBusyOfferId(offer.offerId);
    setAddedOfferId("");
    setError("");
    try {
      await addCatalogOfferToCart(storeId, offer, quantity, selectedModifierOptionIds[offer.offerId] ?? []);
      setAddedOfferId(offer.offerId);
    } catch (cause) {
      console.error("DSH catalog offer add failed", cause);
      setError(dshMutationErrorMessage(cause, "تعذر إضافة المنتج. أعد المحاولة أو افتح السلة لقراءة حالتها."));
    } finally {
      setBusyOfferId("");
    }
  }

  async function toggleFavorite() {
    if (favoriteBusy) return;
    if (currentIdentityState().kind !== "authenticated") {
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    setFavoriteBusy(true);
    setError("");
    try {
      setIsFavorite(await setFavoriteStore(storeId, !isFavorite));
    } catch {
      setError("تعذر تحديث المفضلة. أعد المحاولة.");
    } finally {
      setFavoriteBusy(false);
    }
  }

  const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    const selectedOptions = selectedModifierOptionIds[offer.offerId] ?? [];
    const quantity = quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits);
    const busy = busyOfferId === offer.offerId;
    const modifierError = validateModifierSelection(offer, selectedOptions);
    const primaryMedia = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
    return (
      <BthwaniSurface key={offer.offerId} tone="base" style={styles.item}>
        {primaryMedia ? <Image accessibilityLabel={`صورة ${offer.productName}`} source={{ uri: primaryMedia.uri }} resizeMode="cover" style={styles.productImage} /> : <View accessibilityLabel={`لا توجد صورة لـ ${offer.productName}`} style={styles.productImagePlaceholder}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /></View>}
        <View style={styles.itemHeader}><View style={styles.itemCopy}><Text style={styles.itemTitle}>{offer.productName}</Text><Text style={styles.muted}>{offer.measurementKind === "DISCRETE" ? "بالقطعة" : offer.baseUnit === "GRAM" ? "بالغرام" : "بالمليلتر"}</Text></View><Text style={styles.itemPrice}>{formatMoney(offer.priceMinor, offer.currency)}</Text></View>
        {offer.productDescription ? <Text style={styles.muted}>{offer.productDescription}</Text> : null}
        <Text style={styles.quantityHint}>الكمية: {formatQuantity(offer.baseUnit, offer.quantityMinBaseUnits)}–{formatQuantity(offer.baseUnit, offer.quantityMaxBaseUnits)} · الخطوة {formatQuantity(offer.baseUnit, offer.quantityStepBaseUnits)}</Text>
        <TextInput accessibilityLabel={`كمية ${offer.productName}`} editable={!mutationBusy} keyboardType="number-pad" onChangeText={(value) => setQuantities((current) => ({ ...current, [offer.offerId]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={quantity} style={[styles.quantityInput, mutationBusy && styles.disabledInput]} />
        {offer.modifierGroups.map((group) => {
          const groupError = modifierGroupError(group, selectedOptions);
          return (
            <View key={group.id} style={styles.modifierGroup}>
              <Text style={styles.muted}>{group.nameAr}{group.required ? " · مطلوب" : ""}</Text>
              <View style={styles.modifierOptions}>
                {group.options.filter((option) => option.availability).map((option) => {
                  const selected = selectedOptions.includes(option.id);
                  return <BthwaniChip key={option.id} accessibilityHint={groupError || undefined} disabled={mutationBusy} label={`${option.nameAr}${option.priceDeltaMinor ? ` · +${formatMoney(option.priceDeltaMinor, offer.currency)}` : ""}`} onPress={() => toggleModifier(offer, group.id, option.id, group.maxSelections)} selected={selected} style={groupError ? styles.invalidModifierOption : undefined} />;
                })}
              </View>
              {groupError ? <Text accessibilityLiveRegion="polite" style={styles.validationError}>{groupError}</Text> : null}
            </View>
          );
        })}
        {modifierError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.validationError}>{modifierError}</Text> : null}
        <BthwaniButton accessibilityLabel={`إضافة ${offer.productName}`} busy={busy} disabled={!selectedFulfillmentMode || mutationBusy || Boolean(modifierError)} label="إضافة إلى السلة" onPress={() => void add(offer)} />
        {addedOfferId === offer.offerId ? <Text accessibilityLiveRegion="polite" style={styles.success}>تمت الإضافة. يمكنك متابعة اختيار المنتجات أو فتح السلة.</Text> : null}
      </BthwaniSurface>
    );
  };

  return (
    <View style={styles.container} accessibilityLabel={`كتالوج ${state.store.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى المتاجر" onPress={() => router.back()} style={styles.backButton}><BthwaniIcon name="back" color={theme.interactiveText} size={sizing.iconMd} /><Text style={styles.back}>المتاجر المتاحة</Text></Pressable>
      <BthwaniSurface tone="raised" style={styles.merchantHero}>
        {state.store.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${state.store.name}`} source={{ uri: state.store.storeProfileImage.uri }} style={styles.merchantImage} resizeMode="cover" /> : <View style={styles.merchantIcon}><BthwaniIcon name="store" color={theme.onAction} size={sizing.iconXl} /></View>}
        <View style={styles.merchantCopy}><Text style={styles.eyebrow}>متاح للطلب</Text><Text style={styles.title}>{state.store.name}</Text><Text style={styles.muted}>كتالوج منشور</Text><Text accessibilityLabel="تقييم المتجر" style={styles.rating}>{state.store.ratingCount > 0 ? `★ ${state.store.ratingAverage.toFixed(1)} من 5 · ${state.store.ratingCount} تقييم` : "لا توجد تقييمات بعد"}</Text></View>
        <BthwaniIconButton
          disabled={favoriteBusy}
          icon="favorite"
          label={isFavorite ? "إزالة المتجر من المفضلة" : "إضافة المتجر إلى المفضلة"}
          onPress={() => void toggleFavorite()}
          tone={isFavorite ? "primary" : "soft"}
        />
        <BthwaniIcon name="success" color={theme.success} size={sizing.iconLg} />
      </BthwaniSurface>
      <BthwaniSectionHeader title="اختر طريقة الطلب" subtitle="تظهر لك الأوضاع التي فعّلها هذا المتجر فقط." />
      <BthwaniSurface tone="inset" style={styles.fulfillmentModes} accessibilityLabel="أوضاع الطلب المتاحة في المتجر">
        {availableCustomerFulfillmentModes(state.store.fulfillmentModes).map((mode) => <BthwaniChip key={mode} accessibilityHint={fulfillmentModeDescription(mode)} label={fulfillmentModeLabel(mode)} onPress={() => { setSelectedFulfillmentMode(mode); setError(""); }} selected={selectedFulfillmentMode === mode} />)}
        {selectedFulfillmentMode ? <Text style={styles.muted}>{fulfillmentModeDescription(selectedFulfillmentMode)}</Text> : <Text style={styles.validationError}>اختر وضعًا قبل إضافة المنتجات وفتح السلة.</Text>}
      </BthwaniSurface>
      <BthwaniSectionHeader title="استكشف المنتجات" subtitle={`${state.catalog.offers.length} منتج معروض${catalogRefreshing ? " · جارٍ التحديث…" : ""}`} />
      <BthwaniSearchField
        accessibilityLabel="البحث في منتجات المتجر"
        containerStyle={styles.searchField}
        editable={!catalogRefreshing && !loadingMore}
        onChangeText={setCatalogQuery}
        onClear={() => { setCatalogQuery(""); void reloadCatalog(selectedCategoryID, ""); }}
        onSubmitEditing={() => void reloadCatalog(selectedCategoryID, catalogQuery)}
        placeholder="ابحث باسم المنتج"
        returnKeyType="search"
        value={catalogQuery}
      />
      <View style={styles.searchActions}>
        <BthwaniButton disabled={catalogRefreshing || loadingMore} label="بحث" onPress={() => void reloadCatalog(selectedCategoryID, catalogQuery)} style={styles.searchButton} variant="secondary" />
      </View>
      {state.catalog.categories.filter((category) => category.active).length > 0 ? <>
        <Text style={styles.filterLabel}>التصنيفات</Text>
        <ScrollView horizontal contentContainerStyle={styles.sectionChips} showsHorizontalScrollIndicator={false}>
          <BthwaniChip label="كل التصنيفات" selected={!selectedCategoryID} onPress={() => void reloadCatalog(null, catalogQuery)} />
          {state.catalog.categories.filter((category) => category.active).map((category) => <BthwaniChip key={category.id} label={category.nameAr} selected={selectedCategoryID === category.id} onPress={() => void reloadCatalog(category.id, catalogQuery)} />)}
        </ScrollView>
      </> : null}
      {state.catalog.sections.filter((section) => section.active).length > 0 ? <>
        <Text style={styles.filterLabel}>أقسام العرض</Text>
        <ScrollView horizontal contentContainerStyle={styles.sectionChips} showsHorizontalScrollIndicator={false}>
          <BthwaniChip label="كل المنتجات" selected={!selectedSectionID} onPress={() => setSelectedSectionID(null)} />
          {state.catalog.sections.filter((section) => section.active).map((section) => <BthwaniChip key={section.id} label={section.nameAr} selected={selectedSectionID === section.id} onPress={() => setSelectedSectionID(section.id)} />)}
        </ScrollView>
      </> : null}
      {visibleSections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.nameAr}</Text>
          {section.offerIds.map((offerId) => state.catalog.offers.find((offer) => offer.offerId === offerId)).filter((offer): offer is PublicCatalogResponse["offers"][number] => Boolean(offer)).map(renderOffer)}
        </View>
      ))}
      {(!selectedSectionID ? state.catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)) : []).map(renderOffer)}
      {visibleOfferCount === 0 ? <BthwaniSurface tone="inset" style={styles.emptySection}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /><Text style={styles.sectionTitle}>{selectedSectionID ? "لا توجد منتجات في هذا القسم" : "لا توجد منتجات متاحة حاليًا"}</Text>{selectedSectionID ? <BthwaniButton label="عرض كل المنتجات" onPress={() => setSelectedSectionID(null)} variant="quiet" /> : null}</BthwaniSurface> : null}
      {state.catalog.nextCursor ? <BthwaniButton busy={loadingMore} disabled={catalogRefreshing} label="تحميل المزيد" onPress={() => void loadMore()} style={styles.loadMoreButton} variant="secondary" /> : null}
      <BthwaniSurface tone="inset" style={styles.cartCta}>
        <View style={styles.cartIcon}><BthwaniIcon name="cart" color={theme.interactiveText} size={sizing.iconLg} /></View>
        <Text style={styles.muted}>طريقة الطلب المختارة: {selectedFulfillmentMode ? fulfillmentModeLabel(selectedFulfillmentMode) : "لم تختر بعد"} · ستتمكن من مراجعتها في السلة.</Text>
        <BthwaniButton accessibilityLabel="فتح السلة" disabled={mutationBusy || !selectedFulfillmentMode} label="فتح السلة" onPress={() => router.push(`/cart/${encodeURIComponent(storeId)}?fulfillmentMode=${encodeURIComponent(selectedFulfillmentMode ?? "")}` as Href)} />
      </BthwaniSurface>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function fulfillmentModeDescription(mode: CustomerFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "المنصة تتولى إسناد التوصيل وإدارته.";
  if (mode === "PARTNER_CAPTAIN") return "المتجر يختار أحد كباتنه لتوصيل الطلب. لا توجد رسوم توصيل في الإصدار الأول.";
  return "تذهب إلى المتجر وتستلم الطلب بنفسك، من دون توصيل أو عنوان توصيل.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    backButton: { alignItems: "center", flexDirection: "row", gap: spacing[1], minHeight: sizing.controlMd },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted, lineHeight: 20 },
    merchantHero: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    merchantIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    merchantImage: { borderRadius: radius.lg, height: sizing.avatarLg, width: sizing.avatarLg },
    merchantCopy: { flex: 1, gap: spacing[1] },
    fulfillmentModes: { gap: spacing[2], padding: spacing[3] },
    rating: { ...typography.bodySm, color: theme.warning },
    sectionChips: { gap: spacing[2], paddingVertical: spacing[1] },
    searchField: { width: "100%" },
    searchActions: { flexDirection: "row", gap: spacing[2] },
    searchButton: { flex: 1 },
    filterLabel: { ...typography.bodyStrong, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, color: theme.color },
    section: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    item: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    productImage: { backgroundColor: theme.surface, borderRadius: radius.md, height: 172, width: "100%" },
    productImagePlaceholder: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.md, height: 172, justifyContent: "center", width: "100%" },
    itemHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing[3], justifyContent: "space-between" },
    itemCopy: { flex: 1, gap: spacing[1] },
    itemTitle: { ...typography.bodyStrong, color: theme.color },
    itemPrice: { ...typography.titleSm, color: theme.interactiveText },
    quantityHint: { ...typography.caption, color: theme.colorMuted },
    quantityInput: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[3], textAlign: "left", writingDirection: "ltr" },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    modifierGroup: { gap: spacing[2], marginTop: spacing[1] },
    modifierOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    invalidModifierOption: { borderColor: theme.danger },
    emptySection: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    back: { ...typography.body, color: theme.interactiveText },
    cartCta: { alignItems: "center", borderRadius: radius.xl, gap: spacing[2], padding: spacing[4] },
    cartIcon: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.round, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    success: { ...typography.bodySm, color: theme.success, lineHeight: 19 },
    validationError: { ...typography.bodySm, color: theme.danger, lineHeight: 19 },
    error: { ...typography.bodySm, color: theme.danger, lineHeight: 19 },
    loadMoreButton: { width: "100%" },
  });
}

function filterCatalogToProduct(catalog: PublicCatalogResponse, productID: string): PublicCatalogResponse {
  const offers = catalog.offers.filter((offer) => offer.productId === productID);
  const offerIDs = new Set(offers.map((offer) => offer.offerId));
  return { ...catalog, offers, sections: catalog.sections.map((section) => ({ ...section, offerIds: section.offerIds.filter((offerID) => offerIDs.has(offerID)) })).filter((section) => section.offerIds.length > 0) };
}

function mergeCatalog(current: PublicCatalogResponse, next: PublicCatalogResponse): PublicCatalogResponse {
  const seen = new Set<string>();
  const offers = [...current.offers, ...next.offers].filter((offer) => {
    if (seen.has(offer.offerId)) return false;
    seen.add(offer.offerId);
    return true;
  });
  return { ...current, offers, nextCursor: next.nextCursor };
}

function formatQuantity(baseUnit: string, quantity: number): string {
  if (baseUnit === "GRAM") return `${String(quantity)} غ`;
  if (baseUnit === "MILLILITER") return `${String(quantity)} مل`;
  return String(quantity);
}

function isQuantityAllowed(offer: PublicCatalogResponse["offers"][number], quantity: number): boolean {
  return quantity >= offer.quantityMinBaseUnits && quantity <= offer.quantityMaxBaseUnits && (quantity - offer.quantityMinBaseUnits) % offer.quantityStepBaseUnits === 0;
}

function modifierGroupError(group: PublicCatalogResponse["offers"][number]["modifierGroups"][number], selectedIds: ReadonlyArray<string>): string {
  const selectedCount = group.options.filter((option) => selectedIds.includes(option.id)).length;
  if (selectedCount < group.minSelections) return `اختر ${group.minSelections} خيارًا على الأقل من ${group.nameAr}.`;
  if (selectedCount > group.maxSelections) return `اختر ${group.maxSelections} خيارًا كحد أقصى من ${group.nameAr}.`;
  return "";
}

function validateModifierSelection(offer: PublicCatalogResponse["offers"][number], selectedIds: ReadonlyArray<string>): string {
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

function dshMutationErrorMessage(cause: unknown, fallback: string): string {
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  if (code === "OFFER_UNAVAILABLE") return "لم يعد هذا المنتج متاحًا. حدّث الكتالوج ثم أعد المحاولة.";
  if (code === "INVALID_INPUT") return "تحقق من الكمية والخيارات المحددة ثم أعد المحاولة.";
  if (code === "UNAUTHENTICATED") return "سجّل الدخول لإضافة المنتج إلى السلة.";
  if (code === "STALE_CHECKOUT") return "تغيرت السلة أو بيانات المنتج. افتح السلة لقراءة الحالة الحالية.";
  return fallback;
}
