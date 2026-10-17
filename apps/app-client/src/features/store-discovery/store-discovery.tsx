import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { availableCustomerFulfillmentModes, type CatalogCategory, type CatalogStoreOffer, type DeliveryAddress, formatMoney, fulfillmentModeLabel, type PublicCommerceVertical, type PublicDiscoveryContentView, type PublicPromotionView, type PublicShoppingShortcut, type PublicStoreView } from "@bthwani/dsh";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, I18nManager, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { recordDiscoveryClick, recordDiscoveryImpression } from "./discovery-analytics";
import { normalizeDiscoveryTaxonomy } from "./discovery-taxonomy";
import { PromotionCard } from "./promotion-card";
import { StoreDirectoryCard, type StorePromotionCache } from "./store-directory-card";
import { listFavoriteStoreIDs, listOwnDeliveryAddresses, listPublicDiscoveryContent, listPublicPromotions, listPublishedStores, searchPublicCatalog, setFavoriteStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView>; verticals: ReadonlyArray<PublicCommerceVertical>; categories: ReadonlyArray<CatalogCategory>; shortcuts: ReadonlyArray<PublicShoppingShortcut>; favoriteStoreIDs: ReadonlyArray<string>; nextCursor: string }
  | { kind: "empty" }
  | { kind: "error" };

type ProductSearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; nextCursor: string | null }
  | { kind: "error" };

