import { borders, radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, formatQuantity, IndependentStoreUnavailable, listPublishedIndependentWebCatalog, readPublishedIndependentWebStore, type IndependentPublicStore, type IndependentPublicCatalog, type PublicCatalogResponse, type PublicDiscoveryContentView, type PublicStoreView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { Link, type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ScrollViewInstance } from "react-native";

import { clientStorefrontCartPath } from "../access/client-auth-return-path";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { mergeCatalog } from "./store-catalog-model";
import { listPublicStoreBanners, readPublicStoreCatalog, readPublishedStore } from "./store-discovery-client";
import { buildFullStorefrontPath, resolveFullStorefrontCityID, storefrontColumns, verifiedMarketplaceStoreRead, visiblePublishedOffers } from "./full-storefront-model";
import { StorePublicContactCard } from "./store-public-contact";
import { storeReadFailureKind } from "./store-read-state";
import { buildStoreSharePath } from "./store-share-link";

type SiteState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; relation: "marketplace"; store: PublicStoreView; catalog: PublicCatalogResponse }
  | { kind: "ready"; relation: "independent"; store: IndependentPublicStore; catalog: IndependentPublicCatalog };

type SiteBanner = PublicDiscoveryContentView;

export default function ClientFullStorefront({ storeId, linkedCityID, categoryID, productID, initialQuery }: Readonly<{
  storeId: string; linkedCityID: string; categoryID: string; productID: string; initialQuery: string;
}>) {
  const { cities, selectedCityID: savedCityID, selectCity } = useServiceCityScope();
  const selectedCityID = resolveFullStorefrontCityID(linkedCityID, savedCityID, cities);
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const signedIn = useSyncExternalStore(subscribeIdentitySession, () => currentIdentityState().kind === "authenticated", () => false);
  const { width } = useWindowDimensions();
  const readID = useRef(0);
  const routeFocusedRef = useRef(false);
  const catalogID = useRef(0);
  const catalogRetryOrigin = useRef<"filter" | "page">("filter");
  const catalogRetrySearch = useRef(initialQuery);
  const bannerID = useRef(0);
  const openingMarketRef = useRef(false);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const productsOffset = useRef(0);
  const contactOffset = useRef(0);
  const [state, setState] = useState<SiteState>({ kind: "loading" });
  const [banners, setBanners] = useState<ReadonlyArray<SiteBanner>>([]);
  const [bannerError, setBannerError] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marketCityError, setMarketCityError] = useState(false);
  const [openingMarket, setOpeningMarket] = useState(false);
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(new Set());

  const hideWithdrawnStore = useCallback(() => {
    // A definitive DSH publication denial invalidates every in-flight public read.
    ++readID.current;
    ++catalogID.current;
    ++bannerID.current;
    setState({ kind: "unavailable" });
    setBanners([]);
    setCatalogError(false);
    setBannerError(false);
  }, []);

  const storefrontPath = (scope?: Parameters<typeof buildFullStorefrontPath>[2]) =>
    buildFullStorefrontPath(storeId, selectedCityID ?? "", scope) as Href;

  const refreshBanners = useCallback(async (storeGeneration: number, relation: "marketplace" | "independent") => {
    if (!storeId || !selectedCityID) return;
    const generation = ++bannerID.current;
    try {
      const response = await listPublicStoreBanners(storeId, selectedCityID, relation);
      if (generation !== bannerID.current || storeGeneration !== readID.current) return;
      setBanners(response.items.filter((item) => item.kind === "BANNER" && item.mediaKind === "image" && Boolean(item.mediaUri)));
      setBannerError(false);
    } catch (cause) {
      if (generation !== bannerID.current || storeGeneration !== readID.current) return;
      if (storeReadFailureKind(cause) === "unavailable") hideWithdrawnStore();
      else setBannerError(true);
    }
  }, [hideWithdrawnStore, selectedCityID, storeId]);

  const load = useCallback(async () => {
    const generation = ++readID.current;
    ++catalogID.current;
    ++bannerID.current;
    setState({ kind: "loading" });
    setBanners([]);
    setBannerError(false);
    setQuery(initialQuery);
    setAppliedQuery(initialQuery);
    setCatalogBusy(false);
    setCatalogError(false);
    catalogRetryOrigin.current = "filter";
    catalogRetrySearch.current = initialQuery;
    setLoadingMore(false);
    setBrokenImages(new Set());
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "unavailable" });
      return;
    }
    try {
      // Marketplace and independent web publication are separate DSH facts.
      // Only a marketplace 404/403 permits trying the independent public reader.
      try {
        const [store, catalog] = await Promise.all([
          readPublishedStore(storeId, selectedCityID),
          readPublicStoreCatalog(storeId, selectedCityID, categoryID, initialQuery, 24, "", productID),
        ]);
        if (generation !== readID.current) return;
        if (!verifiedMarketplaceStoreRead(store, catalog, storeId, selectedCityID)) {
          setState({ kind: "unavailable" });
          return;
        }
        setState({ kind: "ready", relation: "marketplace", store, catalog });
        if (!productID) void refreshBanners(generation, "marketplace");
        return;
      } catch (cause) {
        if (storeReadFailureKind(cause) !== "unavailable") throw cause;
      }
      const base = process.env.EXPO_PUBLIC_DSH_API_URL ?? "";
      const store = await readPublishedIndependentWebStore(base, storeId, selectedCityID);
      const catalog = await listPublishedIndependentWebCatalog(base, storeId, selectedCityID, {
        categoryID, query: initialQuery, productID,
      });
      if (generation !== readID.current) return;
      setState({ kind: "ready", relation: "independent", store, catalog });
      if (!productID) void refreshBanners(generation, "independent");
    } catch (cause) {
      if (generation === readID.current) {
        setState({ kind: cause instanceof IndependentStoreUnavailable ? "unavailable" : storeReadFailureKind(cause) });
      }
    }
  }, [categoryID, initialQuery, productID, refreshBanners, selectedCityID, storeId]);

  // A public website is not a snapshot of the first visit. Recheck DSH
  // publication and Catalog whenever the Store route regains focus. A former
  // owner's or withdrawn Store's data must not remain visible on return.
  useFocusEffect(useCallback(() => {
    routeFocusedRef.current = true;
    openingMarketRef.current = false;
    setOpeningMarket(false);
    void load();
    return () => {
      routeFocusedRef.current = false;
      openingMarketRef.current = false;
      ++readID.current;
      ++catalogID.current;
      ++bannerID.current;
    };
  }, [load]));

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // Route focus does not fire when a customer returns to the same browser
    // tab after the merchant publishes a change in another tab/window.
    const refreshOnBrowserFocus = () => {
      if (routeFocusedRef.current && document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshOnBrowserFocus);
    return () => window.removeEventListener("focus", refreshOnBrowserFocus);
  }, [load]);

  const applyFilter = useCallback(async (search: string) => {
    if (!storeId || !selectedCityID) return;
    catalogRetryOrigin.current = "filter";
    catalogRetrySearch.current = search.trim();
    // A filter supersedes an in-flight page. Its stale finally cannot clear
    // loadingMore once the shared catalog generation has advanced.
    const generation = ++catalogID.current;
    setLoadingMore(false);
    setCatalogBusy(true);
    setCatalogError(false);
    try {
      if (state.kind !== "ready") return;
      if (state.relation === "independent") {
        const catalog = await listPublishedIndependentWebCatalog(
          process.env.EXPO_PUBLIC_DSH_API_URL ?? "", storeId, selectedCityID,
          { categoryID, productID, query: search.trim() },
        );
        if (generation !== catalogID.current) return;
        setState(previous => previous.kind === "ready" && previous.relation === "independent" &&
          previous.store.storeId === storeId && previous.store.serviceCityId === selectedCityID
          ? { ...previous, catalog } : previous);
      } else {
        const catalog = await readPublicStoreCatalog(storeId, selectedCityID, categoryID, search.trim(), 24);
        if (generation !== catalogID.current) return;
        if (catalog.storeId !== storeId) throw new Error("PUBLIC_CATALOG_STORE_MISMATCH");
        setState(previous => previous.kind === "ready" && previous.relation === "marketplace" &&
          previous.store.id === storeId && previous.store.serviceCity.id === selectedCityID
          ? { ...previous, catalog } : previous);
      }
      setAppliedQuery(search.trim());
    } catch (cause) {
      if (generation !== catalogID.current) return;
      if (storeReadFailureKind(cause) === "unavailable") hideWithdrawnStore();
      else setCatalogError(true);
    } finally {
      if (generation === catalogID.current) setCatalogBusy(false);
    }
  }, [categoryID, hideWithdrawnStore, productID, selectedCityID, state, storeId]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !selectedCityID || !state.catalog.nextCursor || catalogBusy || loadingMore) return;
    const generation = ++catalogID.current;
    const cursor = state.catalog.nextCursor;
    catalogRetryOrigin.current = "page";
    setLoadingMore(true);
    setCatalogError(false);
    try {
      if (state.relation === "independent") {
        // Recheck publication before merging a page into already visible content.
        await readPublishedIndependentWebStore(process.env.EXPO_PUBLIC_DSH_API_URL ?? "", storeId, selectedCityID);
        const next = await listPublishedIndependentWebCatalog(
          process.env.EXPO_PUBLIC_DSH_API_URL ?? "", storeId, selectedCityID,
          { categoryID, productID, query: appliedQuery, cursor },
        );
        if (generation !== catalogID.current) return;
        setState(previous => previous.kind === "ready" && previous.relation === "independent" &&
          previous.store.storeId === storeId && previous.store.serviceCityId === selectedCityID
          ? { ...previous, catalog: { ...next, offers: [...previous.catalog.offers, ...next.offers] } } : previous);
      } else {
        const next = await readPublicStoreCatalog(storeId, selectedCityID, categoryID, appliedQuery, 24, cursor, productID);
        if (generation !== catalogID.current) return;
        if (next.storeId !== storeId || next.nextCursor === cursor) throw new Error("PUBLIC_CATALOG_PAGE_MISMATCH");
        setState(previous => previous.kind === "ready" && previous.relation === "marketplace" &&
          previous.store.id === storeId && previous.store.serviceCity.id === selectedCityID
          ? { ...previous, catalog: mergeCatalog(previous.catalog, next) } : previous);
      }
    } catch (cause) {
      if (generation !== catalogID.current) return;
      if (storeReadFailureKind(cause) === "unavailable") hideWithdrawnStore();
      else setCatalogError(true);
    } finally {
      if (generation === catalogID.current) setLoadingMore(false);
    }
  }, [appliedQuery, catalogBusy, categoryID, hideWithdrawnStore, loadingMore, productID, selectedCityID, state, storeId]);

  const ready = state.kind === "ready" &&
    (state.relation === "marketplace" ? state.store.id === storeId &&
      state.store.serviceCity.id === selectedCityID : state.store.storeId === storeId &&
      state.store.serviceCityId === selectedCityID) ? state : null;
  const columns = productID ? (width < 720 ? 1 : 2) : storefrontColumns(width);
  const siteWidth = Math.min(width, 1240);
  const innerWidth = Math.max(0, siteWidth - spacing[4] * 2);
  const cardWidth = Math.max(0, Math.floor((innerWidth - (columns - 1) * spacing[3]) / columns));
  const offers = ready?.relation === "marketplace"
    ? visiblePublishedOffers(ready.catalog.offers, storeId, productID).map(offer => ({
        ...offer, priceUnitLabel: formatQuantity(offer.baseUnit, offer.pricingUnitBaseUnits),
      }))
    : ready?.relation === "independent"
      ? ready.catalog.offers.filter(offer => !productID || offer.productId === productID).map(offer => ({
          ...offer, priceUnitLabel: formatQuantity(offer.baseUnit, offer.pricingUnitBaseUnits),
        })) : [];
  const categories = ready ? ready.catalog.categories.filter((category) => category.active) : [];
  const openMarketRoute = async (path: Href) => {
    // React state is not a synchronous lock: two taps can arrive before render.
    if (!selectedCityID || openingMarketRef.current) return;
    openingMarketRef.current = true;
    setOpeningMarket(true);
    setMarketCityError(false);
    let navigated = false;
    try {
      if (selectedCityID !== savedCityID) {
        const generation = readID.current;
        await selectCity(selectedCityID);
        if (generation !== readID.current) return;
      }
      router.push(path);
      navigated = true;
    } catch {
      setMarketCityError(true);
    } finally {
      // Keep the lock until the route loses focus; release on failed handoff.
      if (!navigated) {
        openingMarketRef.current = false;
        setOpeningMarket(false);
      }
    }
  };
  const marketplacePath = (requestedProductID = "") =>
    ("/" + buildStoreSharePath(storeId, selectedCityID ?? "", requestedProductID)) as Href;
  const jumpTo = (offset: number) => scrollRef.current?.scrollTo({ y: Math.max(0, offset - spacing[3]), animated: true });

  if (!ready) {
    if (state.kind === "loading" || state.kind === "ready") {
      return <View style={styles.readState} accessibilityLabel="جارٍ تحميل موقع المتجر"><BthwaniSkeleton width="70%" height={35} /><BthwaniSkeleton height={180} /><BthwaniSkeleton height={160} /></View>;
    }
    return <View style={styles.readState}>
      <BthwaniIcon name={state.kind === "unavailable" ? "store" : "warning"} color={theme.colorMuted} size={32} />
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>{state.kind === "unavailable" ? "هذا المتجر غير متاح" : "تعذر قراءة موقع المتجر"}</Text>
      <Text style={styles.secondary}>{state.kind === "unavailable" ? "قد يكون المتجر غير منشور أو خارج مدينة الخدمة." : "تحقق من الاتصال وأعد المحاولة."}</Text>
      {state.kind === "error" ? <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} /> : null}
      <BthwaniButton label="العودة إلى سوق بثواني" variant="secondary" onPress={() => router.replace("/home" as Href)} />
    </View>;
  }

  const store = ready.store;
  const isMarketplace = ready.relation === "marketplace";
  const cover = ready.relation === "marketplace" ? ready.store.storeCoverImage?.uri : ready.store.coverImageUri;
  const profile = ready.relation === "marketplace" ? ready.store.storeProfileImage?.uri : ready.store.profileImageUri;
  const product = productID ? offers[0] : undefined;
  const cityName = ready.relation === "marketplace" ? ready.store.serviceCity.displayNameAr :
    cities.find(city => city.id === selectedCityID)?.displayNameAr ?? "";
  const marketCitySuffix = isMarketplace && selectedCityID !== savedCityID ? " في " + cityName : "";
  const siteLoginPath = "/?returnTo=" + encodeURIComponent(buildFullStorefrontPath(storeId, selectedCityID ?? "", { productID }));

  return <ScrollView
    ref={scrollRef}
    role="main"
    contentContainerStyle={styles.screen}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false}
  >
    <View style={styles.content}>
      <View style={styles.masthead}>
        {isMarketplace ? <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى سوق بثواني" onPress={() => router.push("/home" as Href)} style={styles.brandButton}>
          <Text style={styles.brand}>بثواني</Text>
        </Pressable> : <Text style={styles.brand}>بثواني</Text>}
        <View style={styles.navigation} accessibilityLabel="أقسام موقع المتجر">
          <Pressable accessibilityRole="button" onPress={() => jumpTo(0)} style={styles.navItem}><Text style={styles.navText}>الرئيسية</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => jumpTo(productsOffset.current)} style={styles.navItem}><Text style={styles.navText}>المنتجات</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => jumpTo(contactOffset.current)} style={styles.navItem}><Text style={styles.navText}>التواصل</Text></Pressable>
        </View>
        {isMarketplace ? <BthwaniButton label={"سلة المتجر" + marketCitySuffix} busy={openingMarket} onPress={() => void openMarketRoute(clientStorefrontCartPath(storeId, selectedCityID ?? "", productID) as Href)} /> : <Text style={styles.secondary}>الطلب المباشر غير متاح حتى اعتماد خدمة المتجر.</Text>}
        {isMarketplace ? <BthwaniButton label={signedIn ? "حسابي" : "تسجيل الدخول"} variant="secondary"
          onPress={() => router.push((signedIn ? "/account" : siteLoginPath) as Href)} /> : null}
      </View>
      {isMarketplace && marketCityError ? <Text accessibilityRole="alert" style={styles.secondary}>تعذر اختيار مدينة المتجر. أعد المحاولة.</Text> : null}

      {!productID ? <View accessibilityLabel={"واجهة متجر " + store.name} style={styles.hero}>
        {cover && !brokenImages.has(cover)
          ? <ExpoImage cachePolicy="disk" accessibilityLabel={"غلاف متجر " + store.name} source={{ uri: cover }} contentFit="cover" style={styles.cover} onError={() => setBrokenImages((prev) => new Set(prev).add(cover))} />
          : <View style={styles.coverFallback}><BthwaniIcon name="store" color={theme.colorMuted} size={48} /></View>}
      </View> : null}
      <BthwaniSurface tone="raised" style={styles.identityCard}>
        <View style={styles.identityRow}>
          {profile && !brokenImages.has(profile)
            ? <ExpoImage cachePolicy="disk" accessibilityLabel={"شعار متجر " + store.name} source={{ uri: profile }} contentFit="contain" style={styles.logo} onError={() => setBrokenImages((prev) => new Set(prev).add(profile))} />
            : <View style={styles.logoFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={26} /></View>}
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" style={styles.storeName}>{store.name}</Text>
            {ready.relation === "marketplace" && ready.store.addressLine?.trim() ? <Text style={styles.secondary}>{ready.store.addressLine.trim()}</Text> : null}
            <Text style={styles.secondary}>مدينة الخدمة: {cityName}</Text>
          </View>
        </View>
        {ready.relation === "marketplace" && ready.store.ratingCount > 0
          ? <Text accessibilityLabel={"تقييم المتجر " + ready.store.ratingAverage.toFixed(1) + " من خمسة"} style={styles.secondary}>★ {ready.store.ratingAverage.toFixed(1)} · {ready.store.ratingCount} تقييم</Text>
          : null}
      </BthwaniSurface>

      {bannerError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.secondary}>تعذر تحديث بنرات المتجر. يمكنك متابعة التصفح.</Text><BthwaniButton label="إعادة قراءة البنرات" variant="secondary" onPress={() => void refreshBanners(readID.current, state.kind === "ready" ? state.relation : "marketplace")} /></View> : null}
      {banners.length > 0 ? <View style={styles.section} accessibilityLabel="بنرات المتجر المنشورة">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bannerRail}>
          {banners.map((banner) => {
            const bannerUri = banner.mediaUri ?? "";
            return <View key={banner.id} style={[styles.banner, { width: Math.min(420, Math.max(260, innerWidth)) }]}>
              {bannerUri && !brokenImages.has(bannerUri)
                ? <ExpoImage cachePolicy="disk" source={{ uri: bannerUri }} accessibilityLabel={"بنر " + banner.titleAr} contentFit="cover" style={styles.bannerImage} onError={() => setBrokenImages((previous) => new Set(previous).add(bannerUri))} />
                : <View style={[styles.bannerImage, styles.coverFallback]} accessibilityLabel={"تعذر تحميل بنر " + banner.titleAr}>
                  <BthwaniIcon name="store" color={theme.colorMuted} size={26} />
                  <Text style={styles.secondary}>صورة البنر غير متوفرة</Text>
                </View>}
              <Text style={styles.bannerTitle} numberOfLines={2}>{banner.titleAr}</Text>
              {banner.bodyAr?.trim() ? <Text style={styles.secondary} numberOfLines={2}>{banner.bodyAr}</Text> : null}
            </View>;
          })}
        </ScrollView>
      </View> : null}

      <View style={styles.section} onLayout={(event) => { productsOffset.current = event.nativeEvent.layout.y; }}>
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.title}>{productID ? product?.productName ?? "المنتج غير متاح" : "منتجات المتجر"}</Text>
          {product?.productDescription?.trim() ? <Text style={styles.secondary}>{product.productDescription}</Text> : null}
          {!productID ? <Text style={styles.secondary}>المنتجات المنشورة لدى {store.name}</Text> : null}
        </View>
        {productID ? <View style={styles.navigation}>
          <Link href={storefrontPath()} style={styles.navItem}><Text style={styles.navText}>عرض جميع منتجات المتجر</Text></Link>
          {isMarketplace && offers.some((offer) => offer.availability) ? <BthwaniButton label={"اختيار المنتج عبر بثواني" + marketCitySuffix} busy={openingMarket} onPress={() => void openMarketRoute(marketplacePath(productID))} /> : null}
        </View> : <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="البحث في منتجات المتجر"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void applyFilter(query)}
            onChangeText={setQuery}
            placeholder="ابحث عن منتج"
            placeholderTextColor={theme.colorMuted}
            style={styles.searchInput}
            value={query}
          />
          <BthwaniButton label="بحث" disabled={catalogBusy || loadingMore} onPress={() => void applyFilter(query)} />
        </View>}
        {!productID && categories.length > 0 ? <View style={styles.categories} accessibilityLabel="فئات المتجر المنشورة">
          {[{ id: "", nameAr: "الكل" }, ...categories].map((category) => {
            const selected = categoryID === category.id;
            return <Link key={category.id} href={storefrontPath({ categoryID: category.id, query })} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={category.id ? "فئة " + category.nameAr : "كل فئات المتجر"} accessibilityState={{ selected }} style={StyleSheet.flatten([styles.category, selected && styles.categorySelected])}>
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{category.nameAr}</Text>
              </Pressable>
            </Link>;
          })}
        </View> : null}
        {catalogError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.secondary}>تعذر تحديث المنتجات. النتائج السابقة محفوظة.</Text><BthwaniButton label="إعادة قراءة المنتجات" onPress={() => catalogRetryOrigin.current === "page" ? void loadMore() : void applyFilter(catalogRetrySearch.current)} variant="secondary" /></View> : null}
        {catalogBusy ? <View style={styles.grid} accessibilityLabel="جارٍ تحميل المنتجات"><BthwaniSkeleton height={220} width={Math.max(100, cardWidth)} /><BthwaniSkeleton height={220} width={Math.max(100, cardWidth)} /></View> : offers.length > 0 ? <View style={styles.grid}>
          {offers.map((offer) => {
            const image = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
            const card = <BthwaniSurface tone="base" style={styles.productCard}>
                {image?.uri && !brokenImages.has(image.uri)
                  ? <ExpoImage cachePolicy="disk" accessibilityLabel={"صورة " + offer.productName} source={{ uri: image.uri }} contentFit="contain" style={styles.productImage} onError={() => setBrokenImages((prev) => new Set(prev).add(image.uri))} />
                  : <View style={[styles.productImage, styles.productPlaceholder]}><BthwaniIcon name="store" color={theme.colorMuted} size={26} /><Text style={styles.secondary}>صورة غير متوفرة</Text></View>}
                <Text style={styles.productName} numberOfLines={2}>{offer.productName}</Text>
                {offer.variantTitle?.trim() ? <Text style={styles.secondary} numberOfLines={1}>{offer.variantTitle}</Text> : null}
                <Text style={styles.price}>{formatMoney(offer.priceMinor, offer.currency)}{offer.priceUnitLabel ? " / " + offer.priceUnitLabel : ""}</Text>
                {!offer.availability ? <Text style={styles.unavailableLabel}>غير متوفر حاليًا</Text> : null}
              </BthwaniSurface>
            if (productID) return <View key={offer.offerId} style={{ width: Math.min(450, cardWidth) }}>{card}</View>;
            return <Link key={offer.offerId} href={storefrontPath({ productID: offer.productId })} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={"عرض " + offer.productName} style={{ width: cardWidth }}>{card}</Pressable>
            </Link>;
          })}
        </View> : <View style={styles.empty}>
          <BthwaniIcon name="store" color={theme.colorMuted} size={32} />
          <Text style={styles.secondary}>{productID ? "المنتج غير متاح في هذا المتجر." : categoryID || appliedQuery ? "لا توجد نتائج مطابقة لهذا البحث أو التصنيف." : "لا توجد منتجات منشورة للعرض حاليًا."}</Text>
          {!productID && (categoryID || appliedQuery) ? <BthwaniButton label="عرض جميع المنتجات" onPress={() => {
            if (categoryID) router.push(storefrontPath());
            else { setQuery(""); void applyFilter(""); }
          }} variant="secondary" /> : null}
        </View>}
        {productID && ready.relation === "independent" && product && product.modifierGroups.length > 0
          ? <View style={styles.notice} accessibilityLabel="إضافات وخيارات المنتج">
              <Text style={styles.secondary}>السعر المعروض أساسي، والإضافات التالية للعرض فقط. الطلب المباشر غير متاح حاليًا.</Text>
              {product.modifierGroups.map(group => <View key={group.id} style={styles.section}>
                <Text style={styles.productName}>{group.nameAr}</Text>
                <Text style={styles.secondary}>{group.required ? "اختيار مطلوب عند تفعيل الشراء" : "اختيار إضافي"}</Text>
                {group.options.map(option => <Text key={option.id} style={styles.secondary}>
                  {option.nameAr}{option.priceDeltaMinor > 0 ? " · +" + formatMoney(option.priceDeltaMinor, product.currency) : ""}
                </Text>)}
                {group.options.length === 0 ? <Text style={styles.secondary}>لا تتوفر خيارات منشورة حاليًا.</Text> : null}
              </View>)}
            </View> : null}
        {ready.catalog.nextCursor && !catalogBusy ? <View style={styles.more}><BthwaniButton label="عرض المزيد من المنتجات" busy={loadingMore} onPress={() => void loadMore()} variant="secondary" /></View> : null}
      </View>

      <View style={styles.section} onLayout={(event) => { contactOffset.current = event.nativeEvent.layout.y; }}>
        <Text accessibilityRole="header" style={styles.title}>التواصل مع المتجر</Text>
        {ready.relation === "marketplace" ? <StorePublicContactCard storeID={storeId} /> : <View style={styles.notice}>
          {ready.store.businessPhoneE164 ? <Text style={styles.secondary}>الهاتف التجاري: {ready.store.businessPhoneE164}</Text> : null}
          {ready.store.businessWhatsAppE164 ? <Text style={styles.secondary}>واتساب التجاري: {ready.store.businessWhatsAppE164}</Text> : null}
          {ready.store.businessEmail ? <Text style={styles.secondary}>البريد التجاري: {ready.store.businessEmail}</Text> : null}
          {([
            ["سياسة الإلغاء", ready.store.cancellationTerms],
            ["سياسة الإرجاع", ready.store.returnsTerms],
            ["سياسة تجهيز الطلب", ready.store.fulfillmentTerms],
            ["سياسة الاستلام", ready.store.collectionTerms],
          ] as const).filter(([, description]) => Boolean(description?.trim())).map(([label, description]) =>
            <View key={label} style={styles.sectionHeading}>
              <Text style={styles.title}>{label}</Text><Text style={styles.secondary}>{description}</Text>
            </View>)}
        </View>}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>{store.name} · بثواني</Text>
        <Text style={styles.secondary}>{isMarketplace ? "يُعرض هذا الموقع من بيانات المتجر المنشورة في سوق بثواني." : "يُعرض هذا الموقع من بيانات المتجر المستقل المنشورة والمعتمدة في بثواني."}</Text>
        {isMarketplace ? <BthwaniButton label={"العودة إلى المتجر داخل سوق بثواني" + marketCitySuffix} busy={openingMarket} onPress={() => void openMarketRoute(marketplacePath())} variant="secondary" /> : null}
      </View>
    </View>
  </ScrollView>;
}

