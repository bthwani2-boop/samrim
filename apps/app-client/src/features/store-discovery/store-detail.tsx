import { borders, elevation, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type CartResponse, type CustomerFulfillmentMode, formatMoney, fulfillmentModeLabel, type PublicCatalogResponse, type PublicPromotionView, type PublicStoreView, type StoreOrderability } from "@bthwani/dsh";
import * as ExpoLinking from "expo-linking";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Image, Modal, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { currentIdentityState } from "../../bootstrap/identity";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { PromotionCard } from "./promotion-card";
import { addCatalogOfferToCart, listFavoriteStoreIDs, listFavoriteStoreOfferIDs, listPublicPromotions, readFavoriteStoreCatalog, readOwnStoreCart, readPublicStoreCatalog, readPublicStoreOrderability, readPublishedStore, setFavoriteStore, setFavoriteStoreOffer } from "./store-discovery-client";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "error" };

type StoreCatalogRow =
  | { kind: "section"; key: string; title: string }
  | { kind: "heading"; key: string; title: string; subtitle: string }
  | { kind: "empty"; key: string; title: string }
  | { kind: "offer"; key: string; offer: PublicCatalogResponse["offers"][number] };

type StoreBannerItem =
  | { kind: "offer"; key: string; offer: PublicCatalogResponse["offers"][number] }
  | { kind: "promotion"; key: string; promotion: PublicPromotionView };

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
  const [detailOfferID, setDetailOfferID] = useState("");
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
  const [failedStoreCover, setFailedStoreCover] = useState(false);
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
  const [selectedFulfillmentMode, setSelectedFulfillmentMode] = useState<CustomerFulfillmentMode | null>(null);
  const [orderabilityByMode, setOrderabilityByMode] = useState<ReadonlyArray<StoreOrderability> | null>(null);
  const [openCart, setOpenCart] = useState<CartResponse["cart"] | null>(null);
  const [cartReadError, setCartReadError] = useState(false);
  const fulfillmentModes = useMemo(() => state.kind === "ready" ? availableCustomerFulfillmentModes(state.store.fulfillmentModes) : [], [state]);
  const mutationBusy = Boolean(busyOfferId);
  const detailOffer = state.kind === "ready" ? state.catalog.offers.find((offer) => offer.offerId === detailOfferID) : undefined;
  const bannerItems: StoreBannerItem[] = [
    ...promotions.map((promotion) => ({ kind: "promotion" as const, key: `promotion:${promotion.id}`, promotion })),
    ...bannerOffers.map((offer) => ({ kind: "offer" as const, key: `offer:${offer.offerId}`, offer })),
  ].slice(0, 5);
  const bannerWidth = Math.max(280, windowWidth - spacing[3] * 2);

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
    setBannerOffers([]);
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
      void readPublicStoreCatalog(storeId, selectedCityID, "", "", 5, "", "", "MOST_ORDERED_30_DAYS").then((result) => {
        if (requestID === catalogRequestID.current) setBannerOffers(result.offers.slice(0, 5));
      }).catch(() => { if (requestID === catalogRequestID.current) setBannerOffers([]); });
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

  const selectCatalogTab = useCallback(async (index: number) => {
    if (catalogRefreshing || loadingMore) return;
    if (index === 1) {
      if (currentIdentityState().kind !== "authenticated") { router.replace(`/?returnTo=/store/${encodeURIComponent(storeId)}` as Href); return; }
      setCatalogSearchOpen(false);
      await reloadCatalog(null, "", true, false);
      return;
    }
    setCatalogSearchOpen(false);
    await reloadCatalog(null, "", false, index === 2);
  }, [catalogRefreshing, loadingMore, reloadCatalog, router, storeId]);

  const productPager = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 32 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 52) return;
      const currentTab = favoritesView ? 1 : popularView ? 2 : 0;
      void selectCatalogTab(Math.max(0, Math.min(2, currentTab + (gesture.dx < 0 ? 1 : -1))));
    },
  }), [favoritesView, popularView, selectCatalogTab]);

  const dismissProductSheet = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.25,
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy > 72) setDetailOfferID(""); },
  }), []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (fulfillmentModes.length === 1 && fulfillmentModes[0] && selectedFulfillmentMode === null) setSelectedFulfillmentMode(fulfillmentModes[0]);
  }, [fulfillmentModes, selectedFulfillmentMode]);

  useEffect(() => {
    if (bannerPaused || reduceMotion || bannerItems.length < 2) return;
    const timer = setInterval(() => {
      setBannerIndex((current) => {
        const next = (current + 1) % bannerItems.length;
        bannerRef.current?.scrollTo({ x: next * bannerWidth, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [bannerItems.length, bannerPaused, reduceMotion, bannerWidth]);

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

  const activeCatalogCategories = state.catalog.categories.filter((category) => category.active);
  const selectedCategory = activeCatalogCategories.find((category) => category.id === selectedCategoryID);
  const selectedCategoryTrail = selectedCategory ? categoryTrail(selectedCategory.id, activeCatalogCategories) : [];
  const categoryChildren = selectedCategory
    ? activeCatalogCategories.filter((category) => category.parentCategoryId === selectedCategory.id)
    : activeCatalogCategories.filter((category) => !category.parentCategoryId);
  const activeSections = state.catalog.sections.filter((section) => section.active);
  const sectionOfferIds = new Set(activeSections.flatMap((section) => section.offerIds));
  const emptyOfferMessage = favoritesView
    ? "لم تحفظ منتجات من هذا المتجر بعد"
    : popularView
      ? catalogQuery.trim()
        ? "لا توجد منتجات مطابقة"
        : selectedCategoryID
          ? "لا توجد منتجات رائجة في هذا التصنيف خلال آخر 30 يومًا"
          : "لا توجد منتجات مطلوبة خلال آخر 30 يومًا"
      : "لا توجد منتجات متاحة حاليًا";
  const catalogRows: StoreCatalogRow[] = [];
  const seenOfferIDs = new Set<string>();
  if (favoritesView) catalogRows.push({ kind: "heading", key: "favorite-offers-heading", title: "المنتجات المفضلة", subtitle: `${state.catalog.offers.length} منتج معروض${catalogRefreshing ? " · جارٍ التحديث…" : ""}` });
  if (state.catalog.offers.length === 0) catalogRows.push({ kind: "empty", key: "catalog-empty", title: emptyOfferMessage });
  const appendOffer = (offer: PublicCatalogResponse["offers"][number]) => {
    if (seenOfferIDs.has(offer.offerId)) return;
    seenOfferIDs.add(offer.offerId);
    catalogRows.push({ kind: "offer", key: `offer:${offer.offerId}`, offer });
  };
  if (state.catalog.offers.length > 0 && !favoritesView && !popularView) {
    for (const section of activeSections) {
      const sectionOffers = section.offerIds
        .map((offerID) => state.catalog.offers.find((offer) => offer.offerId === offerID))
        .filter((offer): offer is PublicCatalogResponse["offers"][number] => offer !== undefined && !seenOfferIDs.has(offer.offerId));
      if (sectionOffers.length === 0) continue;
      catalogRows.push({ kind: "section", key: `section:${section.id}`, title: section.nameAr });
      sectionOffers.forEach(appendOffer);
    }
    state.catalog.offers.filter((offer) => !sectionOfferIds.has(offer.offerId)).forEach(appendOffer);
  } else if (state.catalog.offers.length > 0) {
    state.catalog.offers.forEach(appendOffer);
  }

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

  function openOfferDetails(offerID: string) {
    setAddedOfferId("");
    setError("");
    setDetailOfferID(offerID);
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
      <View key={offer.offerId} accessibilityHint="اسحب يمينًا أو يسارًا للتنقل بين تبويبات منتجات المتجر" {...productPager.panHandlers}>
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
              <Text numberOfLines={1} style={styles.itemTitle}>{offer.productName}</Text>
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
  const canIncreaseDetailQuantity = Boolean(detailOffer && !mutationBusy && detailQuantity + detailOffer.quantityStepBaseUnits <= detailOffer.quantityMaxBaseUnits);
  const canDecreaseDetailQuantity = Boolean(detailOffer && !mutationBusy && detailQuantity - detailOffer.quantityStepBaseUnits >= detailOffer.quantityMinBaseUnits);

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
      <FlatList
        contentContainerStyle={styles.container}
        data={catalogRows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          if (item.kind === "offer") return renderOffer(item.offer);
          if (item.kind === "section") return <Text accessibilityRole="header" style={styles.sectionTitle}>{item.title}</Text>;
          if (item.kind === "heading") return <BthwaniSectionHeader title={item.title} subtitle={item.subtitle} />;
          return <BthwaniSurface tone="inset" style={styles.emptySection}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconLg} /><Text style={styles.sectionTitle}>{item.title}</Text></BthwaniSurface>;
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<View style={styles.listHeader}>
          {state.store.storeCoverImage?.uri && !failedStoreCover
            ? <Image accessibilityLabel={`غلاف متجر ${state.store.name}`} onError={() => setFailedStoreCover(true)} source={{ uri: state.store.storeCoverImage.uri }} resizeMode="cover" style={styles.storeCover} />
            : <View accessibilityLabel={failedStoreCover ? `تعذر تحميل غلاف متجر ${state.store.name}` : `غلاف متجر ${state.store.name} غير متوفر`} style={styles.storeCoverFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /><View style={styles.storeCoverFallbackCopy}><Text style={styles.storeCoverFallbackTitle}>{state.store.name}</Text><Text style={styles.storeCoverFallbackText}>{failedStoreCover ? "تعذر تحميل صورة الغلاف" : "صورة الغلاف غير متاحة حاليًا"}</Text></View></View>}
          <BthwaniSurface tone="raised" style={styles.orderStatus} accessibilityLabel="حالة المتجر وطرق الطلب">
            <View style={styles.orderStatusTop}>
              <View style={styles.orderStatusCopy}>
                <Text numberOfLines={2} style={styles.orderStatusMeta}>{selectedFulfillmentMode ? `${fulfillmentModeLabel(selectedFulfillmentMode)} · ${orderabilityEta(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode))}` : "اختر طريقة الطلب"}</Text>
              </View>
              <View style={styles.orderStatusBadge}><Text style={styles.orderStatusBadgeText}>{selectedFulfillmentMode ? orderabilityBadge(orderabilityByMode?.find((item) => item.fulfillmentMode === selectedFulfillmentMode)) : "الطلب"}</Text></View>
            </View>
            {fulfillmentModes.length > 1 ? <View style={styles.modeOptions}>{fulfillmentModes.map((mode) => {
              const orderability = orderabilityByMode?.find((item) => item.fulfillmentMode === mode);
              const modeEta = orderability?.preparationMinutes ? orderability.state === "CLOSED_BY_SCHEDULE" ? ` · تجهيز ${orderability.preparationMinutes} د بعد الفتح` : ` · تجهيز ${orderability.preparationMinutes} د` : "";
              return <BthwaniChip key={mode} accessibilityHint={`${fulfillmentModeDescription(mode)} ${orderabilityBadge(orderability)}، ${orderabilityEta(orderability)}`} label={`${fulfillmentModeLabel(mode)} · ${orderabilityBadge(orderability)}${modeEta}`} onPress={() => { setSelectedFulfillmentMode(mode); setError(""); }} selected={selectedFulfillmentMode === mode} />;
            })}</View> : null}
          </BthwaniSurface>
          {bannerItems.length ? <View style={styles.bannerBlock}>
            <View style={styles.bannerHeading}><Text style={styles.bannerHeadingText}>{promotions.length && bannerOffers.length ? "عروض ومنتجات رائجة" : promotions.length ? "عروض هذا المتجر" : "الأكثر طلبًا خلال آخر 30 يومًا"}</Text><View style={styles.bannerHeadingActions}>{bannerItems.length > 1 ? <Text style={styles.bannerPause}>{bannerIndex + 1} من {bannerItems.length}</Text> : null}{bannerItems.length > 1 ? reduceMotion ? <Text accessibilityLabel="الحركة التلقائية متوقفة وفق إعدادات تقليل الحركة بالجهاز" style={styles.bannerPause}>الحركة متوقفة</Text> : <Pressable accessibilityRole="button" accessibilityLabel={bannerPaused ? "تشغيل حركة العروض والمنتجات" : "إيقاف حركة العروض والمنتجات"} onPress={() => setBannerPaused((paused) => !paused)}><Text style={styles.bannerPause}>{bannerPaused ? "تشغيل" : "إيقاف"}</Text></Pressable> : null}</View></View>
            <ScrollView ref={bannerRef} horizontal pagingEnabled onTouchStart={() => setBannerPaused(true)} onMomentumScrollEnd={(event) => setBannerIndex(Math.round(event.nativeEvent.contentOffset.x / bannerWidth))} showsHorizontalScrollIndicator={false}>
              {bannerItems.map((item) => item.kind === "offer" ? <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`عرض المنتج الرائج ${item.offer.productName}`} onPress={() => openOfferDetails(item.offer.offerId)} style={[styles.bannerCard, { width: bannerWidth }]}>
                {item.offer.media[0]?.uri ? <Image source={{ uri: item.offer.media[0].uri }} accessibilityLabel={`صورة ${item.offer.productName}`} resizeMode="cover" style={styles.bannerImage} /> : <View style={styles.bannerImageFallback}><BthwaniIcon name="trending" color={theme.interactiveText} size={sizing.iconMd} /></View>}
                <View style={styles.bannerCopy}><Text style={styles.bannerItemEyebrow}>الأكثر طلبًا</Text><Text numberOfLines={1} style={styles.bannerProduct}>{item.offer.productName}</Text><Text style={styles.bannerPrice}>{storeMoney(item.offer.priceMinor, item.offer.currency)}</Text></View>
              </Pressable> : <View key={item.key} accessibilityLabel={`عرض ${item.promotion.nameAr}: ${promotionBenefit(item.promotion)}`} style={[styles.bannerCard, { width: bannerWidth }]}>
                <View style={styles.bannerPromotionMark}><Text style={styles.bannerPromotionMarkText}>عرض</Text></View>
                <View style={styles.bannerCopy}><Text style={styles.bannerItemEyebrow}>من عروض المتجر</Text><Text numberOfLines={1} style={styles.bannerProduct}>{item.promotion.nameAr}</Text><Text numberOfLines={1} style={styles.bannerPrice}>{promotionBenefit(item.promotion)} · الرمز {item.promotion.code}</Text></View>
              </View>)}
            </ScrollView>
          </View> : null}
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
        </View>}
        ListFooterComponent={state.catalog.nextCursor || promotionError || (!promotionLoading && promotions.length > 0) || error || favoriteLoadError ? <View style={styles.listFooter}>
          {state.catalog.nextCursor ? <BthwaniButton busy={loadingMore} disabled={catalogRefreshing} label="تحميل المزيد" onPress={() => void loadMore()} style={styles.loadMoreButton} variant="secondary" /> : null}
          {promotionError ? <View style={styles.promotionNotice}><Text accessibilityRole="alert" style={styles.validationError}>تعذر قراءة عروض هذا المتجر؛ يمكنك متابعة الطلب من دونها.</Text><BthwaniButton label="إعادة قراءة العروض" onPress={() => void retryPromotions()} variant="secondary" /></View> : null}
          {!promotionLoading && !promotionError && promotions.length > 0 ? <>
            <BthwaniSectionHeader title="عروض هذا المتجر" subtitle="تُطبّق الأكواد على الطلبات المؤهلة من هذا المتجر." />
            <View style={styles.promotionList}>{promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} />)}</View>
          </> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {favoriteLoadError ? <BthwaniSurface tone="inset" style={styles.favoriteNotice}><Text style={styles.muted}>تعذر تحديث حالة المفضلة من الخادم.</Text><BthwaniButton busy={favoriteLoading} label="إعادة المحاولة" onPress={() => void reloadFavorites()} variant="secondary" /></BthwaniSurface> : null}
        </View> : null}
      />
      <Modal animationType="slide" onRequestClose={() => setDetailOfferID("")} transparent visible={Boolean(detailOffer)}>
        <View style={styles.sheetBackdrop}>
          <BthwaniSurface accessibilityViewIsModal style={styles.productSheet} tone="raised">
            <View {...dismissProductSheet.panHandlers} accessibilityLabel="اسحب للأسفل لإغلاق تفاصيل المنتج" style={styles.sheetDragTarget}><View style={styles.sheetDragHandle} /></View>
            <View style={styles.sheetHeading}><Text accessibilityRole="header" style={styles.sheetTitle}>{detailOffer?.productName}</Text><BthwaniIconButton icon="close" label="إغلاق تفاصيل المنتج" onPress={() => setDetailOfferID("")} size={sizing.controlMd} tone="soft" /></View>
            {detailOffer ? <>
              <ScrollView horizontal contentContainerStyle={styles.productGallery} showsHorizontalScrollIndicator={false}>
                {detailOffer.media.length && !failedProductImageIDs.has(detailOffer.offerId) ? detailOffer.media.map((media) => <Image key={media.uri} accessibilityLabel={`صورة ${detailOffer.productName}`} onError={() => setFailedProductImageIDs((current) => new Set(current).add(detailOffer.offerId))} source={{ uri: media.uri }} resizeMode="cover" style={styles.productGalleryImage} />) : <View accessibilityLabel={`لا توجد صور متاحة لـ ${detailOffer.productName}`} style={styles.productGalleryFallback}><BthwaniIcon name="store" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.muted}>لا توجد صور متاحة لهذا المنتج</Text></View>}
              </ScrollView>
              <ScrollView contentContainerStyle={styles.productSheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                <Text style={styles.productActionPrice}>{storeMoney(detailOffer.priceMinor, detailOffer.currency)}</Text>
                {detailOffer.productDescription ? <Text style={styles.muted}>{detailOffer.productDescription}</Text> : null}
                <Text style={styles.quantityHint}>الكمية: {formatQuantity(detailOffer.baseUnit, detailOffer.quantityMinBaseUnits)}–{formatQuantity(detailOffer.baseUnit, detailOffer.quantityMaxBaseUnits)} · الخطوة {formatQuantity(detailOffer.baseUnit, detailOffer.quantityStepBaseUnits)}</Text>
                <View style={styles.quantityRow}><Text style={styles.filterLabel}>الكمية</Text><View style={styles.quantityStepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel="زيادة الكمية" accessibilityState={{ disabled: !canIncreaseDetailQuantity }} disabled={!canIncreaseDetailQuantity} onPress={() => setQuantities((current) => ({ ...current, [detailOffer.offerId]: String(Number(current[detailOffer.offerId] ?? detailOffer.quantityMinBaseUnits) + detailOffer.quantityStepBaseUnits) }))} style={[styles.quantityAction, !canIncreaseDetailQuantity && styles.quantityActionDisabled]}><Text style={[styles.quantityActionText, !canIncreaseDetailQuantity && styles.quantityActionTextDisabled]}>+</Text></Pressable>
                  <Text accessibilityLabel={`كمية ${detailOffer.productName}`} style={styles.quantityValue}>{formatQuantity(detailOffer.baseUnit, detailQuantity)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="تقليل الكمية" accessibilityState={{ disabled: !canDecreaseDetailQuantity }} disabled={!canDecreaseDetailQuantity} onPress={() => setQuantities((current) => ({ ...current, [detailOffer.offerId]: String(Number(current[detailOffer.offerId] ?? detailOffer.quantityMinBaseUnits) - detailOffer.quantityStepBaseUnits) }))} style={[styles.quantityAction, !canDecreaseDetailQuantity && styles.quantityActionDisabled]}><Text style={[styles.quantityActionText, !canDecreaseDetailQuantity && styles.quantityActionTextDisabled]}>−</Text></Pressable>
                </View></View>
                {!isQuantityAllowed(detailOffer, Number(quantities[detailOffer.offerId] ?? detailOffer.quantityMinBaseUnits)) ? <Text accessibilityRole="alert" style={styles.validationError}>الكمية لا تطابق الحد أو الخطوة المحددة للمنتج.</Text> : null}
                {detailOffer.modifierGroups.map((group) => <View key={group.id} style={styles.modifierGroup}><Text style={styles.filterLabel}>{group.nameAr}{group.required ? " · مطلوب" : ""}</Text><View style={styles.modifierOptions}>{group.options.filter((option) => option.availability).map((option) => <BthwaniChip key={option.id} label={`${option.nameAr}${option.priceDeltaMinor ? ` · +${storeMoney(option.priceDeltaMinor, detailOffer.currency)}` : ""}`} onPress={() => toggleModifier(detailOffer, group.id, option.id, group.maxSelections)} selected={(selectedModifierOptionIds[detailOffer.offerId] ?? []).includes(option.id)} />)}</View></View>)}
                {validateModifierSelection(detailOffer, selectedModifierOptionIds[detailOffer.offerId] ?? []) ? <Text accessibilityRole="alert" style={styles.validationError}>{validateModifierSelection(detailOffer, selectedModifierOptionIds[detailOffer.offerId] ?? [])}</Text> : null}
              </ScrollView>
              {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
              {addedOfferId === detailOffer.offerId ? <View style={styles.sheetActions}><BthwaniButton label="متابعة التسوق" onPress={() => setDetailOfferID("")} variant="secondary" /><BthwaniButton label="الانتقال للسلة" onPress={() => { setDetailOfferID(""); router.push(`/cart/${encodeURIComponent(storeId)}?fulfillmentMode=${encodeURIComponent(selectedFulfillmentMode ?? "")}` as Href); }} /></View> : <BthwaniButton accessibilityLabel={`إضافة ${detailOffer.productName} إلى السلة`} busy={busyOfferId === detailOffer.offerId} disabled={mutationBusy || !selectedFulfillmentMode || !isQuantityAllowed(detailOffer, Number(quantities[detailOffer.offerId] ?? detailOffer.quantityMinBaseUnits)) || Boolean(validateModifierSelection(detailOffer, selectedModifierOptionIds[detailOffer.offerId] ?? []))} label="إضافة إلى السلة" onPress={() => void add(detailOffer)} />}
            </> : null}
          </BthwaniSurface>
        </View>
      </Modal>
      {openCart?.lines.length || cartReadError ? <SafeAreaView edges={["bottom"]} style={styles.cartSafeArea}>
        <BthwaniSurface tone="raised" style={styles.cartCta}>
          <View style={styles.cartSummary}>
            <Text style={styles.cartTitle}>{cartReadError ? "تعذر تحديث السلة" : `سلتك · ${openCart?.lines.length ?? 0} منتجات`}</Text>
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
    container: { backgroundColor: theme.background, gap: spacing[3], paddingBottom: spacing[4], paddingHorizontal: spacing[3], width: "100%" },
    listHeader: { gap: spacing[3] },
    listFooter: { gap: spacing[3] },
    storeCover: { borderRadius: radius.lg, height: 132, width: "100%" },
    storeCoverFallback: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], height: 132, justifyContent: "flex-end", paddingHorizontal: spacing[4], width: "100%" },
    storeCoverFallbackCopy: { alignItems: "flex-end", flex: 1, gap: spacing[1] },
    storeCoverFallbackTitle: { ...typography.titleSm, color: theme.color },
    storeCoverFallbackText: { ...typography.caption, color: theme.colorMuted },
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
    sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.42)", flex: 1, justifyContent: "flex-end" },
    productSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, gap: spacing[3], maxHeight: "92%", padding: spacing[4], paddingBottom: spacing[5] },
    sheetDragTarget: { alignItems: "center", height: spacing[4], justifyContent: "center", marginTop: -spacing[2], width: "100%" },
    sheetDragHandle: { backgroundColor: theme.borderColorStrong, borderRadius: radius.round, height: spacing[1], width: spacing[8] },
    sheetHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
    sheetTitle: { ...typography.titleSm, color: theme.color, flex: 1, textAlign: "right" },
    productGallery: { flexDirection: "row", gap: spacing[2] },
    productGalleryImage: { backgroundColor: theme.surfaceInset, borderRadius: radius.lg, height: 210, width: 260 },
    productGalleryFallback: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.lg, gap: spacing[2], height: 210, justifyContent: "center", width: 260 },
    productSheetContent: { gap: spacing[3], paddingBottom: spacing[2] },
    sheetActions: { flexDirection: "row", gap: spacing[2] },
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
    addOfferButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, flexDirection: "row", gap: spacing[1], justifyContent: "center", minHeight: sizing.controlMd, minWidth: sizing.controlMd, paddingHorizontal: spacing[2] },
    addOfferPlus: { ...typography.bodyStrong, color: theme.onAction },
    quantityHint: { ...typography.caption, color: theme.colorMuted },
    quantityRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", width: "100%" },
    quantityStepper: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    quantityAction: { alignItems: "center", backgroundColor: theme.actionSoft, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, height: sizing.controlMd, justifyContent: "center", minWidth: sizing.controlMd },
    quantityActionDisabled: { backgroundColor: theme.surfaceInset },
    quantityActionText: { ...typography.titleSm, color: theme.interactiveText },
    quantityActionTextDisabled: { color: theme.colorMuted },
    quantityValue: { ...typography.bodyStrong, color: theme.color, minWidth: 84, textAlign: "center" },
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