type NearbyAddressState =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; addresses: ReadonlyArray<DeliveryAddress>; nextCursor: string; loadingMore: boolean; moreError: boolean };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication, searchOpen, searchQuery, searchScope: controlledSearchScope, onSearchOpenChange, onSearchScopeChange, onSearchQueryChange }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined; searchOpen?: boolean; searchQuery?: string; searchScope?: "stores" | "products"; onSearchOpenChange?: (open: boolean) => void; onSearchScopeChange?: (scope: "stores" | "products") => void; onSearchQueryChange?: (query: string) => void }) {
  const router = useRouter();
  const { q: rawQuery, focus: rawFocus, scope: rawScope } = useLocalSearchParams<{ q?: string | string[]; focus?: string | string[]; scope?: string | string[] }>();
  const routeQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const query = searchQuery ?? routeQuery;
  const focus = Array.isArray(rawFocus) ? rawFocus[0] ?? "" : rawFocus ?? "";
  const requestedScope = Array.isArray(rawScope) ? rawScope[0] ?? "" : rawScope ?? "";
  const searchScope = controlledSearchScope ?? (requestedScope === "products" ? "products" : "stores");
  const searchIsActive = (searchOpen ?? focus === "search") || Boolean(query.trim());
  const { cities, selectedCityID } = useServiceCityScope();
  const selectedCity = cities.find((city) => city.id === selectedCityID);
  const selectedCityName = serviceCityDisplayName(selectedCity?.displayNameAr);
  const theme = useAppearanceTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [discoveryContainerWidth, setDiscoveryContainerWidth] = useState(0);
  const carouselCardWidth = Math.max(200, Math.min((discoveryContainerWidth || viewportWidth) - spacing[4], 560));
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [storeFilter, setStoreFilter] = useState<"all" | "newest" | "nearest" | "favorites">("all");
  const [selectedVerticalID, setSelectedVerticalID] = useState("");
  const [selectedCategoryID, setSelectedCategoryID] = useState("");
  const [selectedShortcutID, setSelectedShortcutID] = useState("");
  const [favoriteBusyStoreID, setFavoriteBusyStoreID] = useState("");
  const [failedStoreImageIDs, setFailedStoreImageIDs] = useState<ReadonlySet<string>>(() => new Set());
  const promotionCache = useRef<StorePromotionCache>(new Map());
  const [favoriteError, setFavoriteError] = useState("");
  const [directoryLocation, setDirectoryLocation] = useState<{ latitude: number; longitude: number } | undefined>();
  const [nearestAddress, setNearestAddress] = useState<DeliveryAddress | null>(null);
  const [nearbyAddressState, setNearbyAddressState] = useState<NearbyAddressState>({ kind: "closed" });
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(false);
  const [loadingMoreStores, setLoadingMoreStores] = useState(false);
  const [loadMoreStoresError, setLoadMoreStoresError] = useState(false);
  const [marketing, setMarketing] = useState<{ content: ReadonlyArray<PublicDiscoveryContentView>; promotions: ReadonlyArray<PublicPromotionView>; error: boolean }>({ content: [], promotions: [], error: false });
  const discoveryLoadRequestID = useRef(0);
  const directoryRequestID = useRef(0);
  const directoryRequestKey = useRef("");
  const nearbyAddressRequestID = useRef(0);

  const directoryMode = searchScope === "stores" || !searchIsActive;
  const directoryQuery = directoryMode && searchIsActive ? query.trim() : "";
  const directorySort = storeFilter === "newest" || storeFilter === "nearest" ? storeFilter : "all";
  const directoryFavoritesOnly = directoryMode && storeFilter === "favorites";
  const currentDirectoryKey = JSON.stringify([selectedCityID, directoryQuery, selectedVerticalID, directoryMode ? selectedCategoryID : "", directoryMode ? selectedShortcutID : "", directorySort, directoryFavoritesOnly, directoryLocation?.latitude ?? null, directoryLocation?.longitude ?? null]);
  const displayedStoreCount = state.kind === "ready" ? state.stores.length : 0;

  const load = useCallback(async () => {
    const requestID = ++discoveryLoadRequestID.current;
    directoryRequestID.current += 1;
    setState({ kind: "loading" });
    setFavoriteError("");
    setMarketing({ content: [], promotions: [], error: false });
    setDirectoryLoading(false);
    setDirectoryError(false);
    setLoadingMoreStores(false);
    setLoadMoreStoresError(false);
    setDirectoryLocation(undefined);
    setNearestAddress(null);
    setStoreFilter((current) => current === "nearest" ? "all" : current);
    setNearbyAddressState({ kind: "closed" });
    nearbyAddressRequestID.current += 1;
    try {
      if (!selectedCityID) {
        directoryRequestKey.current = "";
        setState({ kind: "empty" });
        return;
      }
      const storeDirectory = await listPublishedStores(selectedCityID, { limit: 20 });
      const { verticals, categories } = normalizeDiscoveryTaxonomy(storeDirectory.verticals, storeDirectory.categories);
      if (requestID !== discoveryLoadRequestID.current) return;
      directoryRequestKey.current = JSON.stringify([selectedCityID, "", "", "", "", "all", false, null, null]);
      setState({ kind: "ready", stores: storeDirectory.stores, verticals, categories, shortcuts: storeDirectory.shortcuts ?? [], favoriteStoreIDs: [], nextCursor: storeDirectory.nextCursor ?? "" });
      void Promise.allSettled([listPublicDiscoveryContent(selectedCityID), listPublicPromotions(selectedCityID)]).then((results) => {
        if (requestID !== discoveryLoadRequestID.current) return;
        setMarketing({
          content: results[0].status === "fulfilled" ? results[0].value.items : [],
          promotions: results[1].status === "fulfilled" ? results[1].value.promotions : [],
          error: results.some((result) => result.status === "rejected"),
        });
      });
      if (isAuthenticated) {
        void listFavoriteStoreIDs().then((favoriteStoreIDs) => {
          if (requestID === discoveryLoadRequestID.current) setState((current) => current.kind === "ready" ? { ...current, favoriteStoreIDs } : current);
        }).catch(() => {
          if (requestID === discoveryLoadRequestID.current) setFavoriteError("تعذر تحديث قائمة المفضلة. يمكنك متابعة تصفح المتاجر.");
        });
      }
    } catch {
      if (requestID === discoveryLoadRequestID.current) setState({ kind: "error" });
    }
  }, [isAuthenticated, selectedCityID]);

  useEffect(() => {
    void load();
    return () => { discoveryLoadRequestID.current += 1; };
  }, [load]);

  useEffect(() => {
    nearbyAddressRequestID.current += 1;
    directoryRequestKey.current = selectedCityID ? JSON.stringify([selectedCityID, "", "", "", "", "all", false, null, null]) : "";
    setSelectedVerticalID("");
    setSelectedCategoryID("");
    setSelectedShortcutID("");
    setDirectoryLocation(undefined);
    setNearestAddress(null);
    setNearbyAddressState({ kind: "closed" });
    setStoreFilter((current) => current === "nearest" ? "all" : current);
  }, [selectedCityID]);

  useEffect(() => {
    if (!selectedCityID || state.kind !== "ready" || currentDirectoryKey === directoryRequestKey.current) return;
    const requestID = ++directoryRequestID.current;
    setDirectoryLoading(true);
    setDirectoryError(false);
    setLoadingMoreStores(false);
    setLoadMoreStoresError(false);
    const timer = setTimeout(() => {
      directoryRequestKey.current = currentDirectoryKey;
      void listPublishedStores(selectedCityID, {
        q: directoryQuery,
        verticalId: selectedVerticalID,
        categoryId: directoryMode ? selectedCategoryID : "",
        shortcutId: directoryMode ? selectedShortcutID : "",
        favoritesOnly: directoryFavoritesOnly,
        sort: directorySort,
        limit: 20,
        location: directoryLocation,
      }).then((page) => {
        if (directoryRequestID.current !== requestID) return;
        setState((current) => current.kind === "ready" ? { ...current, stores: page.stores, verticals: Array.isArray(page.verticals) ? page.verticals : current.verticals, categories: Array.isArray(page.categories) ? page.categories : current.categories, shortcuts: Array.isArray(page.shortcuts) ? page.shortcuts : current.shortcuts, nextCursor: page.nextCursor ?? "" } : current);
      }).catch(() => {
        if (directoryRequestID.current === requestID) setDirectoryError(true);
      }).finally(() => {
        if (directoryRequestID.current === requestID) setDirectoryLoading(false);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      directoryRequestID.current += 1;
    };
  }, [currentDirectoryKey, directoryFavoritesOnly, directoryLocation, directoryMode, directoryQuery, directorySort, selectedCategoryID, selectedShortcutID, selectedCityID, selectedVerticalID, state.kind]);

  // Orderability is evaluated server-side against the current Sana'a clock.
  // Re-read displayed stores on focus and periodically without resetting filters or scroll.
  useFocusEffect(useCallback(() => {
    if (!selectedCityID || state.kind !== "ready" || directoryLoading) return;
    let active = true;
    const refreshOrderability = async () => {
      const statuses = new Map<string, NonNullable<PublicStoreView["orderabilityByMode"]>>();
      let cursor = "";
      const pages = Math.max(1, Math.ceil(displayedStoreCount / 20));
      try {
        for (let index = 0; index < pages; index += 1) {
          const page = await listPublishedStores(selectedCityID, {
            q: directoryQuery,
            verticalId: selectedVerticalID,
            categoryId: directoryMode ? selectedCategoryID : "",
        shortcutId: directoryMode ? selectedShortcutID : "",
            favoritesOnly: directoryFavoritesOnly,
            sort: directorySort,
            limit: 20,
            ...(cursor ? { cursor } : {}),
            location: directoryLocation,
          });
          if (!active) return;
          for (const store of page.stores) if (store.orderabilityByMode !== undefined) statuses.set(store.id, store.orderabilityByMode);
          cursor = page.nextCursor ?? "";
          if (!cursor) break;
        }
        if (active) setState((current) => current.kind === "ready" ? {
          ...current,
          stores: current.stores.map((store) => {
            const latest = statuses.get(store.id);
            return latest === undefined ? store : { ...store, orderabilityByMode: latest };
          }),
        } : current);
      } catch {
        // Retain last confirmed availability when the periodic read is unavailable.
      }
    };
    void refreshOrderability();
    const timer = setInterval(() => void refreshOrderability(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [selectedCityID, state.kind, displayedStoreCount, directoryLoading, directoryQuery, selectedVerticalID, selectedCategoryID, selectedShortcutID, directoryMode, directoryFavoritesOnly, directorySort, directoryLocation]));

  async function loadMoreStores() {
    if (state.kind !== "ready" || !state.nextCursor || loadingMoreStores || !selectedCityID) return;
    const cursor = state.nextCursor;
    const requestID = ++directoryRequestID.current;
    setLoadingMoreStores(true);
    setLoadMoreStoresError(false);
    try {
      const page = await listPublishedStores(selectedCityID, {
        q: directoryQuery,
        verticalId: selectedVerticalID,
        categoryId: directoryMode ? selectedCategoryID : "",
        shortcutId: directoryMode ? selectedShortcutID : "",
        favoritesOnly: directoryFavoritesOnly,
        sort: directorySort,
        limit: 20,
        cursor,
        location: directoryLocation,
      });
      if (directoryRequestID.current !== requestID) return;
      setState((current) => {
        if (current.kind !== "ready") return current;
        const stores = new Map(current.stores.map((store) => [store.id, store]));
        for (const store of page.stores) stores.set(store.id, store);
        const categories = new Map(current.categories.map((category) => [category.id, category]));
        for (const category of Array.isArray(page.categories) ? page.categories : []) categories.set(category.id, category);
        const verticals = new Map(current.verticals.map((vertical) => [vertical.id, vertical]));
        for (const vertical of Array.isArray(page.verticals) ? page.verticals : []) verticals.set(vertical.id, vertical);
        return { ...current, stores: [...stores.values()], verticals: [...verticals.values()], categories: [...categories.values()], nextCursor: page.nextCursor ?? "" };
      });
    } catch {
      if (directoryRequestID.current === requestID) setLoadMoreStoresError(true);
    } finally {
      if (directoryRequestID.current === requestID) setLoadingMoreStores(false);
    }
  }

  const filteredStores = useMemo(() => {
    if (state.kind !== "ready") return [];
    if (storeFilter === "favorites") return state.stores.filter((store) => state.favoriteStoreIDs.includes(store.id));
    return state.stores;
  }, [state, storeFilter]);

  let directoryStatusKind: "loading" | "error" | "empty" = "empty";
  if (directoryLoading || state.kind === "loading") directoryStatusKind = "loading";
  else if (directoryError || state.kind === "error") directoryStatusKind = "error";

  let nearbyAddressLoadMoreLabel = "عرض المزيد من العناوين";
  if (nearbyAddressState.kind === "ready") {
    if (nearbyAddressState.moreError) nearbyAddressLoadMoreLabel = "إعادة المحاولة";
    if (nearbyAddressState.loadingMore) nearbyAddressLoadMoreLabel = "جارٍ تحميل العناوين";
  }

  const hasMarketingItems = marketing.content.length > 0 || marketing.promotions.length > 0;

  const taxonomy = useMemo(() => {
    if (state.kind !== "ready") return { verticals: [], categories: [], trail: [], children: [] };
    const normalized = normalizeDiscoveryTaxonomy(state.verticals, state.categories);
    const verticals = normalized.verticals;
    const categories = normalized.categories.filter((category) => category.active && category.verticalId === selectedVerticalID);
    const byID = new Map(categories.map((category) => [category.id, category]));
    const trail: CatalogCategory[] = [];
    let current = selectedCategoryID ? byID.get(selectedCategoryID) : undefined;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      trail.unshift(current);
      current = current.parentCategoryId ? byID.get(current.parentCategoryId) : undefined;
    }
    const parentID = trail.at(-1)?.id ?? "";
    const children = categories.filter((category) => (category.parentCategoryId ?? "") === parentID);
    return { verticals, categories, trail, children };
  }, [selectedCategoryID, selectedVerticalID, state]);
  const selectedVertical = taxonomy.verticals.find((vertical) => vertical.id === selectedVerticalID);
  const shoppingShortcuts = state.kind === "ready"
    ? state.shortcuts.filter((item) => item.verticalId === selectedVerticalID)
    : [];
  const selectCategory = (categoryID: string) => {
    setSelectedCategoryID(categoryID);
    setSelectedShortcutID("");
  };
  const selectShortcut = (shortcutID: string) => {
    setSelectedShortcutID(shortcutID);
    setSelectedCategoryID("");
  };

  function selectVertical(verticalID: string) {
    setSelectedVerticalID(verticalID);
    setSelectedCategoryID("");
    setSelectedShortcutID("");
  }

  const mediaContent = useMemo(() => marketing.content.filter((item) => Boolean(item.mediaUri)), [marketing.content]);
  const textContent = useMemo(() => marketing.content.filter((item) => !item.mediaUri), [marketing.content]);

  async function openNearbyAddressChooser() {
    if (!selectedCityID || nearbyAddressState.kind === "loading") return;
    const requestID = ++nearbyAddressRequestID.current;
    setNearbyAddressState({ kind: "loading" });
    try {
      const page = await listOwnDeliveryAddresses();
      if (requestID !== nearbyAddressRequestID.current) return;
      setNearbyAddressState({ kind: "ready", addresses: page.addresses, nextCursor: page.nextCursor ?? "", loadingMore: false, moreError: false });
    } catch {
      if (requestID === nearbyAddressRequestID.current) setNearbyAddressState({ kind: "error" });
    }
  }

  async function loadMoreNearbyAddresses() {
    if (nearbyAddressState.kind !== "ready" || !nearbyAddressState.nextCursor || nearbyAddressState.loadingMore) return;
    const cursor = nearbyAddressState.nextCursor;
    const requestID = ++nearbyAddressRequestID.current;
    setNearbyAddressState((current) => current.kind === "ready" ? { ...current, loadingMore: true, moreError: false } : current);
    try {
      const page = await listOwnDeliveryAddresses(cursor);
      if (requestID !== nearbyAddressRequestID.current) return;
      setNearbyAddressState((current) => {
        if (current.kind !== "ready") return current;
        const addresses = new Map(current.addresses.map((address) => [address.id, address]));
        for (const address of page.addresses) addresses.set(address.id, address);
        return { ...current, addresses: [...addresses.values()], nextCursor: page.nextCursor ?? "", loadingMore: false, moreError: false };
      });
    } catch {
      if (requestID === nearbyAddressRequestID.current) setNearbyAddressState((current) => current.kind === "ready" ? { ...current, loadingMore: false, moreError: true } : current);
    }
  }

  function selectNearbyAddress(address: DeliveryAddress) {
    if (address.serviceCityId !== selectedCityID || !Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) return;
    setNearestAddress(address);
    setDirectoryLocation({ latitude: address.latitude, longitude: address.longitude });
    setFavoriteError("");
    setStoreFilter("nearest");
    setNearbyAddressState({ kind: "closed" });
    nearbyAddressRequestID.current += 1;
  }

  function closeNearbyAddressChooser() {
    nearbyAddressRequestID.current += 1;
    setNearbyAddressState({ kind: "closed" });
  }

  async function toggleFavorite(storeID: string) {
    if (!isAuthenticated) {
      onRequireAuthentication?.();
      return;
    }
    if (favoriteBusyStoreID || state.kind !== "ready") return;
    const isFavorite = state.favoriteStoreIDs.includes(storeID);
    setFavoriteBusyStoreID(storeID);
    setFavoriteError("");
    try {
      const nextValue = await setFavoriteStore(storeID, !isFavorite);
      setState((current) => {
        if (current.kind !== "ready") return current;
        const nextIDs = current.favoriteStoreIDs.filter((id) => id !== storeID);
        return { ...current, favoriteStoreIDs: nextValue ? [...nextIDs, storeID] : nextIDs };
      });
    } catch {
      setFavoriteError("تعذر تحديث المفضلة. أعد المحاولة.");
    } finally {
      setFavoriteBusyStoreID("");
    }
  }

  if (state.kind === "loading" && !searchIsActive) {
    return (
      <View style={styles.state} accessibilityLabel="جارٍ تجهيز الاكتشاف">
        <View style={styles.stateHeader}><BthwaniSkeleton width={sizing.avatarLg} height={sizing.avatarLg} style={styles.skeletonRound} /><View style={styles.stateCopy}><BthwaniSkeleton width="58%" height={20} /><BthwaniSkeleton width="86%" height={16} /></View></View>
        <BthwaniSkeleton height={sizing.controlLg} />
        <BthwaniSkeleton height={112} />
        <BthwaniSkeleton height={112} />
      </View>
    );
  }

  if (state.kind === "error" && !searchIsActive) {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر تجهيز الاكتشاف</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} variant="secondary" /> : null}</View>;
  }

  if (state.kind === "empty" && !searchIsActive) {
    return <View style={styles.state}><View style={styles.emptyIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconXl} /></View><Text style={styles.title}>{selectedCityID ? "لا توجد متاجر متاحة بعد" : "اختر مدينة للبدء"}</Text><Text style={styles.muted}>{selectedCityID ? "لا توجد متاجر منشورة للطلب حاليًا." : "تظهر المتاجر بحسب مدينة الخدمة التي تختارها."}</Text><BthwaniButton label="تحديث المتاجر" onPress={() => void load()} variant="secondary" />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} /> : null}</View>;
  }

  const storeRows = directoryMode && !directoryLoading ? filteredStores : [];

  return (
    <FlatList
      key={directoryMode ? "store-directory" : "product-search"}
      accessibilityLabel={directoryMode ? "اكتشاف المتاجر" : "نتائج البحث"}
      contentContainerStyle={styles.screenContent}
      data={storeRows}
      keyExtractor={(store) => store.id}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<View
        style={styles.container}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width;
          setDiscoveryContainerWidth((current) => Math.abs(current - nextWidth) < 1 ? current : nextWidth);
        }}
      >
      {searchIsActive ? <View accessibilityLabel="نطاق البحث" style={styles.searchScopes}>
        <BthwaniChip label="المتاجر" selected={searchScope === "stores"} onPress={() => { if (onSearchScopeChange) onSearchScopeChange("stores"); else router.setParams({ scope: "stores" }); }} />
        <BthwaniChip label="المنتجات" selected={searchScope === "products"} onPress={() => { if (onSearchScopeChange) onSearchScopeChange("products"); else router.setParams({ scope: "products" }); }} />
      </View> : null}

      {taxonomy.verticals.length ? <View style={styles.categoryShortcutBlock} accessibilityLabel="المجالات التجارية الرئيسية">
        <BthwaniSectionHeader title="تسوق حسب المجال" />
        <ScrollView accessibilityLabel="المجالات التجارية" contentContainerStyle={styles.activityTiles} horizontal showsHorizontalScrollIndicator={false}>
          <Pressable accessibilityRole="button" accessibilityLabel="عرض جميع المجالات والمتاجر" accessibilityState={{ selected: !selectedVerticalID }} onPress={() => selectVertical("")} style={[styles.activityTile, !selectedVerticalID && styles.activityTileSelected]}>
            <View style={[styles.activityMark, !selectedVerticalID && styles.activityMarkSelected]}><BthwaniIcon name="store" color={!selectedVerticalID ? theme.onAction : theme.interactiveText} size={sizing.iconSm} /></View>
            <Text numberOfLines={1} style={[styles.activityTileName, !selectedVerticalID && styles.activityTileNameSelected]}>الكل</Text>
          </Pressable>
          {taxonomy.verticals.map((vertical, index) => <Pressable key={vertical.id} accessibilityRole="button" accessibilityLabel={`تصفح نشاط ${vertical.nameAr}`} accessibilityState={{ selected: selectedVerticalID === vertical.id }} onPress={() => selectVertical(vertical.id)} style={[styles.activityTile, selectedVerticalID === vertical.id && styles.activityTileSelected]}>
            <View style={[styles.activityMark, index % 2 === 1 && styles.activityMarkWarm, selectedVerticalID === vertical.id && styles.activityMarkSelected]}><Text style={[styles.activityInitial, selectedVerticalID === vertical.id && styles.activityTileNameSelected]}>{vertical.nameAr.slice(0, 1)}</Text></View>
            <Text numberOfLines={1} style={[styles.activityTileName, selectedVerticalID === vertical.id && styles.activityTileNameSelected]}>{vertical.nameAr}</Text>
          </Pressable>)}
        </ScrollView>
      </View> : null}

      {!searchIsActive && hasMarketingItems ? <View accessibilityLabel="العروض ومحتوى الاكتشاف" style={styles.marketingBlock}>
        {mediaContent.length ? <>
          {mediaContent.length > 1 ? <BthwaniSectionHeader title="العروض والاختيارات" subtitle="اسحب أو اختر إحدى الشرائح" /> : <BthwaniSectionHeader title="العروض والاختيارات" />}
          <DiscoveryMediaCarousel cardWidth={carouselCardWidth} items={mediaContent} styles={styles} theme={theme} onOpen={(item) => {
            void recordDiscoveryClick(item.id);
            if (item.targetType === "STORE" && item.targetId) router.push(`/store/${encodeURIComponent(item.targetId)}` as Href);
            else router.push(`/discovery-content/${encodeURIComponent(item.id)}` as Href);
          }} />
        </> : null}
        {textContent.length ? <>
          <BthwaniSectionHeader title="مختارات لك" subtitle="محتوى منشور من بثواني" />
          <View style={styles.marketingList}>{textContent.map((item) => {
            let contentKindLabel = "قصة قصيرة";
            if (item.kind === "BANNER") contentKindLabel = "إعلان";
            else if (item.kind === "CAROUSEL") contentKindLabel = "اختيارات";
            return <BthwaniSurface key={item.id} tone="inset" style={styles.marketingCard}><Text style={styles.eyebrow}>{contentKindLabel}</Text><Text style={styles.cardTitle}>{item.titleAr}</Text>{item.bodyAr ? <Text style={styles.muted}>{item.bodyAr}</Text> : null}</BthwaniSurface>;
          })}</View>
        </> : null}
        {marketing.promotions.length ? <>
          <BthwaniSectionHeader title="عروض نشطة" subtitle="طبّق الرمز عند إتمام الطلب" />
          <View style={styles.marketingList}>{marketing.promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} />)}</View>
        </> : null}
      </View> : null}
      {selectedVertical && shoppingShortcuts.length > 0 ? <View style={styles.categoryShortcutBlock} accessibilityLabel={`تسوق حسب احتياجك في ${selectedVertical.nameAr}`}>
        <BthwaniSectionHeader title="تسوق حسب احتياجك" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryShortcutContent}>
          <BthwaniChip label="عرض الكل" selected={!selectedShortcutID && !selectedCategoryID} onPress={() => selectShortcut("")} />
          {shoppingShortcuts.map((item) => <BthwaniChip key={item.id} label={item.titleAr} selected={selectedShortcutID === item.id} onPress={() => selectShortcut(item.id)} />)}
        </ScrollView>
      </View> : null}
      {selectedVertical ? <View style={styles.categoryShortcutBlock} accessibilityLabel={`فئات ${selectedVertical.nameAr}`}>
        <BthwaniSectionHeader title={`فئات ${selectedVertical.nameAr}`} subtitle="تظهر المنتجات بعد اختيار الفئة أو فتح المتجر" />
        <ScrollView accessibilityLabel={`التدرج الهرمي لفئات ${selectedVertical.nameAr}`} contentContainerStyle={styles.categoryShortcutContent} horizontal showsHorizontalScrollIndicator={false}>
          <BthwaniChip label="كل فئات المنتجات" selected={!selectedCategoryID} onPress={() => selectCategory("")} />
          {taxonomy.trail.map((category, index) => <BthwaniChip key={category.id} label={category.nameAr} selected={index === taxonomy.trail.length - 1} onPress={() => selectCategory(category.id)} />)}
          {taxonomy.children.map((category) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={`فتح فئة ${category.nameAr}`} accessibilityState={{ selected: selectedCategoryID === category.id }} onPress={() => selectCategory(category.id)} style={[styles.categoryTile, selectedCategoryID === category.id && styles.categoryTileSelected]}>
            {category.imageUri ? <Image source={{ uri: category.imageUri }} accessibilityLabel={`صورة ${category.nameAr}`} style={styles.categoryTileImage} resizeMode="cover" /> : <View style={styles.categoryTileFallback}><Text style={styles.categoryTileInitial}>{category.nameAr.slice(0, 1)}</Text></View>}
            <Text numberOfLines={2} style={styles.categoryTileName}>{category.nameAr}</Text>
            <Text numberOfLines={1} style={styles.categoryTileParent}>{taxonomy.trail[taxonomy.trail.length - 1]?.nameAr ?? selectedVertical.nameAr}</Text>
          </Pressable>)}
        </ScrollView>
        {taxonomy.children.length === 0 ? <Text style={styles.categoryTreeEmpty}>{selectedCategoryID ? "وصلت إلى أدق فئة متاحة؛ المتاجر والمنتجات المطابقة معروضة أدناه." : "لا توجد فئات منتجات متاحة لهذا المجال الآن؛ يمكنك فتح المتجر وعرض منتجاته وأقسامه."}</Text> : null}
      </View> : null}

      {!searchIsActive && marketing.error ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل بعض العروض والمحتوى. يمكنك متابعة تصفح المتاجر.</Text> : null}

      {searchScope === "products" && searchIsActive ? (
        <ProductSearchResults
          onClearCategory={() => selectCategory("")}
          query={query}
          selectedCategoryID={selectedCategoryID}
          selectedCityID={selectedCityID}
          selectedCityName={selectedCityName}
          selectedVerticalID={selectedVerticalID}
          selectedShortcutID={selectedShortcutID}
        />
      ) : null}

      {searchScope === "stores" || !searchIsActive ? <>
      <BthwaniSectionHeader title={searchIsActive ? "نتائج المتاجر" : "المتاجر المتاحة"} subtitle={`${filteredStores.length} متجر معروض`} />
      <View style={styles.filterRow}>
        <BthwaniChip label="كل المتاجر" selected={storeFilter === "all"} onPress={() => setStoreFilter("all")} />
        <BthwaniChip label="الأحدث" selected={storeFilter === "newest"} onPress={() => setStoreFilter("newest")} />
        <BthwaniChip
          icon="location"
          label="الأقرب"
          selected={storeFilter === "nearest"}
          onPress={() => {
            if (!isAuthenticated) {
              onRequireAuthentication?.();
              return;
            }
            setFavoriteError("");
            void openNearbyAddressChooser();
          }}
        />
        <BthwaniChip
          icon="favorite"
          label="المفضلة"
          selected={storeFilter === "favorites"}
          onPress={() => {
            if (!isAuthenticated) {
              onRequireAuthentication?.();
              return;
            }
            setStoreFilter("favorites");
          }}
        />
      </View>
      {favoriteError ? <Text accessibilityRole="alert" style={styles.error}>{favoriteError}</Text> : null}
      {storeFilter === "nearest" && nearestAddress ? <Text style={styles.nearestAddressSummary}>الأقرب إلى: {nearestAddress.addressText}</Text> : null}
      {nearbyAddressState.kind !== "closed" ? <BthwaniSurface accessibilityLabel="اختيار عنوان لترتيب المتاجر الأقرب" style={styles.nearestAddressChooser} tone="inset">
        <View style={styles.nearestAddressHeading}>
          <View style={styles.nearestAddressCopy}>
            <Text style={styles.nearestAddressTitle}>اختر عنوانًا في {selectedCityName}</Text>
            <Text style={styles.nearestAddressHint}>سنستخدمه لترتيب المتاجر الأقرب في هذه المدينة فقط.</Text>
          </View>
          <BthwaniIconButton icon="close" label="إغلاق اختيار العنوان" onPress={closeNearbyAddressChooser} />
        </View>
        {nearbyAddressState.kind === "loading" ? <View accessibilityRole="progressbar" style={styles.nearestAddressStatus}><BthwaniSkeleton height={52} /><Text style={styles.muted}>جارٍ قراءة عناوينك…</Text></View> : null}
        {nearbyAddressState.kind === "error" ? <View style={styles.nearestAddressStatus}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة عناوينك. تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة قراءة العناوين" onPress={() => void openNearbyAddressChooser()} variant="secondary" /></View> : null}
        {nearbyAddressState.kind === "ready" ? <>
          {nearbyAddressState.addresses.filter((address) => address.serviceCityId === selectedCityID && Number.isFinite(address.latitude) && Number.isFinite(address.longitude)).map((address) => <Pressable key={address.id} accessibilityRole="button" accessibilityLabel={`ترتيب المتاجر بالقرب من ${address.addressText}`} onPress={() => selectNearbyAddress(address)} style={styles.nearestAddressOption}><Text style={styles.nearestAddressOptionTitle}>{address.addressText}</Text><Text style={styles.nearestAddressHint}>{selectedCityName}</Text></Pressable>)}
          {nearbyAddressState.addresses.every((address) => address.serviceCityId !== selectedCityID || !Number.isFinite(address.latitude) || !Number.isFinite(address.longitude)) ? <View style={styles.nearestAddressStatus}><Text style={styles.muted}>{nearbyAddressState.nextCursor ? `لم يظهر عنوان في ${selectedCityName} ضمن هذه الصفحة.` : `لا يوجد عنوان محفوظ بإحداثيات في ${selectedCityName}.`}</Text><BthwaniButton label={`إضافة عنوان في ${selectedCityName}`} onPress={() => { closeNearbyAddressChooser(); router.push("/addresses" as Href); }} variant="secondary" /></View> : null}
          {nearbyAddressState.moreError ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل بقية العناوين.</Text> : null}
          {nearbyAddressState.nextCursor ? <BthwaniButton busy={nearbyAddressState.loadingMore} disabled={nearbyAddressState.loadingMore} label={nearbyAddressLoadMoreLabel} onPress={() => void loadMoreNearbyAddresses()} variant="secondary" /> : null}
        </> : null}
      </BthwaniSurface> : null}

      </> : null}


      </View>}
      renderItem={({ item: store }) => <StoreDirectoryCard
        store={store}
        activityLabel={state.kind === "ready" ? state.verticals.find((vertical) => vertical.id === store.primaryVerticalId)?.nameAr ?? "" : ""}
        cityId={selectedCityID ?? ""}
        favorite={state.kind === "ready" && state.favoriteStoreIDs.includes(store.id)}
        favoriteBusy={Boolean(favoriteBusyStoreID)}
        imageFailed={failedStoreImageIDs.has(store.id)}
        onImageError={() => setFailedStoreImageIDs((current) => new Set(current).add(store.id))}
        onOpen={() => router.push(("/store/" + encodeURIComponent(store.id)) as Href)}
        onFavorite={() => { void toggleFavorite(store.id); }}
        promotionCache={promotionCache.current}
      />}
      ListEmptyComponent={directoryMode ? <StoreDirectoryStatus hasServiceCity={Boolean(selectedCityID)} kind={directoryStatusKind} query={query} selectedCategory={Boolean(selectedCategoryID)} onRetry={() => void load()} onClearSearch={() => { if (onSearchQueryChange) onSearchQueryChange(""); else router.setParams({ q: "" }); }} /> : null}
      ListFooterComponent={<View style={styles.footer}>
        {directoryMode && state.kind === "ready" && state.nextCursor ? <>
          {loadMoreStoresError ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل المزيد من المتاجر.</Text> : null}
          <BthwaniButton disabled={loadingMoreStores || directoryLoading} label={loadingMoreStores ? "جارٍ تحميل المزيد" : "تحميل المزيد من المتاجر"} onPress={() => void loadMoreStores()} variant="secondary" />
        </> : null}
        {!searchIsActive && isAuthenticated ? <BthwaniSurface tone="inset" style={styles.multiStoreCta}><View style={styles.multiStoreCopy}><Text style={styles.eyebrow}>تجربة موحّدة</Text><Text style={styles.cardTitle}>اطلب من عدة متاجر</Text><Text style={styles.muted}>اجمع السلال، وأنشئ طلبًا مستقلًا لكل متجر مع نتيجة واضحة.</Text></View><BthwaniButton label="فتح الطلب المتعدد" onPress={() => router.push("/multi-store-checkout" as Href)} variant="secondary" /></BthwaniSurface> : null}
      </View>}
      style={styles.flatList}
    />
  );
}

