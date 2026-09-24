import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CatalogCategory, type CatalogStoreOffer, type DiscoveryContentView, formatMoney, type PromotionView, type PublicStoreView } from "@bthwani/dsh";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nManager, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { recordDiscoveryClick, recordDiscoveryImpression } from "./discovery-analytics";
import { listFavoriteStoreIDs, listOwnDeliveryAddresses, listPublicDiscoveryContent, listPublicPromotions, listPublishedStores, searchPublicCatalog, setFavoriteStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView>; categories: ReadonlyArray<CatalogCategory>; favoriteStoreIDs: ReadonlyArray<string> }
  | { kind: "empty" }
  | { kind: "error" };

type ProductSearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; offers: ReadonlyArray<CatalogStoreOffer>; nextCursor: string | null }
  | { kind: "error" };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined }) {
  const router = useRouter();
  const { q: rawQuery, focus: rawFocus, scope: rawScope } = useLocalSearchParams<{ q?: string | string[]; focus?: string | string[]; scope?: string | string[] }>();
  const query = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const focus = Array.isArray(rawFocus) ? rawFocus[0] ?? "" : rawFocus ?? "";
  const requestedScope = Array.isArray(rawScope) ? rawScope[0] ?? "" : rawScope ?? "";
  const searchScope = requestedScope === "products" ? "products" : "stores";
  const searchIsActive = focus === "search" || Boolean(query.trim());
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
  const [selectedCategoryID, setSelectedCategoryID] = useState("");
  const [favoriteBusyStoreID, setFavoriteBusyStoreID] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [productSearch, setProductSearch] = useState<ProductSearchState>({ kind: "idle" });
  const [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const [loadMoreProductsError, setLoadMoreProductsError] = useState(false);
  const [failedProductImages, setFailedProductImages] = useState<ReadonlySet<string>>(() => new Set());
  const productSearchRequestID = useRef(0);
  const [marketing, setMarketing] = useState<{ content: ReadonlyArray<DiscoveryContentView>; promotions: ReadonlyArray<PromotionView>; error: boolean }>({ content: [], promotions: [], error: false });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setFavoriteError("");
    try {
      if (!selectedCityID) {
        setState({ kind: "empty" });
        return;
      }
      let location: { latitude: number; longitude: number } | undefined;
      if (isAuthenticated) {
        try {
          const address = (await listOwnDeliveryAddresses()).addresses[0];
          if (address && Number.isFinite(address.latitude) && Number.isFinite(address.longitude)) location = { latitude: address.latitude, longitude: address.longitude };
        } catch {
          // The nearest filter explains the missing address without blocking discovery.
        }
      }
      const storeDirectory = await listPublishedStores(selectedCityID, location);
      const marketingResults = await Promise.allSettled([listPublicDiscoveryContent(selectedCityID), listPublicPromotions(selectedCityID)]);
      const content = marketingResults[0].status === "fulfilled" ? marketingResults[0].value.items : [];
      const promotions = marketingResults[1].status === "fulfilled" ? marketingResults[1].value.promotions : [];
      setMarketing({ content, promotions, error: marketingResults.some((result) => result.status === "rejected") });
      setSelectedCategoryID("");
      let favoriteStoreIDs: ReadonlyArray<string> = [];
      if (isAuthenticated) {
        try {
          favoriteStoreIDs = await listFavoriteStoreIDs();
        } catch {
          setFavoriteError("تعذر تحديث قائمة المفضلة. يمكنك متابعة تصفح المتاجر.");
        }
      }
      setState(storeDirectory.stores.length ? { kind: "ready", stores: storeDirectory.stores, categories: storeDirectory.categories, favoriteStoreIDs } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, [isAuthenticated, selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  const runProductSearch = useCallback(async () => {
    const normalizedQuery = query.trim();
    if (searchScope !== "products" || !selectedCityID || !normalizedQuery) return;
    const requestID = ++productSearchRequestID.current;
    setProductSearch({ kind: "loading" });
    setLoadingMoreProducts(false);
    setLoadMoreProductsError(false);
    try {
      const result = await searchPublicCatalog(selectedCityID, normalizedQuery, selectedCategoryID, 20);
      if (productSearchRequestID.current === requestID) setProductSearch({ kind: "ready", offers: result.offers, nextCursor: result.nextCursor });
    } catch {
      if (productSearchRequestID.current === requestID) setProductSearch({ kind: "error" });
    }
  }, [query, searchScope, selectedCategoryID, selectedCityID]);

  useEffect(() => {
    if (searchScope !== "products" || !selectedCityID || !query.trim()) {
      productSearchRequestID.current += 1;
      setProductSearch({ kind: "idle" });
      setLoadingMoreProducts(false);
      setLoadMoreProductsError(false);
      return;
    }
    const timer = setTimeout(() => { void runProductSearch(); }, 300);
    return () => {
      clearTimeout(timer);
      productSearchRequestID.current += 1;
    };
  }, [query, runProductSearch, searchScope, selectedCityID]);

  const filteredStores = useMemo(() => {
    if (state.kind !== "ready") return [];
    const stores = state.stores.filter((store) => (storeFilter !== "favorites" || state.favoriteStoreIDs.includes(store.id)) && (storeFilter !== "nearest" || typeof store.distanceMeters === "number") && (!selectedCategoryID || store.categoryIds.includes(selectedCategoryID)));
    if (storeFilter === "newest") stores.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    if (storeFilter === "nearest") stores.sort((left, right) => (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return stores;
    return stores.filter((store) => store.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, selectedCategoryID, state, storeFilter]);

  const visibleCategories = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.categories;
  }, [state]);

  const mediaContent = useMemo(() => marketing.content.filter((item) => Boolean(item.mediaUri) && (item.kind === "BANNER" || item.kind === "CAROUSEL")).slice(0, 8), [marketing.content]);
  const textContent = useMemo(() => marketing.content.filter((item) => !item.mediaUri || (item.kind !== "BANNER" && item.kind !== "CAROUSEL")).slice(0, 4), [marketing.content]);

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

  async function loadMoreProductOffers() {
    if (productSearch.kind !== "ready" || !productSearch.nextCursor || loadingMoreProducts || !selectedCityID || !query.trim()) return;
    const cursor = productSearch.nextCursor;
    const requestID = ++productSearchRequestID.current;
    setLoadingMoreProducts(true);
    setLoadMoreProductsError(false);
    try {
      const result = await searchPublicCatalog(selectedCityID, query.trim(), selectedCategoryID, 20, cursor);
      if (productSearchRequestID.current === requestID) {
        setProductSearch((current) => current.kind === "ready" ? { kind: "ready", offers: [...current.offers, ...result.offers], nextCursor: result.nextCursor } : current);
      }
    } catch {
      if (productSearchRequestID.current === requestID) setLoadMoreProductsError(true);
    } finally {
      if (productSearchRequestID.current === requestID) setLoadingMoreProducts(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <View style={styles.state} accessibilityLabel="جارٍ تجهيز الاكتشاف">
        <View style={styles.stateHeader}><BthwaniSkeleton width={sizing.avatarLg} height={sizing.avatarLg} style={styles.skeletonRound} /><View style={styles.stateCopy}><BthwaniSkeleton width="58%" height={20} /><BthwaniSkeleton width="86%" height={16} /></View></View>
        <BthwaniSkeleton height={sizing.controlLg} />
        <BthwaniSkeleton height={112} />
        <BthwaniSkeleton height={112} />
      </View>
    );
  }

  if (state.kind === "error") {
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر تجهيز الاكتشاف</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} variant="secondary" /> : null}</View>;
  }

  if (state.kind === "empty") {
    return <View style={styles.state}><View style={styles.emptyIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconXl} /></View><Text style={styles.title}>{selectedCityID ? "لا توجد متاجر متاحة بعد" : "اختر مدينة للبدء"}</Text><Text style={styles.muted}>{selectedCityID ? "لا توجد متاجر منشورة للطلب حاليًا." : "تظهر المتاجر بحسب مدينة الخدمة التي تختارها."}</Text><BthwaniButton label="تحديث المتاجر" onPress={() => void load()} variant="secondary" />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} /> : null}</View>;
  }

  return (
    <View
      style={styles.container}
      accessibilityLabel="اكتشاف المتاجر"
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        setDiscoveryContainerWidth((current) => Math.abs(current - nextWidth) < 1 ? current : nextWidth);
      }}
    >
      <View style={styles.discoveryHeading}>
        <Text style={styles.discoveryTitle}>{searchIsActive ? "ابحث في بثواني" : "اكتشف المتاجر والمنتجات"}</Text>
        <Text style={styles.discoverySubtitle}>{selectedCityName ? `نتائج مدينة ${selectedCityName}` : "اختر مدينة الخدمة لعرض النتائج المتاحة"}</Text>
      </View>

      {searchIsActive ? <View accessibilityLabel="نطاق البحث" style={styles.searchScopes}>
        <BthwaniChip label="المتاجر" selected={searchScope === "stores"} onPress={() => router.setParams({ scope: "stores" })} />
        <BthwaniChip label="المنتجات" selected={searchScope === "products"} onPress={() => router.setParams({ scope: "products" })} />
      </View> : null}

      {!searchIsActive && isAuthenticated ? <BthwaniSurface tone="inset" style={styles.multiStoreCta}><View style={styles.multiStoreCopy}><Text style={styles.eyebrow}>تجربة موحّدة</Text><Text style={styles.cardTitle}>اطلب من عدة متاجر</Text><Text style={styles.muted}>اجمع السلال، وأنشئ طلبًا مستقلًا لكل متجر مع نتيجة واضحة.</Text></View><BthwaniButton label="فتح الطلب المتعدد" onPress={() => router.push("/multi-store-checkout" as Href)} variant="secondary" /></BthwaniSurface> : null}

      {visibleCategories.length ? <View style={styles.categoryShortcutBlock}>
        <BthwaniSectionHeader title={searchScope === "products" && searchIsActive ? "تصفية المنتجات بالفئة" : "تسوق حسب الفئات"} />
        <ScrollView accessibilityLabel="اختصارات فئات المنتجات المتاحة" contentContainerStyle={styles.categoryShortcutContent} horizontal showsHorizontalScrollIndicator={false}>
          <BthwaniChip label="كل الفئات" selected={!selectedCategoryID} onPress={() => setSelectedCategoryID("")} />
          {visibleCategories.map((category) => <BthwaniChip key={category.id} label={category.nameAr} selected={selectedCategoryID === category.id} onPress={() => setSelectedCategoryID(category.id)} />)}
        </ScrollView>
      </View> : null}

      {!searchIsActive && (marketing.content.length || marketing.promotions.length) ? <View accessibilityLabel="العروض ومحتوى الاكتشاف" style={styles.marketingBlock}>
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
          <View style={styles.marketingList}>{textContent.map((item) => <BthwaniSurface key={item.id} tone="inset" style={styles.marketingCard}><Text style={styles.eyebrow}>{item.kind === "BANNER" ? "إعلان" : item.kind === "CAROUSEL" ? "اختيارات" : "قصة قصيرة"}</Text><Text style={styles.cardTitle}>{item.titleAr}</Text>{item.bodyAr ? <Text style={styles.muted}>{item.bodyAr}</Text> : null}</BthwaniSurface>)}</View>
        </> : null}
        {marketing.promotions.length ? <>
          <BthwaniSectionHeader title="عروض نشطة" subtitle="طبّق الرمز عند إتمام الطلب" />
          <View style={styles.marketingList}>{marketing.promotions.slice(0, 4).map((promotion) => <BthwaniSurface key={promotion.id} tone="raised" style={styles.promotionCard}><View style={styles.promotionCopy}><Text style={styles.cardTitle}>{promotion.nameAr}</Text><Text style={styles.muted}>{promotion.descriptionAr || (promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم بقيمة ${promotion.valueMinor}`)}</Text></View><Text accessibilityLabel={`رمز العرض ${promotion.code}`} style={styles.promotionCode}>{promotion.code}</Text></BthwaniSurface>)}</View>
        </> : null}
      </View> : !searchIsActive && marketing.error ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل بعض العروض والمحتوى. يمكنك متابعة تصفح المتاجر.</Text> : null}

      {searchScope === "products" && searchIsActive ? <View accessibilityLabel="نتائج البحث عن المنتجات" style={styles.productSearchSection}>
        {!query.trim() ? <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>اكتب اسم المنتج للبحث</Text><Text style={styles.muted}>استخدم مربع البحث أعلى الصفحة، ويمكنك تضييق النتائج حسب الفئة.</Text></BthwaniSurface> : productSearch.kind === "loading" || productSearch.kind === "idle" ? <View style={styles.productSkeletons} accessibilityLabel="جارٍ البحث عن المنتجات"><BthwaniSkeleton height={104} /><BthwaniSkeleton height={104} /><BthwaniSkeleton height={104} /></View> : productSearch.kind === "error" ? <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" style={styles.cardTitle}>تعذر البحث عن المنتجات</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void runProductSearch()} /></BthwaniSurface> : productSearch.offers.length === 0 ? <BthwaniSurface tone="inset" style={styles.noResults}><BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} /><Text style={styles.cardTitle}>لا توجد منتجات مطابقة</Text><Text style={styles.muted}>جرّب كلمة أقصر أو اختر فئة أخرى.</Text><BthwaniButton label="مسح الفئة" onPress={() => setSelectedCategoryID("")} variant="quiet" /></BthwaniSurface> : <>
          <BthwaniSectionHeader title="نتائج المنتجات" subtitle={`${productSearch.offers.length} منتج · ${selectedCityName || "مدينة الخدمة"}`} />
          <View style={styles.list}>{productSearch.offers.map((offer) => {
            const store = state.kind === "ready" ? state.stores.find((candidate) => candidate.id === offer.storeId) : undefined;
            const primaryMedia = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
            const imageFailed = failedProductImages.has(offer.offerId);
            return <Pressable accessibilityRole="button" accessibilityLabel={`فتح ${offer.productName}${store ? ` من متجر ${store.name}` : ""}`} key={offer.offerId} onPress={() => router.push((`/store/${encodeURIComponent(offer.storeId)}?productId=${encodeURIComponent(offer.productId)}`) as Href)} style={({ pressed }) => [styles.productCard, pressed && styles.pressed]}>
              {primaryMedia && !imageFailed ? <Image accessibilityLabel={`صورة ${offer.productName}`} onError={() => setFailedProductImages((current) => new Set(current).add(offer.offerId))} source={{ uri: primaryMedia.uri }} style={styles.productImage} resizeMode="cover" /> : <View style={styles.productImageFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>}
              <View style={styles.productCopy}>
                <Text style={styles.productTitle} numberOfLines={2}>{offer.productName}</Text>
                {offer.variantTitle.trim() ? <Text style={styles.storeMeta} numberOfLines={1}>{offer.variantTitle}</Text> : null}
                <Text style={styles.storeMeta} numberOfLines={1}>{store?.name ?? "متجر مشارك"}</Text>
                <Text style={offer.availability ? styles.productAvailability : styles.storeHint}>{offer.availability ? "متاح حسب آخر تحديث" : "تحقق من التوفر داخل المتجر"}</Text>
              </View>
              <View style={styles.productPriceBlock}><Text style={styles.productPrice}>{formatMoney(offer.priceMinor, offer.currency)}</Text><BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} /></View>
            </Pressable>;
          })}</View>
          {loadMoreProductsError ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل المزيد من المنتجات.</Text> : null}
          {productSearch.nextCursor ? <BthwaniButton disabled={loadingMoreProducts} label={loadingMoreProducts ? "جارٍ تحميل المزيد" : "تحميل المزيد"} onPress={() => void loadMoreProductOffers()} variant="secondary" /> : null}
        </>}
      </View> : null}

      {searchScope === "stores" || !searchIsActive ? <>
      <BthwaniSectionHeader title={searchIsActive ? "نتائج المتاجر" : "المتاجر المتاحة"} subtitle={`${filteredStores.length} متجر`} />
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
            const hasDistance = state.kind === "ready" && state.stores.some((store) => typeof store.distanceMeters === "number");
            if (!hasDistance) {
              setFavoriteError("احفظ عنوان توصيل بموقع جغرافي لاستخدام ترتيب الأقرب.");
              return;
            }
            setFavoriteError("");
            setStoreFilter("nearest");
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

      {filteredStores.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.noResults}>
          <BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} />
          <Text style={styles.cardTitle}>{query.trim() ? "لا توجد نتائج بهذا الاسم" : selectedCategoryID ? "لا توجد متاجر ضمن هذه الفئة" : "لا توجد متاجر مطابقة"}</Text>
          <Text style={styles.muted}>{query.trim() ? "جرّب اسمًا أقصر أو امسح البحث لعرض كل المتاجر." : "غيّر الفئة أو أزل الفلاتر لعرض المتاجر المتاحة."}</Text>
          {query.trim() ? <BthwaniButton label="مسح البحث" onPress={() => router.setParams({ q: "" })} variant="quiet" /> : null}
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {filteredStores.map((store) => {
            const isFavorite = state.favoriteStoreIDs.includes(store.id);
            return (
              <Pressable
                key={store.id}
                accessibilityRole="button"
                accessibilityLabel={`فتح متجر ${store.name}`}
                onPress={() => router.push(`/store/${encodeURIComponent(store.id)}` as Href)}
                style={({ pressed }) => [styles.storeCard, pressed && styles.pressed]}
              >
                {store.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${store.name}`} source={{ uri: store.storeProfileImage.uri }} style={styles.storeImage} resizeMode="cover" /> : <View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>}
                <View style={styles.storeCopy}><Text style={styles.storeTitle} numberOfLines={2}>{store.name}</Text><Text style={styles.storeMeta}>{typeof store.distanceMeters === "number" ? `${(store.distanceMeters / 1000).toFixed(2)} كم` : selectedCityName || "مدينة الخدمة"}</Text><Text style={styles.storeRating}>{store.ratingCount > 0 ? `★ ${store.ratingAverage.toFixed(1)} (${store.ratingCount})` : "لا توجد تقييمات بعد"}</Text><Text style={styles.storeHint}>افتح المتجر لتصفح الكتالوج والتحقق من التوفر</Text></View>
                <View style={styles.storeActions}>
                  <BthwaniIconButton
                    disabled={Boolean(favoriteBusyStoreID)}
                    icon="favorite"
                    label={isFavorite ? `إزالة ${store.name} من المفضلة` : `إضافة ${store.name} إلى المفضلة`}
                    onPress={(event) => {
                      event.stopPropagation();
                      void toggleFavorite(store.id);
                    }}
                    tone={isFavorite ? "primary" : "soft"}
                  />
                  <BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      </> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    discoveryHeading: { gap: spacing[1] },
    discoveryTitle: { ...typography.titleLg, color: theme.color, textAlign: "right" },
    discoverySubtitle: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
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
    storeCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], minHeight: 100, padding: spacing[3], ...elevation.raised },
    storeActions: { alignItems: "center", flexDirection: "row", gap: spacing[1] },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeImage: { borderRadius: radius.md, height: sizing.avatarLg, width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    storeTitle: { ...typography.titleSm, color: theme.color },
    storeMeta: { ...typography.bodySm, color: theme.interactiveText },
    storeRating: { ...typography.bodySm, color: theme.warning },
    storeHint: { ...typography.caption, color: theme.colorMuted },
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
    categoryShortcutContent: { alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[1] },
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
    carouselDots: { alignItems: "center", flexDirection: "row", gap: spacing[1], justifyContent: "center" },
    carouselDot: { backgroundColor: theme.borderColorStrong, borderRadius: radius.round, height: 6, width: 6 },
    carouselDotActive: { backgroundColor: theme.actionBackground, height: 8, width: 18 },
    promotionCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    promotionCopy: { flex: 1, gap: spacing[1] },
    promotionCode: { ...typography.label, backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.interactiveText, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    multiStoreCta: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[3] },
    multiStoreCopy: { gap: spacing[1] },
  });
}

function DiscoveryMediaCarousel({ cardWidth, items, styles, theme, onOpen }: { cardWidth: number; items: ReadonlyArray<DiscoveryContentView>; styles: ReturnType<typeof createStyles>; theme: ReturnType<typeof resolveTheme>; onOpen: (item: DiscoveryContentView) => void }) {
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
          const actionable = item.targetType !== "INFO";
          const card = (
            <View key={item.id} style={[styles.mediaCard, { width: cardWidth }]}>
              {failedMedia.has(item.id) ? <View style={styles.mediaFallback}><BthwaniIcon name="warning" color={theme.interactiveText} size={sizing.iconXl} /><Text style={styles.cardTitle}>{item.titleAr}</Text><Text style={styles.muted}>تعذر تحميل الصورة، افتح المحتوى النصي بدلًا منها.</Text></View> : <>
                <Image accessibilityLabel={`صورة ${item.titleAr}`} onError={() => setFailedMedia((current) => new Set(current).add(item.id))} source={{ uri: item.mediaUri }} style={styles.mediaImage} resizeMode="cover" />
                <View pointerEvents="none" style={styles.mediaCaption}>
                  <Text numberOfLines={1} style={styles.mediaCaptionTitle}>{item.titleAr}</Text>
                  {item.bodyAr ? <Text numberOfLines={1} style={styles.mediaCaptionBody}>{item.bodyAr}</Text> : null}
                </View>
              </>}
            </View>
          );
          return actionable ? <Pressable accessibilityHint="يفتح الوجهة المرتبطة بالمحتوى" accessibilityLabel={`فتح ${item.titleAr}`} accessibilityRole="button" key={item.id} onPress={() => onOpen(item)}>{card}</Pressable> : <View accessibilityLabel={item.titleAr} key={item.id}>{card}</View>;
        })}
      </ScrollView>
      {items.length > 1 ? <View accessibilityLabel={`اختيار شريحة العرض، ${activeIndex + 1} من ${items.length}`} style={styles.carouselDots}>{items.map((item, index) => <Pressable accessibilityLabel={`عرض الشريحة ${index + 1}: ${item.titleAr}`} accessibilityRole="button" accessibilityState={{ selected: index === activeIndex }} hitSlop={8} key={item.id} onPress={() => selectSlide(index)}><View style={[styles.carouselDot, index === activeIndex && styles.carouselDotActive]} /></Pressable>)}</View> : null}
    </View>
  );
}
