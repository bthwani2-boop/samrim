import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type CartResponse, type CustomerFulfillmentMode, formatMoney, fulfillmentModeLabel, type PublicCatalogResponse, type PublicPromotionView, type PublicStoreView, type StoreOrderability } from "@bthwani/dsh";
import * as ExpoLinking from "expo-linking";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, I18nManager, Image, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { currentIdentityState } from "../../bootstrap/identity";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { PromotionCard } from "./promotion-card";
import { StoreProductSheet } from "./store-product-sheet";
import { addCatalogOfferToCart, listFavoriteStoreIDs, listFavoriteStoreOfferIDs, listPublicPromotions, readFavoriteStoreCatalog, readOwnStoreCart, readPublicStoreCatalog, readPublicStoreOrderability, readPublishedStore, setFavoriteStore, setFavoriteStoreOffer } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

type StoreCatalogRow =
  | { kind: "filters"; key: string }
  | { kind: "section"; key: string; title: string }
  | { kind: "heading"; key: string; title: string; subtitle: string }
  | { kind: "empty"; key: string; title: string }
  | { kind: "offer"; key: string; offer: PublicCatalogResponse["offers"][number] };

type StoreBannerItem =
  | { kind: "offer"; key: string; offer: PublicCatalogResponse["offers"][number] }
  | { kind: "promotion"; key: string; promotion: PublicPromotionView };