function ProductSearchResults({ query, selectedCategoryID, selectedCityID, selectedCityName, selectedVerticalID, selectedShortcutID, onClearCategory }: {
  query: string;
  selectedCategoryID: string;
  selectedCityID: string | null;
  selectedCityName: string;
  selectedVerticalID: string;
  selectedShortcutID: string;
  onClearCategory: () => void;
}) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [productSearch, setProductSearch] = useState<ProductSearchState>({ kind: "idle" });
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [loadMoreProductsError, setLoadMoreProductsError] = useState(false);
  const [failedProductImages, setFailedProductImages] = useState<ReadonlySet<string>>(() => new Set());
  const productSearchRequestID = useRef(0);

  const runProductSearch = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (!selectedCityID || !normalizedQuery) {
      setProductSearch({ kind: "idle" });
      return;
    }
    const requestID = ++productSearchRequestID.current;
    setProductSearch({ kind: "loading" });
    setLoadingMoreProducts(false);
    setLoadMoreProductsError(false);
    try {
      const result = await searchPublicCatalog(selectedCityID, normalizedQuery, selectedCategoryID, 20, "", selectedVerticalID,selectedShortcutID);
      if (productSearchRequestID.current === requestID) setProductSearch({ kind: "ready", offers: result.offers, nextCursor: result.nextCursor });
    } catch {
      if (productSearchRequestID.current === requestID) setProductSearch({ kind: "error" });
    }
  }, [query, selectedCategoryID, selectedCityID, selectedVerticalID, selectedShortcutID]);

  useEffect(() => {
    if (!selectedCityID || !query.trim()) {
      productSearchRequestID.current += 1;
      setProductSearch({ kind: "idle" });
      setLoadingMoreProducts(false);
      setLoadMoreProductsError(false);
      return;
    }
    setProductSearch({ kind: "loading" });
    setLoadingMoreProducts(false);
    setLoadMoreProductsError(false);
    const timer = setTimeout(() => { void runProductSearch(); }, 300);
    return () => {
      clearTimeout(timer);
      productSearchRequestID.current += 1;
    };
  }, [query, runProductSearch, selectedCityID]);

  async function loadMoreProductOffers() {
    if (productSearch.kind !== "ready" || !productSearch.nextCursor || loadingMoreProducts || !selectedCityID || !query.trim()) return;
    const cursor = productSearch.nextCursor;
    const requestID = ++productSearchRequestID.current;
    setLoadingMoreProducts(true);
    setLoadMoreProductsError(false);
    try {
      const result = await searchPublicCatalog(selectedCityID, query.trim(), selectedCategoryID, 20, cursor, selectedVerticalID,selectedShortcutID);
      if (productSearchRequestID.current === requestID) {
        setProductSearch((current) => current.kind === "ready" ? { kind: "ready", offers: [...current.offers, ...result.offers], nextCursor: result.nextCursor } : current);
      }
    } catch {
      if (productSearchRequestID.current === requestID) setLoadMoreProductsError(true);
    } finally {
      if (productSearchRequestID.current === requestID) setLoadingMoreProducts(false);
    }
  }

  if (!query.trim()) {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>اكتب اسم المنتج للبحث</Text><Text style={styles.muted}>استخدم مربع البحث أعلى الصفحة، ويمكنك تضييق النتائج حسب الفئة.</Text></BthwaniSurface></View>;
  }
  if (!selectedCityID) {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="location" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>اختر مدينة الخدمة للبحث</Text><Text style={styles.muted}>أغلق البحث ثم اختر المدينة من أعلى الشاشة لتظهر المنتجات المتاحة فيها.</Text></BthwaniSurface></View>;
  }
  if (productSearch.kind === "loading" || productSearch.kind === "idle") {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><View style={styles.productSkeletons} accessibilityLabel="جارٍ البحث عن المنتجات"><BthwaniSkeleton height={104} /><BthwaniSkeleton height={104} /><BthwaniSkeleton height={104} /></View></View>;
  }
  if (productSearch.kind === "error") {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.cardTitle}>تعذر البحث عن المنتجات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void runProductSearch()} /></BthwaniSurface></View>;
  }
  if (productSearch.offers.length === 0 && productSearch.nextCursor) {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>لا توجد نتائج مؤهلة في الجزء المفحوص</Text><Text style={styles.muted}>قد تظهر منتجات من متاجر أخرى عند متابعة البحث.</Text>{loadMoreProductsError ? <Text accessibilityRole="alert" style={styles.error}>تعذر متابعة البحث. أعد المحاولة.</Text> : null}<BthwaniButton disabled={loadingMoreProducts} label={loadingMoreProducts ? "جارٍ البحث" : "متابعة البحث"} onPress={() => void loadMoreProductOffers()} variant="secondary" /></BthwaniSurface></View>;
  }
  if (productSearch.offers.length === 0) {
    return <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}><BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>لا توجد منتجات مطابقة</Text><Text style={styles.muted}>جرّب كلمة أقصر أو اختر فئة أخرى.</Text><BthwaniButton label="مسح الفئة" onPress={onClearCategory} variant="quiet" /></BthwaniSurface></View>;
  }

  return (
    <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}>
      <BthwaniSectionHeader title="نتائج المنتجات" subtitle={`${productSearch.offers.length} منتج · ${selectedCityName || "مدينة الخدمة"}`} />
        <View style={styles.list}>{productSearch.offers.map((offer) => {
          const primaryMedia = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
          const imageFailed = failedProductImages.has(offer.offerId);
          return <Pressable accessibilityRole="button" accessibilityLabel={`فتح ${offer.productName}${offer.storeName ? ` من متجر ${offer.storeName}` : ""}`} key={offer.offerId} onPress={() => router.push((`/store/${encodeURIComponent(offer.storeId)}?productId=${encodeURIComponent(offer.productId)}`) as Href)} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
            {primaryMedia && !imageFailed ? <Image accessibilityLabel={`صورة ${offer.productName}`} onError={() => setFailedProductImages((current) => new Set(current).add(offer.offerId))} source={{ uri: primaryMedia.uri }} style={styles.productImage} resizeMode="cover" /> : <View style={styles.productImageFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>}
            <View style={styles.productCopy}>
              <Text style={styles.productTitle} numberOfLines={2}>{offer.productName}</Text>
              {offer.variantTitle.trim() ? <Text style={styles.storeMeta} numberOfLines={1}>{offer.variantTitle}</Text> : null}
              <Text style={styles.storeMeta} numberOfLines={1}>{offer.storeName || "متجر مشارك"}</Text>
              <Text style={offer.availability ? styles.productAvailability : styles.storeHint}>{offer.availability ? "متاح حسب آخر تحديث" : "تحقق من التوفر داخل المتجر"}</Text>
            </View>
            <View style={styles.productPriceBlock}><Text style={styles.productPrice}>{formatMoney(offer.priceMinor, offer.currency).replace(/ريال يمني/g, "ريال")}</Text><BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} /></View>
          </Pressable>;
        })}</View>
        {loadMoreProductsError ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل المزيد من المنتجات.</Text> : null}
        {productSearch.nextCursor ? <BthwaniButton disabled={loadingMoreProducts} label={loadingMoreProducts ? "جارٍ تحميل المزيد" : "تحميل المزيد"} onPress={() => void loadMoreProductOffers()} variant="secondary" /> : null}
    </View>
  );
}

