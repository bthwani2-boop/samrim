import { borders, elevation, radius, type resolveTheme, sizing, spacing, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type CartResponse, type CustomerFulfillmentMode, formatMoney, fulfillmentModeLabel, type PublicCatalogResponse, type PublicPromotionView, type PublicStoreView, type StoreOrderability } from "@bthwani/dsh";
import * as ExpoLinking from "expo-linking";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { currentIdentityState } from "../../bootstrap/identity";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { PromotionCard } from "./promotion-card";
import { addCatalogOfferToCart, listFavoriteStoreIDs, listFavoriteStoreOfferIDs, listPublicPromotions, readFavoriteStoreCatalog, readOwnStoreCart, readPublicStoreCatalog, readPublicStoreOrderability, readPublishedStore, setFavoriteStore, setFavoriteStoreOffer } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

function categoryTrail(categoryId: string, categories: PublicCatalogResponse["categories"]): ReadonlyArray<PublicCatalogResponse["categories"][number]> {
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
  const [selectedCategoryID, setSelectedCategoryID] = useState<string | null>(null);
  const [activeProductID, setActiveProductID] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const catalogRequestID = useRef(0);
  const cartReadRequestID = useRef(0);
  const promotionRequestID = useRef(0);
  const [error, setError] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteOfferIDs, setFavoriteOfferIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedProductImageIDs, setFailedProductImageIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedCategoryImageIDs, setFailedCategoryImageIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedStoreImage, setFailedStoreImage] = useState(false);
  const [favoriteOfferBusyID, setFavoriteOfferBusyID] = useState("");
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteLoadError, setFavoriteLoadError] = useState(false);
  const [promotions, setPromotions] = useState<ReadonlyArray<PublicPromotionView>>([]);
  const [promotionLoading, setPromotionLoading] = useState(true);
  const [promotionError, setPromotionError] = useState(false);
  const [favoritesView, setFavoritesView] = useState(false);
  const [popularView, setPopularView] = useState(false);
  const [expandedOfferIDs, setExpandedOfferIDs] = useState<ReadonlySet<string>>(new Set());
  const [selectedFulfillmentMode, setSelectedFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);
  const [orderabilityByMode, setOrderabilityByMode] = useState<ReadonlyArray<StoreOrderability> | null>(null);
  const [openCart, setOpenCart] = useState<CartResponse["cart"] | null>(null);
  const [cartReadError, setCartReadError] = useState(false);
  const fulfillmentModes = useMemo(() => state.kind === "ready" ? availableCustomerFulfillmentModes(state.store.fulfillmentModes) : [], [state]);
  const mutationBusy = Boolean(busyOfferId);

  const load = useCallback(async () => {
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    const cartRequestID = ++cartReadRequestID.current;
    const promotionID = promotionRequestID.current + 1;
    promotionRequestID.current = promotionID;
    setSelectedCategoryID(categoryId.trim() || null);
    setActiveProductID(productId.trim());
    setCatalogQuery("");
    setCatalogRefreshing(false);
    setLoadingMore(false);
    setPromotions([]);
    setPromotionLoading(true);
    setPromotionError(false);
    setSelectedFulfillmentMode(null);
    setOrderabilityByMode(null);
    setOpenCart(null);
    setCartReadError(false);
    setFailedStoreImage(false);
    setIsFavorite(false);
    setFavoriteOfferIDs(new Set());
    setFavoritesView(false);
    setPopularView(false);
    setFavoriteLoadError(false);
    if (!storeId.trim() || !selectedCityID) {
      setPromotionLoading(false);
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const orderabilityRequest = readPublicStoreOrderability(storeId, selectedCityID)
        .then((result) => result.orderabilityByMode)
        .catch(() => null);
      const promotionRequest = listPublicPromotions(selectedCityID, storeId)
        .then((result) => {
          if (promotionID !== promotionRequestID.current) return;
          setPromotions(result.promotions);
          setPromotionError(false);
        })
        .catch(() => {
          if (promotionID !== promotionRequestID.current) return;
          setPromotions([]);
          setPromotionError(true);
        })
        .finally(() => {
          if (promotionID === promotionRequestID.current) setPromotionLoading(false);
        });
      const [store, rawCatalog] = await Promise.all([
        readPublishedStore(storeId, selectedCityID),
        readPublicStoreCatalog(storeId, selectedCityID, categoryId.trim(), "", 20, "", productId.trim()),
      ]);
      const catalog = productId.trim() ? filterCatalogToProduct(rawCatalog, productId.trim()) : rawCatalog;
      if (requestID !== catalogRequestID.current) return;
      setFavoriteLoadError(false);
      setState({ kind: "ready", store, catalog });
      if (currentIdentityState().kind === "authenticated") {
        void Promise.allSettled([listFavoriteStoreIDs(), listFavoriteStoreOfferIDs(storeId)]).then(([storesResult, offersResult]) => {
          if (requestID !== catalogRequestID.current) return;
          if (storesResult.status === "fulfilled") setIsFavorite(storesResult.value.includes(storeId));
          if (offersResult.status === "fulfilled") setFavoriteOfferIDs(new Set(offersResult.value));
          setFavoriteLoadError(storesResult.status === "rejected" || offersResult.status === "rejected");
        });
        void readOwnStoreCart(storeId).then((result) => {
          if (requestID !== catalogRequestID.current || cartRequestID !== cartReadRequestID.current) return;
          setOpenCart(result?.cart ?? null);
          setCartReadError(false);
        }).catch(() => {
          if (requestID === catalogRequestID.current && cartRequestID === cartReadRequestID.current) setCartReadError(true);
        });
      }
      void orderabilityRequest.then((orderability) => {
        if (requestID === catalogRequestID.current) setOrderabilityByMode(orderability);
      });
      void promotionRequest;
    } catch {
      if (requestID !== catalogRequestID.current) return;
      setPromotionLoading(false);
      setState({ kind: "error" });
    }
  }, [categoryId, productId, selectedCityID, storeId]);

  async function retryPromotions() {
    if (!selectedCityID) return;
    const requestID = promotionRequestID.current + 1;
    promotionRequestID.current = requestID;
    setPromotionLoading(true);
    setPromotionError(false);
    try {
      const result = await listPublicPromotions(selectedCityID, storeId);
      if (requestID !== promotionRequestID.current) return;
      setPromotions(result.promotions);
    } catch {
      if (requestID !== promotionRequestID.current) return;
      setPromotionError(true);
    } finally {
      if (requestID === promotionRequestID.current) setPromotionLoading(false);
    }
  }

  const reloadCatalog = useCallback(async (categoryID: string | null, query: string, favoriteOnly = favoritesView, popularOnly = popularView) => {
    if (!storeId.trim() || !selectedCityID) return;
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    setCatalogRefreshing(true);
    setError("");
    try {
      const catalog = favoriteOnly
        ? await readFavoriteStoreCatalog(storeId, selectedCityID, 20)
        : await readPublicStoreCatalog(storeId, selectedCityID, categoryID ?? "", query.trim(), 20, "", "", popularOnly ? "MOST_ORDERED_30_DAYS" : "");
      if (requestID !== catalogRequestID.current) return;
      setSelectedCategoryID(favoriteOnly ? null : categoryID);
      setActiveProductID("");
      setFavoritesView(favoriteOnly);
      setPopularView(!favoriteOnly && popularOnly);
      setCatalogQuery(favoriteOnly ? "" : query);
      setState((current) => current.kind === "ready" ? { kind: "ready", store: current.store, catalog } : current);
    } catch {
      if (requestID === catalogRequestID.current) setError("تعذر تحديث الكتالوج. يمكنك متابعة العناصر الحالية أو إعادة المحاولة.");
    } finally {
      if (requestID === catalogRequestID.current) setCatalogRefreshing(false);
    }
  }, [favoritesView, popularView, selectedCityID, storeId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (fulfillmentModes.length === 1 && fulfillmentModes[0] && selectedFulfillmentMode === null) setSelectedFulfillmentMode(fulfillmentModes[0]);
  }, [fulfillmentModes, selectedFulfillmentMode]);

  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز المتجر"><BthwaniSkeleton width="30%" height={28} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={160} /><BthwaniSkeleton height={160} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة المتجر</Text><Text style={styles.muted}>قد لا يكون المتجر متاحًا في مدينة الخدمة الحالية.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة" onPress={() => router.back()} variant="secondary" /></View>;
  }

  const activeCatalogCategories = state.catalog.categories.filter((category) => category.active);
  const selectedCategory = activeCatalogCategories.find((category) => category.id === selectedCategoryID);
  const selectedCategoryTrail = selectedCategory ? categoryTrail(selectedCategory.id, activeCatalogCategories) : [];
  const categoryChildren = selectedCategory
    ? activeCatalogCategories.filter((category) => category.parentCategoryId === selectedCategory.id)
    : activeCatalogCategories.filter((category) => !category.parentCategoryId);
  const activeSections = state.catalog.sections.filter((section) => section.active);
  const sectionOfferIds = new Set(activeSections.flatMap((section) => section.offerIds));
  const visibleSections = activeSections;
  const visibleOfferCount = state.catalog.offers.length;
  const emptyOfferMessage = favoritesView
    ? "لم تحفظ منتجات من هذا المتجر بعد"
    : popularView
      ? catalogQuery.trim()
        ? "لا توجد منتجات مطابقة"
        : selectedCategoryID
          ? "لا توجد منتجات رائجة في هذا التصنيف خلال آخر 30 يومًا"
          : "لا توجد منتجات مطلوبة خلال آخر 30 يومًا"
      : "لا توجد منتجات متاحة حاليًا";

  const renderCategoryChip = (category: PublicCatalogResponse["categories"][number], selected: boolean) => (
    <Pressable
      key={category.id}
      accessibilityRole="button"
      accessibilityLabel={`تصنيف ${category.nameAr}`}
      accessibilityState={{ selected }}
      onPress={() => void reloadCatalog(category.id, catalogQuery, false, popularView)}
      style={[styles.categoryChip, selected && styles.categoryChipSelected]}
    >
      {category.imageUri && !failedCategoryImageIDs.has(category.id)
        ? <Image accessibilityLabel={`صورة ${category.nameAr}`} onError={() => setFailedCategoryImageIDs((current) => new Set(current).add(category.id))} source={{ uri: category.imageUri }} resizeMode="cover" style={styles.categoryThumbnail} />
        : <View style={[styles.categoryThumbnailPlaceholder, selected && styles.categoryThumbnailSelected]}><BthwaniIcon name="store" color={selected ? theme.onAction : theme.colorMuted} size={sizing.iconSm} /></View>}
      <Text numberOfLines={1} style={[styles.categoryChipLabel, selected && styles.categoryChipLabelSelected]}>{category.nameAr}</Text>
    </Pressable>
  );

  async function loadMore() {
    if (loadingMore || catalogRefreshing || state.kind !== "ready" || !selectedCityID || !state.catalog.nextCursor) return;
    const requestID = catalogRequestID.current + 1;
    catalogRequestID.current = requestID;
    setLoadingMore(true);
    setError("");
    try {
      const catalog = favoritesView
        ? await readFavoriteStoreCatalog(storeId, selectedCityID, 20, state.catalog.nextCursor)
        : await readPublicStoreCatalog(storeId, selectedCityID, selectedCategoryID ?? "", catalogQuery.trim(), 20, state.catalog.nextCursor, activeProductID, popularView ? "MOST_ORDERED_30_DAYS" : "");
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
    cartReadRequestID.current += 1;
    setAddedOfferId("");
    setError("");
    try {
      const result = await addCatalogOfferToCart(storeId, offer, quantity, selectedModifierOptionIds[offer.offerId] ?? []);
      setOpenCart(result.cart);
      setCartReadError(false);
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

  async function shareStore() {
    setError("");
    const storeLink = ExpoLinking.createURL(`store/${encodeURIComponent(storeId)}`);
    try {
      await Share.share({
        message: `${state.kind === "ready" ? state.store.name : "متجر"} على بثواني\n${storeLink}`,
        title: state.kind === "ready" ? state.store.name : "مشاركة المتجر",
      });
    } catch {
      setError("تعذر فتح خيارات مشاركة المتجر. حاول مجددًا.");
    }
  }

  async function toggleOfferFavorite(offerID: string) {
    if (favoriteOfferBusyID) return;
    if (currentIdentityState().kind !== "authenticated") {
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    setFavoriteOfferBusyID(offerID);
    setError("");
    try {
      const isFavoriteNow = await setFavoriteStoreOffer(offerID, !favoriteOfferIDs.has(offerID));
      setFavoriteOfferIDs((current) => {
        const next = new Set(current);
        if (isFavoriteNow) next.add(offerID);
        else next.delete(offerID);
        return next;
      });
      if (favoritesView && !isFavoriteNow) {
        setState((current) => current.kind === "ready" ? { kind: "ready", store: current.store, catalog: { ...current.catalog, offers: current.catalog.offers.filter((offer) => offer.offerId !== offerID) } } : current);
      }
      setFavoriteLoadError(false);
    } catch {
      setError("تعذر تحديث مفضلة المنتجات. أعد المحاولة.");
    } finally {
      setFavoriteOfferBusyID("");
    }
  }

  async function reloadFavorites() {
    if (currentIdentityState().kind !== "authenticated") {
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    setFavoriteLoading(true);
    try {
      const [storesResult, offersResult] = await Promise.allSettled([listFavoriteStoreIDs(), listFavoriteStoreOfferIDs(storeId)]);
      if (storesResult.status === "fulfilled") setIsFavorite(storesResult.value.includes(storeId));
      if (offersResult.status === "fulfilled") setFavoriteOfferIDs(new Set(offersResult.value));
      setFavoriteLoadError(storesResult.status === "rejected" || offersResult.status === "rejected");
    } finally {
      setFavoriteLoading(false);
    }
  }

  const renderOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    const selectedOptions = selectedModifierOptionIds[offer.offerId] ?? [];
    const quantity = quantities[offer.offerId] ?? String(offer.quantityMinBaseUnits);
    const parsedQuantity = Number(quantity);
    const busy = busyOfferId === offer.offerId;
    const modifierError = validateModifierSelection(offer, selectedOptions);
    const primaryMedia = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
    const expanded = expandedOfferIDs.has(offer.offerId);
    const needsOptionReview = offer.modifierGroups.length > 0 && !expanded;
    const canIncreaseQuantity = !mutationBusy && (!Number.isSafeInteger(parsedQuantity) || parsedQuantity + offer.quantityStepBaseUnits <= offer.quantityMaxBaseUnits);
    const canDecreaseQuantity = !mutationBusy && (!Number.isSafeInteger(parsedQuantity) || parsedQuantity - offer.quantityStepBaseUnits >= offer.quantityMinBaseUnits);
    return (
      <BthwaniSurface key={offer.offerId} tone="base" style={styles.item}>
        <View style={styles.productSummary}>
          <View style={styles.productImageFrame}>
            {primaryMedia && !failedProductImageIDs.has(offer.offerId)
              ? <Image accessibilityLabel={`صورة ${offer.productName}`} onError={() => setFailedProductImageIDs((current) => new Set(current).add(offer.offerId))} source={{ uri: primaryMedia.uri }} resizeMode="cover" style={styles.productImage} />
              : <View accessibilityLabel={`لا توجد صورة متاحة لـ ${offer.productName}`} style={styles.productImagePlaceholder}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /></View>}
            <BthwaniIconButton disabled={Boolean(favoriteOfferBusyID)} icon="favorite" label={favoriteOfferIDs.has(offer.offerId) ? `إزالة ${offer.productName} من المفضلة` : `إضافة ${offer.productName} إلى المفضلة`} onPress={() => void toggleOfferFavorite(offer.offerId)} size={sizing.controlMd} style={styles.productFavorite} tone={favoriteOfferIDs.has(offer.offerId) ? "primary" : "soft"} />
          </View>
          <View style={styles.productCopyAndAction}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "إخفاء تفاصيل" : "عرض تفاصيل"} ${offer.productName}`} accessibilityHint="اضغط على اسم المنتج لعرض التفاصيل وتعديل الكمية" accessibilityState={{ expanded }} onPress={() => setExpandedOfferIDs((current) => { const next = new Set(current); if (expanded) next.delete(offer.offerId); else next.add(offer.offerId); return next; })} style={styles.itemCopy}>
              <Text numberOfLines={1} style={styles.itemTitle}>{offer.productName}</Text>
            </Pressable>
            <View style={styles.productActionRow}>
              <Text style={styles.productActionPrice}>{formatMoney(offer.priceMinor, offer.currency)}</Text>
              <BthwaniButton accessibilityLabel={needsOptionReview ? `عرض خيارات ${offer.productName}` : `إضافة ${offer.productName} إلى السلة`} busy={busy} disabled={mutationBusy || (!needsOptionReview && (Boolean(modifierError) || !selectedFulfillmentMode))} label={needsOptionReview ? modifierError ? "اختر الخيارات" : "عرض الخيارات" : "أضف للسلة"} onPress={() => { if (needsOptionReview) setExpandedOfferIDs((current) => new Set(current).add(offer.offerId)); else void add(offer); }} style={styles.addOfferButton} />
            </View>
          </View>
        </View>
        {expanded ? <>
          {offer.productDescription ? <Text style={styles.muted}>{offer.productDescription}</Text> : null}
          <Text style={styles.quantityHint}>الكمية: {formatQuantity(offer.baseUnit, offer.quantityMinBaseUnits)}–{formatQuantity(offer.baseUnit, offer.quantityMaxBaseUnits)} · الخطوة {formatQuantity(offer.baseUnit, offer.quantityStepBaseUnits)}</Text>
          <View style={styles.quantityRow}>
            <Text style={styles.filterLabel}>الكمية</Text>
            <View style={styles.quantityStepper}>
              <Pressable accessibilityRole="button" accessibilityLabel={`زيادة كمية ${offer.productName}`} accessibilityState={{ disabled: !canIncreaseQuantity }} disabled={!canIncreaseQuantity} onPress={() => setQuantities((current) => {
                const currentValue = Number(current[offer.offerId] ?? offer.quantityMinBaseUnits);
                const baseValue = Number.isSafeInteger(currentValue) && currentValue >= offer.quantityMinBaseUnits ? currentValue : offer.quantityMinBaseUnits;
                return { ...current, [offer.offerId]: String(Math.min(offer.quantityMaxBaseUnits, baseValue + offer.quantityStepBaseUnits)) };
              })} style={[styles.quantityAction, !canIncreaseQuantity && styles.quantityActionDisabled]}><Text style={[styles.quantityActionText, !canIncreaseQuantity && styles.quantityActionTextDisabled]}>+</Text></Pressable>
              <TextInput accessibilityLabel={`كمية ${offer.productName}`} editable={!mutationBusy} keyboardType="number-pad" onChangeText={(value) => setQuantities((current) => ({ ...current, [offer.offerId]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={quantity} style={[styles.quantityInput, mutationBusy && styles.disabledInput]} />
              <Pressable accessibilityRole="button" accessibilityLabel={`تقليل كمية ${offer.productName}`} accessibilityState={{ disabled: !canDecreaseQuantity }} disabled={!canDecreaseQuantity} onPress={() => setQuantities((current) => {
                const currentValue = Number(current[offer.offerId] ?? offer.quantityMinBaseUnits);
                const baseValue = Number.isSafeInteger(currentValue) && currentValue >= offer.quantityMinBaseUnits ? currentValue : offer.quantityMinBaseUnits;
                return { ...current, [offer.offerId]: String(Math.max(offer.quantityMinBaseUnits, baseValue - offer.quantityStepBaseUnits)) };
              })} style={[styles.quantityAction, !canDecreaseQuantity && styles.quantityActionDisabled]}><Text style={[styles.quantityActionText, !canDecreaseQuantity && styles.quantityActionTextDisabled]}>−</Text></Pressable>
            </View>
          </View>
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
        </> : null}
        {addedOfferId === offer.offerId ? <Text accessibilityLiveRegion="polite" style={styles.success}>تمت الإضافة. يمكنك متابعة اختيار المنتجات أو فتح السلة.</Text> : null}
      </BthwaniSurface>
    );
  };

  return (
    <View style={styles.page} accessibilityLabel={`كتالوج ${state.store.name}`}>
      <View style={styles.storeHeader}>
        <View style={styles.storeHeaderIdentity}>
          <View style={styles.storeHeaderCopy}>
            <Text numberOfLines={1} style={styles.storeHeaderTitle}>{state.store.name}</Text>
            <Text numberOfLines={1} style={styles.storeHeaderCity}>{serviceCityDisplayName(state.store.serviceCity.displayNameAr)}</Text>
          </View>
          {state.store.storeProfileImage?.uri && !failedStoreImage ? <Image accessibilityLabel={`شعار متجر ${state.store.name}`} onError={() => setFailedStoreImage(true)} source={{ uri: state.store.storeProfileImage.uri }} style={styles.merchantImage} resizeMode="cover" /> : <View style={styles.storeHeaderLogoFallback}><BthwaniIcon name="store" color={theme.onAction} size={sizing.iconMd} /></View>}
          <BthwaniIconButton icon="back" label="العودة إلى المتاجر" onPress={() => router.back()} size={sizing.controlMd} style={styles.storeHeaderBack} tone="soft" />
        </View>
        <View style={styles.storeHeaderActions}>
          <BthwaniIconButton icon={catalogSearchOpen ? "close" : "search"} label={catalogSearchOpen ? "إغلاق البحث داخل المتجر" : "البحث في منتجات المتجر"} onPress={() => { setCatalogSearchOpen((open) => !open); if (catalogSearchOpen) { setCatalogQuery(""); void reloadCatalog(selectedCategoryID, ""); } }} size={sizing.controlMd} style={styles.storeHeaderAction} tone="primary" />
          <BthwaniIconButton icon="cart" label="سلة التسوق" onPress={() => router.push("/multi-store-checkout" as Href)} size={sizing.controlMd} style={styles.storeHeaderAction} tone="primary" />
          <BthwaniIconButton icon="share" label="مشاركة المتجر" onPress={() => void shareStore()} size={sizing.controlMd} style={styles.storeHeaderAction} tone="primary" />
          <BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlMd} style={styles.storeHeaderAction} tone="primary" />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <BthwaniSurface tone="raised" style={styles.orderStatus} accessibilityLabel="حالة المتجر وطرق الطلب">
        <View style={styles.orderStatusTop}>
          <View style={styles.orderStatusCopy}>
            <Text numberOfLines={1} style={styles.orderStatusMeta}>{selectedFulfillmentMode ? `${fulfillmentModeLabel(selectedFulfillmentMode)} · ${orderabilityEta(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode))}` : "اختر طريقة الطلب"}</Text>
          </View>
          <View style={styles.orderStatusBadge}><Text style={styles.orderStatusBadgeText}>{selectedFulfillmentMode ? orderabilityBadge(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode)) : "الطلب"}</Text></View>
        </View>
        {fulfillmentModes.length > 1 ? <View style={styles.modeOptions}>{fulfillmentModes.map((mode) => <BthwaniChip key={mode} accessibilityHint={fulfillmentModeDescription(mode)} label={fulfillmentModeLabel(mode)} onPress={() => { setSelectedFulfillmentMode(mode); setError(""); }} selected={selectedFulfillmentMode === mode} />)}</View> : null}
      </BthwaniSurface>
      {catalogSearchOpen && !favoritesView ? <BthwaniSearchField
        accessibilityLabel="البحث في منتجات المتجر"
        containerStyle={styles.searchField}
        editable={!catalogRefreshing && !loadingMore}
        onChangeText={setCatalogQuery}
        onClear={() => { setCatalogQuery(""); void reloadCatalog(selectedCategoryID, ""); }}
        onSubmitEditing={() => void reloadCatalog(selectedCategoryID, catalogQuery)}
        placeholder="ابحث باسم المنتج"
        returnKeyType="search"
        value={catalogQuery}
      /> : null}
      <ScrollView horizontal contentContainerStyle={styles.categoryRail} showsHorizontalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="عرض كل منتجات المتجر" accessibilityState={{ selected: !favoritesView && !popularView && !selectedCategoryID, disabled: catalogRefreshing || loadingMore }} disabled={catalogRefreshing || loadingMore} onPress={() => void reloadCatalog(null, "", false, false)} style={[styles.catalogFilterChip, !favoritesView && !popularView && !selectedCategoryID && styles.catalogFilterChipSelected]}><Text style={[styles.catalogFilterChipLabel, !favoritesView && !popularView && !selectedCategoryID && styles.catalogFilterChipLabelSelected]}>كل المنتجات</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="عرض المنتجات المفضلة" accessibilityState={{ selected: favoritesView, disabled: catalogRefreshing || loadingMore }} disabled={catalogRefreshing || loadingMore} onPress={() => { if (currentIdentityState().kind !== "authenticated") { router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href); return; } setCatalogSearchOpen(false); void reloadCatalog(null, "", true, false); }} style={[styles.catalogFilterChip, favoritesView && styles.catalogFilterChipSelected]}><BthwaniIcon name="favorite" color={favoritesView ? theme.onAction : theme.interactiveText} size={sizing.iconSm} /><Text style={[styles.catalogFilterChipLabel, favoritesView && styles.catalogFilterChipLabelSelected]}>المفضلة</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="عرض المنتجات الأكثر رواجًا خلال آخر 30 يومًا" accessibilityState={{ selected: popularView, disabled: catalogRefreshing || loadingMore }} disabled={catalogRefreshing || loadingMore} onPress={() => { setCatalogSearchOpen(false); void reloadCatalog(selectedCategoryID, "", false, true); }} style={[styles.catalogFilterChip, popularView && styles.catalogFilterChipSelected]}><BthwaniIcon name="trending" color={popularView ? theme.onAction : theme.interactiveText} size={sizing.iconSm} /><Text style={[styles.catalogFilterChipLabel, popularView && styles.catalogFilterChipLabelSelected]}>الأكثر رواجًا</Text></Pressable>
        {!favoritesView && activeCatalogCategories.length > 0 ? <>
          {selectedCategoryTrail.map((category, index) => renderCategoryChip(category, index === selectedCategoryTrail.length - 1))}
          {categoryChildren.map((category) => renderCategoryChip(category, selectedCategoryID === category.id))}
        </> : null}
      </ScrollView>
      {favoritesView ? <BthwaniSectionHeader title="المنتجات المفضلة" subtitle={`${state.catalog.offers.length} منتج معروض${catalogRefreshing ? " · جارٍ التحديث…" : ""}`} /> : null}
      {!favoritesView && !popularView ? visibleSections.map((section) => (
        <View key={section.id} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.nameAr}</Text>
          {section.offerIds.map((offerId) => state.catalog.offers.find((offer) => offer.offerId === offerId)).filter((offer): offer is PublicCatalogResponse["offers"][number] => Boolean(offer)).map(renderOffer)}
        </View>
      )) : null}
      {favoritesView || popularView ? state.catalog.offers.map(renderOffer) : state.catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)).map(renderOffer)}
      {visibleOfferCount === 0 ? <BthwaniSurface tone="inset" style={styles.emptySection}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /><Text style={styles.sectionTitle}>{emptyOfferMessage}</Text></BthwaniSurface> : null}
      {state.catalog.nextCursor ? <BthwaniButton busy={loadingMore} disabled={catalogRefreshing} label="تحميل المزيد" onPress={() => void loadMore()} style={styles.loadMoreButton} variant="secondary" /> : null}
      {promotionError ? <View style={styles.promotionNotice}><Text accessibilityRole="alert" style={styles.validationError}>تعذر قراءة عروض هذا المتجر؛ يمكنك متابعة الطلب من دونها.</Text><BthwaniButton label="إعادة قراءة العروض" onPress={() => void retryPromotions()} variant="secondary" /></View> : null}
      {!promotionLoading && !promotionError && promotions.length > 0 ? <>
        <BthwaniSectionHeader title="عروض هذا المتجر" subtitle="تُطبّق الأكواد على الطلبات المؤهلة من هذا المتجر." />
        <View style={styles.promotionList}>{promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} />)}</View>
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {favoriteLoadError ? <BthwaniSurface tone="inset" style={styles.favoriteNotice}><Text style={styles.muted}>تعذر تحديث حالة المفضلة من الخادم.</Text><BthwaniButton busy={favoriteLoading} label="إعادة المحاولة" onPress={() => void reloadFavorites()} variant="secondary" /></BthwaniSurface> : null}
      </ScrollView>
      {openCart?.lines.length || cartReadError ? <SafeAreaView edges={["bottom"]} style={styles.cartSafeArea}>
        <BthwaniSurface tone="raised" style={styles.cartCta}>
          <View style={styles.cartSummary}>
            <Text style={styles.cartTitle}>{cartReadError ? "تعذر تحديث السلة" : `سلتك · ${openCart?.lines.length ?? 0} منتجات`}</Text>
            <Text style={styles.cartValue}>{cartReadError ? "افتح السلة لإعادة قراءة محتوياتها" : openCart?.lines.some((line) => line.requiresReview) ? "تحتاج بعض الأسعار إلى مراجعة" : `قيمة المنتجات ${formatMoney(openCart?.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0) ?? 0, "YER")}`}</Text>
          </View>
          <BthwaniButton accessibilityLabel="مراجعة محتويات السلة" disabled={mutationBusy} label="مراجعة السلة" onPress={() => router.push(`/cart/${encodeURIComponent(storeId)}?fulfillmentMode=${encodeURIComponent(selectedFulfillmentMode ?? "")}` as Href)} />
        </BthwaniSurface>
      </SafeAreaView> : null}
    </View>
  );
}

function fulfillmentModeDescription(mode: CustomerFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "المنصة تتولى إسناد التوصيل وإدارته.";
  if (mode === "PARTNER_CAPTAIN") return "المتجر يختار أحد كباتنه للتوصيل إلى عنوان مؤهل؛ تُراجع الرسوم والتغطية في السلة.";
  return "تذهب إلى المتجر وتستلم الطلب بنفسك، من دون توصيل أو عنوان توصيل.";
}

function orderabilityBadge(orderability: StoreOrderability | undefined): string {
  if (!orderability) return "جار التحقق";
  if (orderability.state === "OPEN_FOR_ORDERS") return "مفتوح";
  if (orderability.state === "CLOSED_BY_SCHEDULE") return "مغلق";
  if (orderability.state === "PAUSED") return "متوقف";
  return "غير متاح";
}

function orderabilityEta(orderability: StoreOrderability | undefined): string {
  if (!orderability) return "تُراجع أهلية الطلب مرة أخرى عند التأكيد.";
  if (orderability.state === "CLOSED_BY_SCHEDULE") return "خارج ساعات العمل الآن";
  if (orderability.state === "PAUSED") return "متوقف مؤقتًا";
  if (orderability.state !== "OPEN_FOR_ORDERS") return "طريقة الطلب غير متاحة حاليًا";
  if (orderability.preparationMinutes) return `مدة التجهيز ${orderability.preparationMinutes} دقيقة`;
  return "تُراجع أهلية الطلب مرة أخرى عند التأكيد.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    page: { backgroundColor: theme.background, flex: 1 },
    container: { backgroundColor: theme.background, gap: spacing[3], paddingBottom: spacing[4], paddingHorizontal: spacing[3], width: "100%" },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted, lineHeight: 20 },
    storeHeader: { alignItems: "center", backgroundColor: theme.interactiveText, flexDirection: "row", gap: spacing[2], minHeight: sizing.controlMd + spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
    storeHeaderIdentity: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[1], minWidth: 0 },
    storeHeaderCopy: { alignItems: "flex-end", flex: 1, gap: 2, minWidth: 0 },
    storeHeaderTitle: { ...typography.titleSm, color: theme.onAction },
    storeHeaderCity: { ...typography.caption, color: theme.onAction, opacity: 0.82 },
    merchantImage: { borderRadius: radius.round, height: sizing.controlMd, width: sizing.controlMd },
    storeHeaderLogoFallback: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.round, height: sizing.controlMd, justifyContent: "center", width: sizing.controlMd },
    storeHeaderBack: { backgroundColor: theme.actionBackground },
    storeHeaderActions: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    storeHeaderAction: { borderColor: "transparent" },
    orderStatus: { alignItems: "stretch", borderRadius: radius.xl, flexDirection: "column", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2], ...elevation.raised },
    orderStatusTop: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    orderStatusCopy: { alignItems: "flex-end", flex: 1, gap: spacing[1], minWidth: 0 },
    orderStatusMeta: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    orderStatusBadge: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, justifyContent: "center", minHeight: sizing.controlMd, minWidth: sizing.controlMd, paddingHorizontal: spacing[3] },
    orderStatusBadgeText: { ...typography.bodyStrong, color: theme.interactiveText },
    modeOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], justifyContent: "flex-end" },
    modeDescription: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    promotionList: { gap: spacing[2] },
    promotionNotice: { alignItems: "flex-start", gap: spacing[2] },
    categoryRail: { alignItems: "center", flexDirection: "row", gap: spacing[2], paddingVertical: spacing[1] },
    catalogFilterChip: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.round, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[1], justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    catalogFilterChipSelected: { backgroundColor: theme.actionBackground, borderColor: theme.actionBackground },
    catalogFilterChipLabel: { ...typography.bodySm, color: theme.color, textAlign: "center" },
    catalogFilterChipLabelSelected: { color: theme.onAction, fontWeight: "600" },
    categoryChip: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.round, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], maxWidth: 190, minHeight: sizing.controlLg, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    categoryChipSelected: { backgroundColor: theme.actionBackground, borderColor: theme.actionBackground },
    categoryThumbnail: { borderRadius: radius.round, height: sizing.avatarSm, width: sizing.avatarSm },
    categoryThumbnailPlaceholder: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.round, height: sizing.avatarSm, justifyContent: "center", width: sizing.avatarSm },
    categoryThumbnailSelected: { backgroundColor: theme.interactiveText },
    categoryChipLabel: { ...typography.bodySm, color: theme.color, maxWidth: 132 },
    categoryChipLabelSelected: { color: theme.onAction },
    searchField: { width: "100%" },
    filterLabel: { ...typography.bodyStrong, color: theme.color },
    sectionTitle: { ...typography.bodyStrong, backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, color: theme.color, minHeight: 72, paddingHorizontal: spacing[4], paddingVertical: spacing[4], textAlign: "right", textAlignVertical: "center" },
    section: { gap: spacing[3] },
    item: { borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2], ...elevation.raised },
    productSummary: { alignItems: "stretch", flexDirection: "row", gap: spacing[3] },
    productImageFrame: { borderRadius: radius.lg, height: 112, overflow: "hidden", position: "relative", width: "34%" },
    productImage: { backgroundColor: theme.surface, height: 112, width: "100%" },
    productImagePlaceholder: { alignItems: "center", backgroundColor: theme.surfaceInset, height: 112, justifyContent: "center", width: "100%" },
    productFavorite: { position: "absolute", right: spacing[1], top: spacing[1] },
    productCopyAndAction: { flex: 1, gap: spacing[1], justifyContent: "space-between", minWidth: 0, paddingVertical: spacing[1] },
    itemCopy: { alignItems: "flex-start", flex: 1, justifyContent: "center", minHeight: sizing.controlMd },
    itemTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    productActionRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between", width: "100%" },
    productActionPrice: { ...typography.bodyStrong, color: theme.interactiveText },
    addOfferButton: { borderRadius: radius.lg, minHeight: sizing.controlMd, minWidth: 116, paddingHorizontal: spacing[3] },
    quantityHint: { ...typography.caption, color: theme.colorMuted },
    quantityRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" },
    quantityStepper: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    quantityAction: { alignItems: "center", backgroundColor: theme.actionSoft, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, height: sizing.controlMd, justifyContent: "center", minWidth: sizing.controlMd },
    quantityActionDisabled: { backgroundColor: theme.surfaceInset },
    quantityActionText: { ...typography.titleSm, color: theme.interactiveText },
    quantityActionTextDisabled: { color: theme.colorMuted },
    quantityInput: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[3], textAlign: "left", writingDirection: "ltr" },
    disabledInput: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground, color: theme.disabledText },
    modifierGroup: { gap: spacing[2], marginTop: spacing[1] },
    modifierOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    invalidModifierOption: { borderColor: theme.danger },
    emptySection: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    cartSafeArea: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
    cartCta: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    cartSummary: { flex: 1, gap: spacing[1] },
    cartTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    cartValue: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    success: { ...typography.bodySm, color: theme.success, lineHeight: 19 },
    validationError: { ...typography.bodySm, color: theme.danger, lineHeight: 19 },
    error: { ...typography.bodySm, color: theme.danger, lineHeight: 19 },
    loadMoreButton: { width: "100%" },
    favoriteNotice: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[3] },
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