type CatalogSnapshot = { catalog: PublicCatalogResponse; categoryID: string | null; query: string; productID: string };

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
  const insets = useSafeAreaInsets();
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
  const [detailOffer, setDetailOffer] = useState<PublicCatalogResponse["offers"][number] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestID = useRef(0);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const catalogRequestID = useRef(0);
  const storeRequestID = useRef(0);
  const [catalogTabs, setCatalogTabs] = useState<Partial<Record<number, CatalogSnapshot>>>({});
  const catalogPagerRef = useRef<FlatList<number> | null>(null);
  const [pagerWidth, setPagerWidth] = useState(0);
  const cartReadRequestID = useRef(0);
  const promotionRequestID = useRef(0);
  const bannerRequestID = useRef(0);
  const [bannerError, setBannerError] = useState(false);
  const [error, setError] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteOfferIDs, setFavoriteOfferIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedProductImageIDs, setFailedProductImageIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedCategoryImageIDs, setFailedCategoryImageIDs] = useState<ReadonlySet<string>>(new Set());
  const [failedStoreImage, setFailedStoreImage] = useState(false);
  const [failedStoreCover, setFailedStoreCover] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  const [favoriteOfferBusyID, setFavoriteOfferBusyID] = useState("");
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteLoadError, setFavoriteLoadError] = useState(false);
  const [promotions, setPromotions] = useState<ReadonlyArray<PublicPromotionView>>([]);
  const [bannerOffers, setBannerOffers] = useState<PublicCatalogResponse["offers"]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerPaused, setBannerPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const bannerRef = useRef<ScrollView | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const [promotionLoading, setPromotionLoading] = useState(true);
  const [promotionError, setPromotionError] = useState(false);
  const [favoritesView, setFavoritesView] = useState(false);
  const [popularView, setPopularView] = useState(false);
  const activeTab = favoritesView ? 1 : popularView ? 2 : 0;
  const [selectedFulfillmentMode, setSelectedFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);
  const [orderabilityByMode, setOrderabilityByMode] = useState<ReadonlyArray<StoreOrderability> | null>(null);
  const [openCart, setOpenCart] = useState<CartResponse["cart"] | null>(null);
  const [cartReadError, setCartReadError] = useState(false);
  const fulfillmentModes = useMemo(() => state.kind === "ready" ? availableCustomerFulfillmentModes(state.store.fulfillmentModes) : [], [state]);
  const mutationBusy = Boolean(busyOfferId);
  const bannerCatalogOffers = bannerOffers.length > 0 ? bannerOffers : (catalogTabs[0]?.catalog.offers ?? (state.kind === "ready" ? state.catalog.offers : []));
  const bannerItems: StoreBannerItem[] = [
    ...promotions.map((promotion) => ({ kind: "promotion" as const, key: `promotion:${promotion.id}`, promotion })),
    ...bannerCatalogOffers.slice(0, 5).map((offer) => ({ kind: "offer" as const, key: `offer:${offer.offerId}`, offer })),
  ].slice(0, 5);
  // Expose neighboring slides; centering padding is part of the scroll content, not each item.
  const bannerViewportWidth = Math.max(1, windowWidth - spacing[3] * 2);
  const bannerWidth = Math.min(220, Math.max(164, Math.round(bannerViewportWidth * 0.52)));
  const bannerStep = bannerWidth + spacing[2];
  const bannerSidePadding = Math.max(0, (bannerViewportWidth - bannerWidth) / 2);

  const loadBanner = useCallback(async () => {
    if (!selectedCityID) return;
    const scope = storeRequestID.current;
    const requestID = ++bannerRequestID.current;
    setBannerError(false);
    try {
      const result = await readPublicStoreCatalog(storeId, selectedCityID, "", "", 5, "", "", "MOST_ORDERED_30_DAYS");
      if (scope === storeRequestID.current && requestID === bannerRequestID.current) setBannerOffers(result.offers.slice(0, 5));
    } catch {
      if (scope === storeRequestID.current && requestID === bannerRequestID.current) setBannerError(true);
    }
  }, [selectedCityID, storeId]);

  const load = useCallback(async () => {
    const requestID = ++storeRequestID.current;
    catalogRequestID.current += 1;
    detailRequestID.current += 1;
    setDetailOffer(null);
    setDetailLoading(false);
    setCatalogTabs({});
    const cartRequestID = ++cartReadRequestID.current;
    const promotionID = promotionRequestID.current + 1;
    promotionRequestID.current = promotionID;
    setSelectedCategoryID(categoryId.trim() || null);
    setActiveProductID(productId.trim());
    setCatalogQuery("");
    setCatalogRefreshing(false);
    setLoadingMore(false);
    setPromotions([]);
    setBannerOffers([]);
    setBannerError(false);
    setBannerIndex(0);
    setBannerPaused(false);
    bannerRef.current?.scrollTo({ x: 0, animated: false });
    setPromotionLoading(true);
    setPromotionError(false);
    setSelectedFulfillmentMode(null);
    setOrderabilityByMode(null);
    setOpenCart(null);
    setCartReadError(false);
    setFailedStoreImage(false);
    setFailedStoreCover(false);
    setHeroVisible(true);
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
      void loadBanner();
      const [store, rawCatalog] = await Promise.all([
        readPublishedStore(storeId, selectedCityID),
        readPublicStoreCatalog(storeId, selectedCityID, categoryId.trim(), "", 20, "", productId.trim()),
      ]);
      const catalog = productId.trim() ? filterCatalogToProduct(rawCatalog, productId.trim()) : rawCatalog;
      if (requestID !== storeRequestID.current) return;
      setFavoriteLoadError(false);
      setState({ kind: "ready", store, catalog });
      setCatalogTabs({ 0: { catalog, categoryID: categoryId.trim() || null, query: "", productID: productId.trim() } });
      if (currentIdentityState().kind === "authenticated") {
        void Promise.allSettled([listFavoriteStoreIDs(), listFavoriteStoreOfferIDs(storeId)]).then(([storesResult, offersResult]) => {
          if (requestID !== storeRequestID.current) return;
          if (storesResult.status === "fulfilled") setIsFavorite(storesResult.value.includes(storeId));
          if (offersResult.status === "fulfilled") setFavoriteOfferIDs(new Set(offersResult.value));
          setFavoriteLoadError(storesResult.status === "rejected" || offersResult.status === "rejected");
        });
        void readOwnStoreCart(storeId).then((result) => {
          if (requestID !== storeRequestID.current || cartRequestID !== cartReadRequestID.current) return;
          setOpenCart(result?.cart ?? null);
          setCartReadError(false);
        }).catch(() => {
          if (requestID === storeRequestID.current && cartRequestID === cartReadRequestID.current) setCartReadError(true);
        });
      }
      void orderabilityRequest.then((orderability) => {
        if (requestID === storeRequestID.current) setOrderabilityByMode(orderability);
      });
      void promotionRequest;
    } catch {
      if (requestID !== storeRequestID.current) return;
      setPromotionLoading(false);
      setState({ kind: "error" });
    }
  }, [categoryId, loadBanner, productId, selectedCityID, storeId]);

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
      setCatalogTabs((current) => ({ ...current, [favoriteOnly ? 1 : popularOnly ? 2 : 0]: { catalog, categoryID: favoriteOnly ? null : categoryID, query: favoriteOnly ? "" : query, productID: "" } }));
    } catch {
      if (requestID === catalogRequestID.current) setError("تعذر تحديث الكتالوج. يمكنك متابعة العناصر الحالية أو إعادة المحاولة.");
    } finally {
      if (requestID === catalogRequestID.current) setCatalogRefreshing(false);
    }
  }, [favoritesView, popularView, selectedCityID, storeId]);

  const selectCatalogTab = useCallback(async (index: number, fromSwipe = false) => {
    if (index < 0 || index > 2 || state.kind !== "ready") return;
    if (index === 1 && currentIdentityState().kind !== "authenticated") {
      catalogPagerRef.current?.scrollToIndex({ index: activeTab, animated: !reduceMotion });
      router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href);
      return;
    }
    if (!fromSwipe) catalogPagerRef.current?.scrollToIndex({ index, animated: !reduceMotion });
    if (index === activeTab) {
      if (index === 0 && selectedCategoryID) await reloadCatalog(null, "", false, false);
      return;
    }
    setCatalogTabs((current) => ({ ...current, [activeTab]: { catalog: state.catalog, categoryID: selectedCategoryID, query: catalogQuery, productID: activeProductID } }));
    catalogRequestID.current += 1;
    setLoadingMore(false);
    setCatalogSearchOpen(false);
    setFavoritesView(index === 1);
    setPopularView(index === 2);
    const saved = catalogTabs[index];
    setSelectedCategoryID(saved?.categoryID ?? null);
    setCatalogQuery(saved?.query ?? "");
    setActiveProductID(saved?.productID ?? "");
    setError("");
    if (saved) {
      setCatalogRefreshing(false);
      setState({ kind: "ready", store: state.store, catalog: saved.catalog });
      return;
    }
    setState({ kind: "ready", store: state.store, catalog: { ...state.catalog, offers: [], sections: [], nextCursor: null } });
    await reloadCatalog(null, "", index === 1, index === 2);
  }, [activeTab, activeProductID, catalogQuery, catalogTabs, reduceMotion, reloadCatalog, router, selectedCategoryID, state, storeId]);

  useEffect(() => {
    void load();
    return () => {
      storeRequestID.current += 1;
      catalogRequestID.current += 1;
      promotionRequestID.current += 1;
      bannerRequestID.current += 1;
      detailRequestID.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (pagerWidth > 0) catalogPagerRef.current?.scrollToIndex({ index: activeTab, animated: false });
  }, [pagerWidth]);

  useEffect(() => {
    if (fulfillmentModes.length === 1 && fulfillmentModes[0] && selectedFulfillmentMode === null) setSelectedFulfillmentMode(fulfillmentModes[0]);
  }, [fulfillmentModes, selectedFulfillmentMode]);

  useEffect(() => {
    if (bannerPaused || reduceMotion || bannerItems.length < 2) return;
    const timer = setInterval(() => {
      setBannerIndex((current) => {
        const next = (current + 1) % bannerItems.length;
        bannerRef.current?.scrollTo({ x: next * bannerStep, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [bannerItems.length, bannerPaused, reduceMotion, bannerStep]);

  useEffect(() => {
    if (bannerIndex >= bannerItems.length) setBannerIndex(0);
  }, [bannerIndex, bannerItems.length]);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduceMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);

  if (state.kind === "loading") {
    return <View style={styles.state} accessibilityLabel="جارٍ تجهيز المتجر"><BthwaniSkeleton width="30%" height={28} /><BthwaniSkeleton height={92} /><BthwaniSkeleton height={160} /><BthwaniSkeleton height={160} /></View>;
  }
  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر قراءة المتجر</Text><Text style={styles.muted}>قد لا يكون المتجر متاحًا في مدينة الخدمة الحالية.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /><BthwaniButton label="العودة" onPress={() => router.back()} variant="secondary" /></View>;
  }

  const hasCoverImage = Boolean(state.store.storeCoverImage?.uri && !failedStoreCover);
  const heroImageURI = hasCoverImage ? state.store.storeCoverImage?.uri : (!failedStoreImage ? state.store.storeProfileImage?.uri : undefined);
  const activeCatalogCategories = state.catalog.categories.filter((category) => category.active);
  const selectedCategory = activeCatalogCategories.find((category) => category.id === selectedCategoryID);
  const selectedCategoryTrail = selectedCategory ? categoryTrail(selectedCategory.id, activeCatalogCategories) : [];
  const categoryChildren = selectedCategory
    ? activeCatalogCategories.filter((category) => category.parentCategoryId === selectedCategory.id)
    : activeCatalogCategories.filter((category) => !category.parentCategoryId);
  const catalogRows = buildCatalogRows(state.catalog, favoritesView, popularView, selectedCategoryID, catalogQuery, catalogRefreshing);

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
      setCatalogTabs((current) => { const next = { ...current }; delete next[1]; return next; });
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

  async function openOfferDetails(offerID: string) {
    const offer = state.kind === "ready" ? state.catalog.offers.find((item) => item.offerId === offerID) ?? bannerOffers.find((item) => item.offerId === offerID) : undefined;
    if (!offer || !selectedCityID) return;
    const requestID = ++detailRequestID.current;
    setAddedOfferId("");
    setError("");
    setDetailOffer(offer);
    setDetailLoading(true);
    try {
      const catalog = await readPublicStoreCatalog(storeId, selectedCityID, "", "", 20, "", offer.productId);
      if (requestID !== detailRequestID.current) return;
      const fresh = catalog.offers.find((item) => item.offerId === offerID);
      if (!fresh) { setDetailOffer(null); setError("هذا المنتج لم يعد متاحًا في المتجر."); return; }
      setDetailOffer(fresh);
    } catch {
      if (requestID === detailRequestID.current) setError("تعذر تحديث تفاصيل المنتج. أغلق التفاصيل وأعد فتحها للمحاولة.");
    } finally {
      if (requestID === detailRequestID.current) setDetailLoading(false);
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
    const primaryMedia = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
    return (
      <View key={offer.offerId}>
      <BthwaniSurface tone="base" style={styles.item}>
        <View style={styles.productSummary}>
          <View style={styles.productImageFrame}>
            <Pressable accessibilityRole="button" accessibilityLabel={`عرض صور وتفاصيل ${offer.productName}`} onPress={() => openOfferDetails(offer.offerId)}>
              {primaryMedia && !failedProductImageIDs.has(offer.offerId)
                ? <Image accessibilityLabel={`صورة ${offer.productName}`} onError={() => setFailedProductImageIDs((current) => new Set(current).add(offer.offerId))} source={{ uri: primaryMedia.uri }} resizeMode="cover" style={styles.productImage} />
                : <View accessibilityLabel={`لا توجد صورة متاحة لـ ${offer.productName}`} style={styles.productImagePlaceholder}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /></View>}
            </Pressable>
            <BthwaniIconButton disabled={Boolean(favoriteOfferBusyID)} icon="favorite" label={favoriteOfferIDs.has(offer.offerId) ? `إزالة ${offer.productName} من المفضلة` : `إضافة ${offer.productName} إلى المفضلة`} onPress={() => void toggleOfferFavorite(offer.offerId)} size={sizing.controlMd} style={styles.productFavorite} tone={favoriteOfferIDs.has(offer.offerId) ? "primary" : "soft"} />
          </View>
          <View style={styles.productCopyAndAction}>
            <Pressable accessibilityRole="button" accessibilityLabel={`عرض تفاصيل ${offer.productName}`} accessibilityHint="يفتح صور المنتج وتفاصيله وخيارات الكمية" onPress={() => openOfferDetails(offer.offerId)} style={styles.itemCopy}>
              <Text numberOfLines={2} style={styles.itemTitle}>{offer.productName}</Text>
              <Text numberOfLines={1} style={styles.productUnit}>{offer.pricingBasis === "PER_MEASURE" ? `السعر لكل ${formatQuantity(offer.baseUnit, offer.pricingUnitBaseUnits)}` : offer.variantTitle || "للوحدة"}</Text>
            </Pressable>
            <View style={styles.productActionRow}>
              <Text style={styles.productActionPrice}>{storeMoney(offer.priceMinor, offer.currency)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`اختيار كمية وإضافة ${offer.productName} إلى السلة`} accessibilityState={{ disabled: mutationBusy || !selectedFulfillmentMode }} disabled={mutationBusy || !selectedFulfillmentMode} onPress={() => openOfferDetails(offer.offerId)} style={styles.addOfferButton}><BthwaniIcon name="cart" color={theme.onAction} size={sizing.iconSm} /><Text style={styles.addOfferPlus}>+</Text></Pressable>
            </View>
          </View>
        </View>
      </BthwaniSurface>
      </View>
    );
  };

  const detailQuantity = detailOffer ? Number(quantities[detailOffer.offerId] ?? detailOffer.quantityMinBaseUnits) : 0;
  const renderCategoryRail = () => (
          <ScrollView horizontal contentContainerStyle={styles.categoryRail} showsHorizontalScrollIndicator={false}>
            <Pressable accessibilityRole="button" accessibilityLabel="عرض كل منتجات المتجر" accessibilityState={{ selected: !favoritesView && !popularView && !selectedCategoryID, busy: catalogRefreshing }} onPress={() => void selectCatalogTab(0)} style={[styles.catalogFilterChip, !favoritesView && !popularView && !selectedCategoryID && styles.catalogFilterChipSelected]}><Text style={[styles.catalogFilterChipLabel, !favoritesView && !popularView && !selectedCategoryID && styles.catalogFilterChipLabelSelected]}>كل المنتجات</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="عرض المنتجات المفضلة" accessibilityState={{ selected: favoritesView, busy: catalogRefreshing }} onPress={() => void selectCatalogTab(1)} style={[styles.catalogFilterChip, favoritesView && styles.catalogFilterChipSelected]}><BthwaniIcon name="favorite" color={favoritesView ? theme.onAction : theme.interactiveText} size={sizing.iconSm} /><Text style={[styles.catalogFilterChipLabel, favoritesView && styles.catalogFilterChipLabelSelected]}>المفضلة</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="عرض المنتجات الأكثر رواجًا خلال آخر 30 يومًا" accessibilityState={{ selected: popularView, busy: catalogRefreshing }} onPress={() => void selectCatalogTab(2)} style={[styles.catalogFilterChip, popularView && styles.catalogFilterChipSelected]}><BthwaniIcon name="trending" color={popularView ? theme.onAction : theme.interactiveText} size={sizing.iconSm} /><Text style={[styles.catalogFilterChipLabel, popularView && styles.catalogFilterChipLabelSelected]}>الأكثر رواجًا</Text></Pressable>
            {!favoritesView && activeCatalogCategories.length > 0 ? <>
              {selectedCategoryTrail.map((category, index) => renderCategoryChip(category, index === selectedCategoryTrail.length - 1))}
              {categoryChildren.map((category) => renderCategoryChip(category, selectedCategoryID === category.id))}
            </> : null}
          </ScrollView>
  );

  return (
    <View style={styles.page} accessibilityLabel={`كتالوج ${state.store.name}`}>
      <StatusBar style={heroImageURI && heroVisible ? "light" : "dark"} />
      <View style={styles.catalogPager} onLayout={(event) => setPagerWidth(event.nativeEvent.layout.width)}>
      {pagerWidth > 0 ? <FlatList
        ref={catalogPagerRef}
        horizontal
        pagingEnabled
        // Native RTL positions horizontal list offsets differently; inversion keeps tab IDs and swipe destinations aligned.
        inverted={I18nManager.isRTL}
        data={[0, 1, 2]}
        keyExtractor={(index) => String(index)}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={3}
        removeClippedSubviews={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_data, index) => ({ length: pagerWidth, offset: pagerWidth * index, index })}
        onMomentumScrollEnd={(event) => void selectCatalogTab(Math.round(Math.abs(event.nativeEvent.contentOffset.x) / pagerWidth), true)}
        onScrollToIndexFailed={(info) => catalogPagerRef.current?.scrollToOffset({ offset: info.index * pagerWidth, animated: false })}
        renderItem={({ item: tabIndex }) => {
          const snapshot = catalogTabs[tabIndex];
          const pageRows: StoreCatalogRow[] = [{ kind: "filters", key: "catalog-filters" }, ...(tabIndex === activeTab ? catalogRows : snapshot ? buildCatalogRows(snapshot.catalog, tabIndex === 1, tabIndex === 2, snapshot.categoryID, snapshot.query) : [])];
          return <View style={{ width: pagerWidth, flex: 1 }}><FlatList
        stickyHeaderIndices={[1]}
        onScroll={(event) => { if (tabIndex === activeTab) { const visible = event.nativeEvent.contentOffset.y < 184 + insets.top - 32; setHeroVisible((current) => current === visible ? current : visible); } }}
        scrollEventThrottle={160}
        contentContainerStyle={styles.container}
        data={pageRows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          if (item.kind === "filters") return <View style={[styles.stickyCategories, { paddingTop: insets.top }]}>{renderCategoryRail()}</View>;
          if (item.kind === "offer") return renderOffer(item.offer);
          if (item.kind === "section") return <Text accessibilityRole="header" style={styles.sectionTitle}>{item.title}</Text>;
          if (item.kind === "heading") return <BthwaniSectionHeader title={item.title} subtitle={item.subtitle} />;
          return <BthwaniSurface tone="inset" style={styles.emptySection}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /><Text style={styles.sectionTitle}>{item.title}</Text></BthwaniSurface>;
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View style={styles.listHeader}>
      <View style={[styles.storeHero, { height: 184 + insets.top }]}>
          {heroImageURI
            ? <View pointerEvents="none" style={styles.storeHeroMedia}><Image accessibilityLabel={`${hasCoverImage ? "غلاف" : "صورة"} متجر ${state.store.name}`} onError={() => { if (hasCoverImage) setFailedStoreCover(true); else setFailedStoreImage(true); }} source={{ uri: heroImageURI }} resizeMode="cover" blurRadius={hasCoverImage ? 0 : 12} style={styles.storeCover} /></View>
            : <View accessibilityLabel={failedStoreCover ? `تعذر تحميل غلاف متجر ${state.store.name}` : `غلاف متجر ${state.store.name} غير متوفر`} pointerEvents="none" style={styles.storeCoverFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>}
        <View pointerEvents="none" style={styles.storeHeroShade} />
        <View style={[styles.storeHeroToolbar, { paddingTop: insets.top + spacing[2] }]}>
          {catalogSearchOpen ? <BthwaniSearchField
          accessibilityLabel="البحث في جميع منتجات المتجر"
          containerStyle={styles.headerSearchField}
          editable={!catalogRefreshing && !loadingMore}
          onChangeText={setCatalogQuery}
          onClear={() => { setCatalogQuery(""); void reloadCatalog(null, "", false, false); }}
          onSubmitEditing={() => void reloadCatalog(null, catalogQuery, false, false)}
          placeholder="ابحث في جميع منتجات المتجر"
          returnKeyType="search"
          value={catalogQuery}
        /> : null}
        <View style={styles.storeHeaderActions}>
          <BthwaniIconButton icon={catalogSearchOpen ? "close" : "search"} label={catalogSearchOpen ? "إغلاق البحث داخل المتجر" : "البحث في منتجات المتجر"} onPress={() => { if (catalogSearchOpen) { setCatalogSearchOpen(false); setCatalogQuery(""); void reloadCatalog(null, "", false, false); } else if (activeTab !== 0) { void selectCatalogTab(0).then(() => setCatalogSearchOpen(true)); } else { setCatalogSearchOpen(true); } }} size={sizing.controlMd} style={styles.storeHeaderAction} tone="soft" />
          {!catalogSearchOpen ? <><BthwaniIconButton icon="cart" label="سلة التسوق" onPress={() => router.push("/multi-store-checkout" as Href)} size={sizing.controlMd} style={styles.storeHeaderAction} tone="soft" />
          <BthwaniIconButton icon="share" label="مشاركة المتجر" onPress={() => void shareStore()} size={sizing.controlMd} style={styles.storeHeaderAction} tone="soft" />
          <BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlMd} style={styles.storeHeaderAction} tone="soft" /></> : null}
        </View>
        </View>
      </View>
      <BthwaniSurface tone="raised" style={styles.storeInfoCard} accessibilityLabel={'معلومات متجر ' + state.store.name}>
        <View style={styles.storeInfoIdentityRow}>
          {state.store.storeProfileImage?.uri && !failedStoreImage
            ? <Image accessibilityLabel={'شعار متجر ' + state.store.name} onError={() => setFailedStoreImage(true)} source={{ uri: state.store.storeProfileImage.uri }} resizeMode="contain" style={styles.storeInfoLogo} />
            : <View style={styles.storeInfoLogoFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>}
          <View style={styles.storeInfoIdentityCopy}>
            <Text numberOfLines={1} style={styles.storeInfoName}>{state.store.name}</Text>
            <Text numberOfLines={1} style={styles.storeInfoLocation}>{serviceCityDisplayName(state.store.serviceCity.displayNameAr)}</Text>
            {state.store.ratingCount > 0 ? <Text accessibilityLabel={'تقييم المتجر ' + state.store.ratingAverage.toFixed(1) + ' من 5، عدد التقييمات ' + state.store.ratingCount} style={styles.storeInfoRating}>★ {state.store.ratingAverage.toFixed(1)} <Text style={styles.storeInfoRatingCount}>({state.store.ratingCount})</Text></Text> : null}
          </View>
        </View>
        <View style={styles.storeInfoDivider} />
        <View style={styles.storeInfoStatusRow}>
          <View style={styles.storeInfoStat}>
            <Text style={styles.storeInfoStatLabel}>حالة المتجر</Text>
            <View style={styles.orderStatusBadge}><Text style={styles.orderStatusBadgeText}>{selectedFulfillmentMode ? orderabilityBadge(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode)) : 'جار التحقق'}</Text></View>
          </View>
          <View style={styles.storeInfoStat}>
            <Text style={styles.storeInfoStatLabel}>التجهيز والطلب</Text>
            <Text numberOfLines={2} style={styles.storeInfoStatValue}>{selectedFulfillmentMode ? orderabilityEta(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode)) : 'اختر طريقة الطلب'}</Text>
          </View>
        </View>
        {fulfillmentModes.length > 1 ? <View style={styles.storeInfoModes}>
          {fulfillmentModes.map((mode) => {
            const orderability = orderabilityByMode?.find((item) => item.fulfillmentMode === mode);
            return <Pressable key={mode} accessibilityRole="radio" accessibilityLabel={fulfillmentModeLabel(mode)} accessibilityHint={fulfillmentModeDescription(mode) + ' ' + orderabilityEta(orderability)} accessibilityState={{ checked: selectedFulfillmentMode === mode }} onPress={() => { setSelectedFulfillmentMode(mode); setError(''); }} style={[styles.storeInfoMode, selectedFulfillmentMode === mode && styles.storeInfoModeSelected]}>
              <Text numberOfLines={1} style={[styles.storeInfoModeText, selectedFulfillmentMode === mode && styles.storeInfoModeTextSelected]}>{fulfillmentModeLabel(mode)}</Text>
            </Pressable>;
          })}
        </View> : selectedFulfillmentMode ? <Text numberOfLines={1} style={styles.storeInfoSingleMode}>{fulfillmentModeLabel(selectedFulfillmentMode)}</Text> : null}
      </BthwaniSurface>

          {bannerItems.length ? <View style={styles.bannerBlock}>
            <View style={styles.bannerHeading}><Text style={styles.bannerHeadingText}>{promotions.length && bannerCatalogOffers.length ? "عروض ومنتجات المتجر" : promotions.length ? "عروض هذا المتجر" : bannerOffers.length ? "الأكثر طلبًا خلال آخر 30 يومًا" : "منتجات من هذا المتجر"}</Text><View style={styles.bannerHeadingActions}>{bannerItems.length > 1 ? <Text style={styles.bannerPause}>{bannerIndex + 1} من {bannerItems.length}</Text> : null}{bannerItems.length > 1 ? reduceMotion ? <Text accessibilityLabel="الحركة التلقائية متوقفة وفق إعدادات تقليل الحركة بالجهاز" style={styles.bannerPause}>الحركة متوقفة</Text> : <Pressable accessibilityRole="button" accessibilityLabel={bannerPaused ? "تشغيل حركة العروض والمنتجات" : "إيقاف حركة العروض والمنتجات"} onPress={() => setBannerPaused((paused) => !paused)}><Text style={styles.bannerPause}>{bannerPaused ? "تشغيل" : "إيقاف"}</Text></Pressable> : null}</View></View>
            <ScrollView ref={tabIndex === activeTab ? bannerRef : undefined} horizontal snapToInterval={bannerStep} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: bannerSidePadding, gap: spacing[2] }} onTouchStart={() => setBannerPaused(true)} onMomentumScrollEnd={(event) => setBannerIndex(Math.max(0, Math.min(bannerItems.length - 1, Math.round(Math.abs(event.nativeEvent.contentOffset.x) / bannerStep))))} showsHorizontalScrollIndicator={false}>
              {bannerItems.map((item) => item.kind === "offer" ? <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`${bannerOffers.length ? "عرض المنتج الرائج" : "عرض المنتج"} ${item.offer.productName}`} onPress={() => openOfferDetails(item.offer.offerId)} style={[styles.bannerCard, { width: bannerWidth }]}>
                {item.offer.media[0]?.uri ? <Image source={{ uri: item.offer.media[0].uri }} accessibilityLabel={`صورة ${item.offer.productName}`} resizeMode="cover" style={styles.bannerImage} /> : <View style={styles.bannerImageFallback}><BthwaniIcon name="trending" color={theme.interactiveText} size={sizing.iconMd} /></View>}
                <View style={styles.bannerCopy}><Text style={styles.bannerItemEyebrow}>{bannerOffers.length ? "الأكثر طلبًا" : "من منتجات المتجر"}</Text><Text numberOfLines={1} style={styles.bannerProduct}>{item.offer.productName}</Text><Text style={styles.bannerPrice}>{storeMoney(item.offer.priceMinor, item.offer.currency)}</Text></View>
              </Pressable> : <View key={item.key} accessibilityLabel={`عرض ${item.promotion.nameAr}: ${promotionBenefit(item.promotion)}`} style={[styles.bannerCard, { width: bannerWidth }]}>
                <View style={styles.bannerPromotionMark}><Text style={styles.bannerPromotionMarkText}>عرض</Text></View>
                <View style={styles.bannerCopy}><Text style={styles.bannerItemEyebrow}>من عروض المتجر</Text><Text numberOfLines={1} style={styles.bannerProduct}>{item.promotion.nameAr}</Text><Text numberOfLines={1} style={styles.bannerPrice}>{promotionBenefit(item.promotion)} · الرمز {item.promotion.code}</Text></View>
              </View>)}
            </ScrollView>
          </View> : null}
          {bannerError && bannerItems.length === 0 ? <Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل المنتجات الرائجة" onPress={() => void loadBanner()} style={styles.inlineRecovery}><Text style={styles.bannerPause}>تعذر تحميل المنتجات الرائجة · إعادة المحاولة</Text></Pressable> : null}

        </View>}
        ListFooterComponent={tabIndex === activeTab && (state.catalog.nextCursor || promotionError || (!promotionLoading && promotions.length > 0) || error || favoriteLoadError) ? <View style={styles.listFooter}>
          {state.catalog.nextCursor ? <BthwaniButton busy={loadingMore} disabled={catalogRefreshing} label="تحميل المزيد" onPress={() => void loadMore()} style={styles.loadMoreButton} variant="secondary" /> : null}
          {promotionError ? <View style={styles.promotionNotice}><Text accessibilityRole="alert" style={styles.validationError}>تعذر قراءة عروض هذا المتجر؛ يمكنك متابعة الطلب من دونها.</Text><BthwaniButton label="إعادة قراءة العروض" onPress={() => void retryPromotions()} variant="secondary" /></View> : null}
          {!promotionLoading && !promotionError && promotions.length > 0 ? <>
            <BthwaniSectionHeader title="عروض هذا المتجر" subtitle="تُطبّق الأكواد على الطلبات المؤهلة من هذا المتجر." />
            <View style={styles.promotionList}>{promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} />)}</View>
          </> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {favoriteLoadError ? <BthwaniSurface tone="inset" style={styles.favoriteNotice}><Text style={styles.muted}>تعذر تحديث حالة المفضلة من الخادم.</Text><BthwaniButton busy={favoriteLoading} label="إعادة المحاولة" onPress={() => void reloadFavorites()} variant="secondary" /></BthwaniSurface> : null}
        </View> : null}
        ListEmptyComponent={tabIndex !== activeTab || catalogRefreshing ? <View style={styles.pageLoading} accessibilityLabel="جارٍ تحميل منتجات التبويب"><BthwaniSkeleton height={112} /><BthwaniSkeleton height={112} /></View> : null}
      /></View>;
        }}
      /> : null}
      </View>
      <StoreProductSheet
        offer={detailOffer}
        quantityBaseUnits={detailQuantity}
        selectedOptionIds={detailOffer ? selectedModifierOptionIds[detailOffer.offerId] ?? [] : []}
        busy={mutationBusy || detailLoading}
        added={Boolean(detailOffer && addedOfferId === detailOffer.offerId)}
        fulfillmentSelected={Boolean(selectedFulfillmentMode)}
        error={error}
        onQuantityChange={(quantity) => { if (detailOffer) setQuantities((current) => ({ ...current, [detailOffer.offerId]: String(quantity) })); }}
        onToggleModifier={(groupID, optionID, maxSelections) => { if (detailOffer) toggleModifier(detailOffer, groupID, optionID, maxSelections); }}
        onAdd={() => { if (detailOffer) void add(detailOffer); }}
        onClose={() => { detailRequestID.current += 1; setDetailOffer(null); setDetailLoading(false); }}
        onGoToCart={() => { detailRequestID.current += 1; setDetailOffer(null); router.push(`/cart/${encodeURIComponent(storeId)}?fulfillmentMode=${encodeURIComponent(selectedFulfillmentMode ?? "")}` as Href); }}
      />
      {openCart?.lines.length || cartReadError ? <SafeAreaView edges={["bottom"]} style={styles.cartSafeArea}>
        <BthwaniSurface tone="raised" style={styles.cartCta}>
          <View style={styles.cartSummary}>
            <Text style={styles.cartTitle}>{cartReadError ? "تعذر تحديث السلة" : `سلتك · ${openCart?.lines.length ?? 0} ${openCart?.lines.length === 1 ? "منتج" : openCart?.lines.length === 2 ? "منتجان" : "منتجات"}`}</Text>
            <Text style={styles.cartValue}>{cartReadError ? "افتح السلة لإعادة قراءة محتوياتها" : openCart?.lines.some((line) => line.requiresReview) ? "تحتاج بعض الأسعار إلى مراجعة" : `قيمة المنتجات ${storeMoney(openCart?.lines.reduce((sum, line) => sum + line.lineAmountMinor, 0) ?? 0, "YER")}`}</Text>
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

function storeMoney(amountMinor: number, currency: string): string {
  return (currency === "YER" ? formatMoney(amountMinor, "YER") : `${amountMinor} ${currency}`).replace(/ريال يمني/g, "ريال");
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
  if (orderability.state === "CLOSED_BY_SCHEDULE") return orderability.preparationMinutes ? `خارج ساعات العمل الآن · مدة التجهيز ${orderability.preparationMinutes} دقيقة عند استقبال الطلبات` : "خارج ساعات العمل الآن";
  if (orderability.state === "PAUSED") return "متوقف مؤقتًا";
  if (orderability.state !== "OPEN_FOR_ORDERS") return "طريقة الطلب غير متاحة حاليًا";
  if (orderability.preparationMinutes) return `مدة التجهيز ${orderability.preparationMinutes} دقيقة`;
  return "تُراجع أهلية الطلب مرة أخرى عند التأكيد.";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    page: { backgroundColor: theme.background, flex: 1 },
    catalogPager: { flex: 1 },
    pageLoading: { gap: spacing[3] },
    container: { backgroundColor: theme.background, gap: spacing[3], paddingBottom: spacing[4], paddingHorizontal: spacing[3], width: "100%" },
    listHeader: { gap: spacing[3] },
    stickyCategories: { backgroundColor: theme.background, zIndex: 3 },
    listFooter: { gap: spacing[3] },
    storeCover: { height: "100%", width: "100%" },
    storeCoverFallback: { alignItems: "center", backgroundColor: theme.surfaceInset, height: "100%", justifyContent: "center", width: "100%" },
    bannerBlock: { gap: spacing[1] },
    bannerHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    bannerHeadingActions: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    bannerHeadingText: { ...typography.caption, color: theme.colorMuted },
    bannerPause: { ...typography.caption, color: theme.interactiveText, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    bannerCard: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], minHeight: 76, padding: spacing[2] },
    bannerImage: { borderRadius: radius.md, height: 58, width: 70 },
    bannerImageFallback: { alignItems: "center", backgroundColor: theme.surface, borderRadius: radius.md, height: 58, justifyContent: "center", width: 70 },
    bannerPromotionMark: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, height: 58, justifyContent: "center", width: 70 },
    bannerPromotionMarkText: { ...typography.bodyStrong, color: theme.onAction },
    bannerCopy: { alignItems: "flex-end", flex: 1, gap: spacing[1] },
    bannerItemEyebrow: { ...typography.caption, color: theme.colorMuted },
    bannerProduct: { ...typography.bodyStrong, color: theme.color },
    bannerPrice: { ...typography.caption, color: theme.interactiveText },
    state: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8], width: "100%" },
    title: { ...typography.titleSm, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted, lineHeight: 20 },
    storeHero: { height: 184, marginHorizontal: -spacing[3], position: "relative", backgroundColor: theme.surfaceInset, overflow: "hidden" },
    storeHeroMedia: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
    storeHeroShade: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.26)" },
    storeHeroToolbar: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "flex-end", paddingHorizontal: spacing[3], zIndex: 2 },
    storeInfoCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[2], marginTop: -56, padding: spacing[3], zIndex: 2, ...elevation.raised },
    storeInfoIdentityRow: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
    storeInfoLogo: { backgroundColor: theme.surface, borderRadius: radius.lg, height: 60, width: 60 },
    storeInfoLogoFallback: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, height: 60, justifyContent: "center", width: 60 },
    storeInfoIdentityCopy: { alignItems: "flex-start", flex: 1, gap: spacing[1], minWidth: 0 },
    storeInfoName: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    storeInfoLocation: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    storeInfoRating: { ...typography.bodySm, color: theme.color, textAlign: "right" },
    storeInfoRatingCount: { ...typography.caption, color: theme.colorMuted },
    storeInfoDivider: { backgroundColor: theme.borderColor, height: borders.hairline, width: "100%" },
    storeInfoStatusRow: { flexDirection: "row", gap: spacing[3] },
    storeInfoStat: { alignItems: "flex-start", flex: 1, gap: spacing[1], minWidth: 0 },
    storeInfoStatLabel: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    storeInfoStatValue: { ...typography.bodySm, color: theme.color, textAlign: "right" },
    storeInfoModes: { flexDirection: "row", gap: spacing[1] },
    storeInfoMode: { alignItems: "center", backgroundColor: theme.surfaceInset, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, flex: 1, justifyContent: "center", minHeight: sizing.controlMd, minWidth: 0, paddingHorizontal: spacing[1] },
    storeInfoModeSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    storeInfoModeText: { ...typography.caption, color: theme.color, textAlign: "center" },
    storeInfoModeTextSelected: { color: theme.interactiveText },
    storeInfoSingleMode: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    storeHeaderActions: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    storeHeaderAction: { backgroundColor: "rgba(255,255,255,0.88)", borderColor: "transparent" },
    orderStatusBadge: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, justifyContent: "center", minHeight: sizing.controlMd, minWidth: sizing.controlMd, paddingHorizontal: spacing[3] },
    orderStatusBadgeText: { ...typography.bodyStrong, color: theme.interactiveText },
    inlineRecovery: { alignItems: "flex-end", paddingVertical: spacing[1] },
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
    headerSearchField: { flex: 1, minWidth: 0 },
    sectionTitle: { ...typography.bodyStrong, backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, color: theme.color, minHeight: 72, paddingHorizontal: spacing[4], paddingVertical: spacing[4], textAlign: "right", textAlignVertical: "center" },
    item: { borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[2], ...elevation.raised },
    productSummary: { alignItems: "stretch", flexDirection: "row", gap: spacing[3] },
    productImageFrame: { borderRadius: radius.lg, height: 112, overflow: "hidden", position: "relative", width: "34%" },
    productImage: { backgroundColor: theme.surface, height: 112, width: "100%" },
    productImagePlaceholder: { alignItems: "center", backgroundColor: theme.surfaceInset, height: 112, justifyContent: "center", width: "100%" },
    productFavorite: { position: "absolute", right: spacing[1], top: spacing[1] },
    productCopyAndAction: { flex: 1, gap: spacing[1], justifyContent: "space-between", minWidth: 0, paddingVertical: spacing[1] },
    itemCopy: { alignItems: "flex-start", flex: 1, justifyContent: "center", minHeight: sizing.controlMd },
    itemTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    productUnit: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
    productActionRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "space-between", width: "100%" },
    productActionPrice: { ...typography.bodyStrong, color: theme.interactiveText },
    addOfferButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, flexDirection: "row", gap: spacing[1], justifyContent: "center", minHeight: sizing.controlMd, minWidth: sizing.controlMd, paddingHorizontal: spacing[2] },
    addOfferPlus: { ...typography.bodyStrong, color: theme.onAction },
    emptySection: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[4] },
    cartSafeArea: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingHorizontal: spacing[4], paddingTop: spacing[2] },
    cartCta: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    cartSummary: { flex: 1, gap: spacing[1] },
    cartTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    cartValue: { ...typography.caption, color: theme.colorMuted, textAlign: "right" },
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
  const localized = (value: number) => new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 3 }).format(value);
  if (baseUnit === "GRAM") return quantity >= 1000 ? `${localized(quantity / 1000)} كجم` : `${localized(quantity)} غ`;
  if (baseUnit === "MILLILITER") return quantity >= 1000 ? `${localized(quantity / 1000)} لتر` : `${localized(quantity)} مل`;
  return `${localized(quantity)} حبة`;
}