function StoreDirectoryStatus({ hasServiceCity, kind, query, selectedCategory, onRetry, onClearSearch }: { hasServiceCity: boolean; kind: "loading" | "error" | "empty"; query: string; selectedCategory: boolean; onRetry: () => void; onClearSearch: () => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!hasServiceCity) return <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="location" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>اختر مدينة الخدمة</Text><Text style={styles.muted}>أغلق البحث ثم اختر المدينة من أعلى الشاشة لعرض المتاجر المتاحة فيها.</Text></BthwaniSurface>;
  if (kind === "loading") return <View style={styles.productSkeletons} accessibilityLabel="جارٍ تجهيز المتاجر"><BthwaniSkeleton height={104} /><BthwaniSkeleton height={104} /></View>;
  if (kind === "error") return <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.cardTitle}>تعذر تحميل المتاجر</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={onRetry} /></BthwaniSurface>;
  let emptyTitle = "لا توجد متاجر مطابقة";
  let emptyDescription = "غيّر الفئة أو أزل الفلاتر لعرض المتاجر المتاحة.";
  if (kind === "empty" && !query.trim()) {
    emptyTitle = "لا توجد متاجر منشورة للطلب حاليًا";
    emptyDescription = "يمكنك البحث عن المنتجات المتاحة في مدينة الخدمة.";
  } else if (query.trim()) {
    emptyTitle = "لا توجد نتائج بهذا الاسم";
    emptyDescription = "جرّب اسمًا أقصر أو امسح البحث لعرض كل المتاجر.";
  } else if (selectedCategory) {
    emptyTitle = "لا توجد متاجر ضمن هذه الفئة";
  }
  return <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>{emptyTitle}</Text><Text style={styles.muted}>{emptyDescription}</Text>{query.trim() ? <BthwaniButton label="مسح البحث" onPress={onClearSearch} variant="quiet" /> : null}</BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    flatList: { flex: 1 },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    footer: { gap: spacing[3], paddingBottom: spacing[4] },
    searchScopes: { flexDirection: "row", gap: spacing[2] },
    productSearchSection: { gap: spacing[3] },
    productSkeletons: { gap: spacing[3] },
    productCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], minHeight: 112, padding: spacing[3], ...elevation.raised },
    productImage: { borderRadius: radius.md, height: sizing.avatarLg, width: sizing.avatarLg },
    productImageFallback: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    productCopy: { flex: 1, gap: spacing[1] },
    productTitle: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    productAvailability: { ...typography.caption, color: theme.success },
    productPriceBlock: { alignItems: "flex-end", gap: spacing[2] },
    productPrice: { ...typography.label, color: theme.interactiveText },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    list: { gap: spacing[3] },
    filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    nearestAddressChooser: { gap: spacing[2], padding: spacing[3] },
    nearestAddressHeading: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
    nearestAddressCopy: { flex: 1, gap: spacing[1] },
    nearestAddressTitle: { ...typography.bodyStrong, color: theme.color },
    nearestAddressHint: { ...typography.caption, color: theme.colorMuted },
    nearestAddressStatus: { gap: spacing[2], paddingVertical: spacing[2] },
    nearestAddressOption: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[3] },
    nearestAddressOptionTitle: { ...typography.bodyStrong, color: theme.color },
    nearestAddressSummary: { ...typography.bodySm, color: theme.interactiveText },
    storeCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], minHeight: 124, padding: spacing[3], ...elevation.raised },
    storeActions: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.lg, height: 84, justifyContent: "center", width: 84 },
    storeImage: { backgroundColor: theme.surfaceInset, borderRadius: radius.lg, height: 84, width: 84 },
    storeCopy: { alignItems: "flex-end", flex: 1, gap: spacing[1] },
    storeTitle: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    storeMeta: { ...typography.bodySm, color: theme.interactiveText },
    storeRating: { ...typography.bodySm, color: theme.warning },
    storeRatingCount: { color: theme.colorMuted },
    storeModes: { ...typography.caption, color: theme.interactiveText },
    storeFacts: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "flex-end", width: "100%" },
    availabilityBadge: { alignItems: "center", backgroundColor: theme.surfaceInset, borderRadius: radius.round, flexDirection: "row", gap: spacing[1], paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    availabilityBadgeOpen: { backgroundColor: theme.successSoft },
    availabilityDot: { backgroundColor: theme.colorMuted, borderRadius: radius.round, height: 6, width: 6 },
    availabilityDotOpen: { backgroundColor: theme.success },
    storeHint: { ...typography.caption, color: theme.colorMuted },
    storeHintOpen: { color: theme.success },
    pressed: { opacity: opacity.subtle },
    noResults: { alignItems: "center", borderRadius: radius.lg, gap: spacing[2], padding: spacing[5] },
    cardTitle: { ...typography.titleSm, color: theme.color, textAlign: "center" },
    state: { alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[10], width: "100%" },
    stateHeader: { alignItems: "center", flexDirection: "row", gap: spacing[3], width: "100%" },
    stateCopy: { flex: 1, gap: spacing[2] },
    skeletonRound: { borderRadius: radius.round },
    emptyIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    title: { ...typography.titleLg, color: theme.color, textAlign: "center" },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center" },
    error: { ...typography.bodySm, color: theme.danger },
    categoryShortcutBlock: { gap: spacing[1] },
    categoryShortcutContent: { alignItems: "flex-start", gap: spacing[2], paddingHorizontal: spacing[1], paddingVertical: spacing[1] },
    activityTiles: { alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[1], paddingVertical: spacing[1] },
    activityTile: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.round, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[2], minHeight: sizing.controlLg, justifyContent: "center", paddingHorizontal: spacing[2] },
    activityTileSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    activityMark: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.round, height: sizing.avatarSm, justifyContent: "center", width: sizing.avatarSm },
    activityMarkWarm: { backgroundColor: theme.surfaceInset },
    activityMarkSelected: { backgroundColor: theme.interactiveText },
    activityInitial: { ...typography.label, color: theme.interactiveText },
    activityTileName: { ...typography.label, color: theme.color, textAlign: "center" },
    activityTileNameSelected: { color: theme.interactiveText },
    categoryTreeEmpty: { ...typography.caption, color: theme.colorMuted, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    categoryTile: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[1], padding: spacing[2], width: 112 },
    categoryTileSelected: { borderColor: theme.interactiveText, borderWidth: 2 },
    categoryTileImage: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, height: 82, width: 82 },
    categoryTileFallback: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: 82, justifyContent: "center", width: 82 },
    categoryTileInitial: { ...typography.titleLg, color: theme.interactiveText },
    categoryTileName: { ...typography.label, color: theme.color, minHeight: 34, textAlign: "center" },
    categoryTileParent: { ...typography.caption, color: theme.colorMuted, textAlign: "center" },
    marketingBlock: { gap: spacing[3] },
    marketingList: { gap: spacing[2] },
    marketingCard: { borderRadius: radius.lg, gap: spacing[1], padding: spacing[3] },
    mediaCarousel: { gap: spacing[2] },
    mediaScroll: { marginHorizontal: -spacing[1] },
    mediaScrollContent: { gap: spacing[2] },
    mediaCard: { backgroundColor: theme.surface, borderRadius: radius.lg, height: 168, overflow: "hidden", ...elevation.raised },
    mediaImage: { height: "100%", width: "100%" },
    mediaCaption: { backgroundColor: theme.actionBackground, bottom: 0, gap: spacing[1], left: 0, paddingHorizontal: spacing[3], paddingVertical: spacing[2], position: "absolute", right: 0 },
    mediaCaptionTitle: { ...typography.titleSm, color: theme.onAction, textAlign: "right" },
    mediaCaptionBody: { ...typography.caption, color: theme.onAction, textAlign: "right" },
    mediaFallback: { alignItems: "center", backgroundColor: theme.actionSoft, height: "100%", justifyContent: "center", padding: spacing[4], width: "100%" },
    mediaFallbackHint: { ...typography.caption, color: theme.interactiveText, textAlign: "center" },
    carouselDots: { alignItems: "center", flexDirection: "row", gap: spacing[1], justifyContent: "center" },
    carouselDot: { backgroundColor: theme.borderColorStrong, borderRadius: radius.round, height: 6, width: 6 },
    carouselDotActive: { backgroundColor: theme.actionBackground, height: 8, width: 18 },
    multiStoreCta: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[3] },
    multiStoreCopy: { gap: spacing[1] },
  });
}