function createStyles(theme: ReturnType<typeof useAppearanceTheme>) {
  return StyleSheet.create({
    screen: { flexGrow: 1, backgroundColor: theme.background, alignItems: "center" },
    content: { width: "100%", maxWidth: 1240, paddingHorizontal: spacing[4], paddingBottom: spacing[6], gap: spacing[4] },
    masthead: { minHeight: 72, flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", gap: spacing[3], paddingVertical: spacing[2] },
    brandButton: { minHeight: 44, justifyContent: "center" },
    brand: { ...typography.titleSm, color: theme.interactiveText, textAlign: "right" },
    navigation: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], alignItems: "center" },
    navItem: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[2] },
    navText: { ...typography.bodySm, color: theme.color, textAlign: "right" },
    hero: { borderRadius: radius.xl, height: 240, width: "100%", overflow: "hidden", backgroundColor: theme.surfaceInset },
    cover: { width: "100%", height: "100%" },
    coverFallback: { alignItems: "center", justifyContent: "center", flex: 1 },
    identityCard: { borderRadius: radius.xl, padding: spacing[4], gap: spacing[2] },
    identityRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
    identityCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
    logo: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: theme.surface },
    logoFallback: { width: 72, height: 72, borderRadius: radius.lg, backgroundColor: theme.surfaceInset, alignItems: "center", justifyContent: "center" },
    storeName: { ...typography.titleLg, color: theme.color, textAlign: "right" },
    title: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    secondary: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    section: { gap: spacing[3] },
    sectionHeading: { gap: spacing[1] },
    bannerRail: { gap: spacing[3], paddingBottom: spacing[1] },
    banner: { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: borders.hairline, borderColor: theme.borderColor, padding: spacing[2], gap: spacing[2], overflow: "hidden" },
    bannerImage: { width: "100%", height: 164, borderRadius: radius.md },
    bannerTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    searchRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    searchInput: { minHeight: 48, minWidth: 120, flex: 1, backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, paddingHorizontal: spacing[3], color: theme.color, textAlign: "right", writingDirection: "rtl" },
    categories: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    category: { borderWidth: borders.hairline, borderColor: theme.borderColor, borderRadius: radius.round, minHeight: 44, paddingHorizontal: spacing[3], justifyContent: "center", backgroundColor: theme.surface },
    categorySelected: { backgroundColor: theme.actionBackground, borderColor: theme.actionBackground },
    categoryText: { ...typography.bodySm, color: theme.color },
    categoryTextSelected: { color: theme.onAction },
    grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: spacing[3] },
    productCard: { flex: 1, gap: spacing[2], padding: spacing[2], minHeight: 246, borderWidth: borders.hairline, borderColor: theme.borderColor, borderRadius: radius.lg },
    productImage: { height: 145, width: "100%", borderRadius: radius.md, backgroundColor: theme.surfaceInset },
    productPlaceholder: { alignItems: "center", justifyContent: "center", gap: spacing[2] },
    productName: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    price: { ...typography.bodyStrong, color: theme.interactiveText, textAlign: "right" },
    unavailableLabel: { ...typography.caption, color: theme.warning, textAlign: "right" },
    empty: { backgroundColor: theme.surfaceInset, borderRadius: radius.lg, minHeight: 165, alignItems: "center", justifyContent: "center", padding: spacing[4], gap: spacing[3] },
    notice: { backgroundColor: theme.surfaceInset, borderRadius: radius.md, padding: spacing[3], gap: spacing[2], alignItems: "flex-start" },
    more: { alignItems: "center" },
    footer: { borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingTop: spacing[4], gap: spacing[2] },
    footerTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    readState: { minHeight: 360, justifyContent: "center", alignItems: "center", backgroundColor: theme.background, padding: spacing[5], gap: spacing[3] },
  });
}