function promotionBenefit(promotion: PublicPromotionView): string {
  return promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم ${storeMoney(promotion.valueMinor, "YER")}`;
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

function buildCatalogRows(catalog: PublicCatalogResponse, favoritesView: boolean, popularView: boolean, categoryID: string | null, query: string, refreshing = false): StoreCatalogRow[] {
  const activeSections = catalog.sections.filter((section) => section.active);
  const sectionOfferIds = new Set(activeSections.flatMap((section) => section.offerIds));
  const emptyOfferMessage = favoritesView
    ? "لم تحفظ منتجات من هذا المتجر بعد"
    : popularView
      ? query.trim()
        ? "لا توجد منتجات مطابقة"
        : categoryID
          ? "لا توجد منتجات رائجة في هذا التصنيف خلال آخر 30 يومًا"
          : "لا توجد منتجات مطلوبة خلال آخر 30 يومًا"
      : "لا توجد منتجات متاحة حاليًا";
  const catalogRows: StoreCatalogRow[] = [];
  const seenOfferIDs = new Set<string>();
  if (favoritesView) catalogRows.push({ kind: "heading", key: "favorite-offers-heading", title: "المنتجات المفضلة", subtitle: `${catalog.offers.length} منتج معروض${refreshing ? " · جارٍ التحديث…" : ""}` });
  if (catalog.offers.length === 0) catalogRows.push({ kind: "empty", key: "catalog-empty", title: emptyOfferMessage });
  const appendOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    if (seenOfferIDs.has(offer.offerId)) return;
    seenOfferIDs.add(offer.offerId);
    catalogRows.push({ kind: "offer", key: `offer:${offer.offerId}`, offer });
  };
  if (catalog.offers.length > 0 && !favoritesView && !popularView) {
    for (const section of activeSections) {
      const sectionOffers = section.offerIds
        .map((offerID) => catalog.offers.find((offer) => offer.offerId === offerID))
        .filter((offer): offer is PublicCatalogResponse["offers"][number] => offer !== undefined && !seenOfferIDs.has(offer.offerId));
      if (sectionOffers.length === 0) continue;
      catalogRows.push({ kind: "section", key: `section:${section.id}`, title: section.nameAr });
      sectionOffers.forEach(appendOffer);
    }
    catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)).forEach(appendOffer);
  } else if (catalog.offers.length > 0) {
    catalog.offers.forEach(appendOffer);
  }

  return catalogRows;
}