function DiscoveryMediaCarousel({ cardWidth, items, styles, theme, onOpen }: { cardWidth: number; items: ReadonlyArray<PublicDiscoveryContentView>; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme>; onOpen: (item: PublicDiscoveryContentView) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedMedia, setFailedMedia] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<ScrollView>(null);
  const impressionedContentIDs = useRef<Set<string>>(new Set());
  const snapInterval = cardWidth + spacing[2];
  const activeItem = items[activeIndex];

  useEffect(() => {
    if (!activeItem || impressionedContentIDs.current.has(activeItem.id)) return;
    impressionedContentIDs.current.add(activeItem.id);
    void recordDiscoveryImpression(activeItem.id);
  }, [activeItem]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  function selectSlide(index: number) {
    const direction = I18nManager.isRTL ? -1 : 1;
    scrollRef.current?.scrollTo({ x: direction * snapInterval * index, animated: true });
  }

  return (
    <View accessibilityLabel={activeItem ? `العروض، ${activeItem.titleAr}، ${activeIndex + 1} من ${items.length}` : "العروض"} style={styles.mediaCarousel}>
      <ScrollView
        ref={scrollRef}
        accessibilityLabel="شرائح العروض"
        contentContainerStyle={styles.mediaScrollContent}
        horizontal
        onMomentumScrollEnd={(event) => {
          setActiveIndex(Math.min(items.length - 1, Math.max(0, Math.round(Math.abs(event.nativeEvent.contentOffset.x) / snapInterval))));
        }}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={snapInterval}
        style={styles.mediaScroll}
      >
        {items.map((item) => {
          const card = (
            <View key={item.id} style={[styles.mediaCard, { width: cardWidth }]}>
              {failedMedia.has(item.id) ? <View style={styles.mediaFallback}><BthwaniIcon name="warning" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.cardTitle}>{item.titleAr}</Text>{item.bodyAr ? <Text style={styles.muted}>{item.bodyAr}</Text> : null}<Text style={styles.mediaFallbackHint}>تعذر تحميل الصورة. اضغط لعرض التفاصيل.</Text></View> : <>
                <Image accessibilityLabel={`صورة ${item.titleAr}`} onError={() => setFailedMedia((current) => new Set(current).add(item.id))} source={{ uri: item.mediaUri }} style={styles.mediaImage} resizeMode="cover" />
                <View pointerEvents="none" style={styles.mediaCaption}>
                  <Text numberOfLines={1} style={styles.mediaCaptionTitle}>{item.titleAr}</Text>
                  {item.bodyAr ? <Text numberOfLines={1} style={styles.mediaCaptionBody}>{item.bodyAr}</Text> : null}
                </View>
              </>}
            </View>
          );
          return <Pressable accessibilityHint="يفتح تفاصيل المحتوى أو وجهته المرتبطة" accessibilityLabel={`عرض ${item.titleAr}`} accessibilityRole="button" key={item.id} onPress={() => onOpen(item)}>{card}</Pressable>;
        })}
      </ScrollView>
      {items.length > 1 ? <View accessibilityLabel={`اختيار شريحة العرض، ${activeIndex + 1} من ${items.length}`} style={styles.carouselDots}>{items.map((item, index) => <Pressable accessibilityLabel={`عرض الشريحة ${index + 1}: ${item.titleAr}`} accessibilityRole="button" accessibilityState={{ selected: index === activeIndex }} hitSlop={8} key={item.id} onPress={() => selectSlide(index)}><View style={[styles.carouselDot, index === activeIndex && styles.carouselDotActive]} /></Pressable>)}</View> : null}
    </View>
  );
}
