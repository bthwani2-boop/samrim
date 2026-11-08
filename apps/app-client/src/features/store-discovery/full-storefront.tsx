import { borders, radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { formatMoney, type PublicCatalogResponse, type PublicDiscoveryContentView, type PublicStoreView } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ScrollViewInstance } from "react-native";

import { useServiceCityScope } from "../service-city/service-city-scope";
import { mergeCatalog } from "./store-catalog-model";
import { listPublicStoreBanners, readPublicStoreCatalog, readPublishedStore } from "./store-discovery-client";
import { storefrontColumns, verifiedMarketplaceStoreRead, visiblePublishedOffers } from "./full-storefront-model";
import { StorePublicContactCard } from "./store-public-contact";
import { storeReadFailureKind } from "./store-read-state";

type SiteState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; store: PublicStoreView; catalog: PublicCatalogResponse };

type SiteBanner = PublicDiscoveryContentView;

// This is a read-only Web composition over the SAME DSH Marketplace Store,
// catalog and media as ClientStoreDetail. Marketplace checkout remains there.
export default function ClientFullStorefront({ storeId }: Readonly<{ storeId: string }>) {
  const { selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const readID = useRef(0);
  const catalogID = useRef(0);
  const bannerID = useRef(0);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const productsOffset = useRef(0);
  const contactOffset = useRef(0);
  const [state, setState] = useState<SiteState>({ kind: "loading" });
  const [banners, setBanners] = useState<ReadonlyArray<SiteBanner>>([]);
  const [bannerError, setBannerError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCategoryID, setActiveCategoryID] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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

  const marketplacePath = (productID = ""): Href => (
    "/store/" + encodeURIComponent(storeId) +
    "?serviceCityId=" + encodeURIComponent(selectedCityID ?? "") +
    (productID ? "&productId=" + encodeURIComponent(productID) : "")
  ) as Href;

  const refreshBanners = useCallback(async (storeGeneration: number) => {
    if (!storeId || !selectedCityID) return;
    const generation = ++bannerID.current;
    try {
      const response = await listPublicStoreBanners(storeId, selectedCityID);
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
    setQuery("");
    setAppliedQuery("");
    setActiveCategoryID("");
    setCatalogBusy(false);
    setCatalogError(false);
    setLoadingMore(false);
    setBrokenImages(new Set());
    if (!storeId.trim() || !selectedCityID) {
      setState({ kind: "unavailable" });
      return;
    }
    try {
      const [store, catalog] = await Promise.all([
        readPublishedStore(storeId, selectedCityID),
        readPublicStoreCatalog(storeId, selectedCityID, "", "", 24),
      ]);
      if (generation !== readID.current) return;
      // DSH independently enforces published BTHWANI_PARTNER eligibility for
      // both endpoints. No owner preview, independent endpoint or query flag.
      if (!verifiedMarketplaceStoreRead(store, catalog, storeId, selectedCityID)) {
        setState({ kind: "unavailable" });
        return;
      }
      setState({ kind: "ready", store, catalog });
      void refreshBanners(generation);
    } catch (cause) {
      if (generation === readID.current) setState({ kind: storeReadFailureKind(cause) });
    }
  }, [refreshBanners, selectedCityID, storeId]);

  useEffect(() => {
    void load();
    return () => { ++readID.current; ++catalogID.current; ++bannerID.current; };
  }, [load]);

  const applyFilter = useCallback(async (categoryID: string, search: string) => {
    if (!storeId || !selectedCityID) return;
    const generation = ++catalogID.current;
    setCatalogBusy(true);
    setCatalogError(false);
    try {
      const catalog = await readPublicStoreCatalog(storeId, selectedCityID, categoryID, search.trim(), 24);
      if (generation !== catalogID.current) return;
      if (catalog.storeId !== storeId) throw new Error("PUBLIC_CATALOG_STORE_MISMATCH");
      setState((previous) => previous.kind === "ready" && previous.store.id === storeId &&
        previous.store.serviceCity.id === selectedCityID ? { ...previous, catalog } : previous);
      setActiveCategoryID(categoryID);
      setAppliedQuery(search.trim());
    } catch (cause) {
      if (generation !== catalogID.current) return;
      if (storeReadFailureKind(cause) === "unavailable") hideWithdrawnStore();
      else setCatalogError(true);
    } finally {
      if (generation === catalogID.current) setCatalogBusy(false);
    }
  }, [hideWithdrawnStore, selectedCityID, storeId]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !selectedCityID || !state.catalog.nextCursor || catalogBusy || loadingMore) return;
    const generation = ++catalogID.current;
    const cursor = state.catalog.nextCursor;
    setLoadingMore(true);
    setCatalogError(false);
    try {
      const next = await readPublicStoreCatalog(storeId, selectedCityID, activeCategoryID, appliedQuery, 24, cursor);
      if (generation !== catalogID.current) return;
      if (next.storeId !== storeId || next.nextCursor === cursor) throw new Error("PUBLIC_CATALOG_PAGE_MISMATCH");
      setState((previous) => previous.kind === "ready" && previous.store.id === storeId &&
        previous.store.serviceCity.id === selectedCityID ? { ...previous, catalog: mergeCatalog(previous.catalog, next) } : previous);
    } catch (cause) {
      if (generation !== catalogID.current) return;
      if (storeReadFailureKind(cause) === "unavailable") hideWithdrawnStore();
      else setCatalogError(true);
    } finally {
      if (generation === catalogID.current) setLoadingMore(false);
    }
  }, [activeCategoryID, appliedQuery, catalogBusy, hideWithdrawnStore, loadingMore, selectedCityID, state, storeId]);

  const ready = state.kind === "ready" && state.store.id === storeId &&
    state.store.serviceCity.id === selectedCityID ? state : null;
  const columns = storefrontColumns(width);
  const siteWidth = Math.min(width, 1240);
  const innerWidth = Math.max(0, siteWidth - spacing[4] * 2);
  const cardWidth = Math.max(0, Math.floor((innerWidth - (columns - 1) * spacing[3]) / columns));
  const offers = ready ? visiblePublishedOffers(ready.catalog.offers, storeId) : [];
  const categories = ready ? ready.catalog.categories.filter((category) => category.active) : [];
  const goToMarket = () => router.push(marketplacePath());
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
  const cover = store.storeCoverImage?.uri;
  const profile = store.storeProfileImage?.uri;

  return <ScrollView
    ref={scrollRef}
    role="main"
    contentContainerStyle={styles.screen}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false}
  >
    <View style={styles.content}>
      <View style={styles.masthead}>
        <Pressable accessibilityRole="button" accessibilityLabel="العودة إلى سوق بثواني" onPress={() => router.push("/home" as Href)} style={styles.brandButton}>
          <Text style={styles.brand}>بثواني</Text>
        </Pressable>
        <View style={styles.navigation} accessibilityLabel="أقسام موقع المتجر">
          <Pressable accessibilityRole="button" onPress={() => jumpTo(0)} style={styles.navItem}><Text style={styles.navText}>الرئيسية</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => jumpTo(productsOffset.current)} style={styles.navItem}><Text style={styles.navText}>المنتجات</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => jumpTo(contactOffset.current)} style={styles.navItem}><Text style={styles.navText}>التواصل</Text></Pressable>
        </View>
        <BthwaniButton label="التسوق عبر بثواني" onPress={goToMarket} />
      </View>

      <View accessibilityLabel={"واجهة متجر " + store.name} style={styles.hero}>
        {cover && !brokenImages.has(cover)
          ? <ExpoImage cachePolicy="disk" accessibilityLabel={"غلاف متجر " + store.name} source={{ uri: cover }} contentFit="cover" style={styles.cover} onError={() => setBrokenImages((prev) => new Set(prev).add(cover))} />
          : <View style={styles.coverFallback}><BthwaniIcon name="store" color={theme.colorMuted} size={48} /></View>}
      </View>
      <BthwaniSurface tone="raised" style={styles.identityCard}>
        <View style={styles.identityRow}>
          {profile && !brokenImages.has(profile)
            ? <ExpoImage cachePolicy="disk" accessibilityLabel={"شعار متجر " + store.name} source={{ uri: profile }} contentFit="contain" style={styles.logo} onError={() => setBrokenImages((prev) => new Set(prev).add(profile))} />
            : <View style={styles.logoFallback}><BthwaniIcon name="store" color={theme.interactiveText} size={26} /></View>}
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" style={styles.storeName}>{store.name}</Text>
            {store.addressLine?.trim() ? <Text style={styles.secondary}>{store.addressLine.trim()}</Text> : null}
            <Text style={styles.secondary}>مدينة الخدمة: {store.serviceCity.displayNameAr}</Text>
          </View>
        </View>
        {store.ratingCount > 0
          ? <Text accessibilityLabel={"تقييم المتجر " + store.ratingAverage.toFixed(1) + " من خمسة"} style={styles.secondary}>★ {store.ratingAverage.toFixed(1)} · {store.ratingCount} تقييم</Text>
          : null}
      </BthwaniSurface>

      {bannerError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.secondary}>تعذر تحديث بنرات المتجر. يمكنك متابعة التصفح.</Text><BthwaniButton label="إعادة قراءة البنرات" variant="secondary" onPress={() => void refreshBanners(readID.current)} /></View> : null}
      {banners.length > 0 ? <View style={styles.section} accessibilityLabel="بنرات المتجر المنشورة">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bannerRail}>
          {banners.map((banner) => <View key={banner.id} style={[styles.banner, { width: Math.min(420, Math.max(260, innerWidth)) }]}>
            <ExpoImage cachePolicy="disk" source={{ uri: banner.mediaUri }} accessibilityLabel={"بنر " + banner.titleAr} contentFit="cover" style={styles.bannerImage} />
            <Text style={styles.bannerTitle} numberOfLines={2}>{banner.titleAr}</Text>
            {banner.bodyAr?.trim() ? <Text style={styles.secondary} numberOfLines={2}>{banner.bodyAr}</Text> : null}
          </View>)}
        </ScrollView>
      </View> : null}

      <View style={styles.section} onLayout={(event) => { productsOffset.current = event.nativeEvent.layout.y; }}>
        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.title}>منتجات المتجر</Text>
          <Text style={styles.secondary}>المنتجات المنشورة لدى {store.name}</Text>
        </View>
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="البحث في منتجات المتجر"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void applyFilter(activeCategoryID, query)}
            onChangeText={setQuery}
            placeholder="ابحث عن منتج"
            placeholderTextColor={theme.colorMuted}
            style={styles.searchInput}
            value={query}
          />
          <BthwaniButton label="بحث" disabled={catalogBusy || loadingMore} onPress={() => void applyFilter(activeCategoryID, query)} />
        </View>
        {categories.length > 0 ? <View style={styles.categories} accessibilityLabel="فئات المتجر المنشورة">
          <Pressable accessibilityRole="button" accessibilityState={{ selected: !activeCategoryID, disabled: catalogBusy }} disabled={catalogBusy} onPress={() => void applyFilter("", query)} style={[styles.category, !activeCategoryID && styles.categorySelected]}>
            <Text style={[styles.categoryText, !activeCategoryID && styles.categoryTextSelected]}>الكل</Text>
          </Pressable>
          {categories.map((category) => <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={"فئة " + category.nameAr} accessibilityState={{ selected: activeCategoryID === category.id, disabled: catalogBusy }} disabled={catalogBusy} onPress={() => void applyFilter(category.id, query)} style={[styles.category, activeCategoryID === category.id && styles.categorySelected]}>
            <Text style={[styles.categoryText, activeCategoryID === category.id && styles.categoryTextSelected]}>{category.nameAr}</Text>
          </Pressable>)}
        </View> : null}
        {catalogError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.secondary}>تعذر تحديث المنتجات. النتائج السابقة محفوظة.</Text><BthwaniButton label="إعادة قراءة المنتجات" onPress={() => void applyFilter(activeCategoryID, query)} variant="secondary" /></View> : null}
        {catalogBusy ? <View style={styles.grid} accessibilityLabel="جارٍ تحميل المنتجات"><BthwaniSkeleton height={220} width={Math.max(100, cardWidth)} /><BthwaniSkeleton height={220} width={Math.max(100, cardWidth)} /></View> : offers.length > 0 ? <View style={styles.grid}>
          {offers.map((offer) => {
            const image = offer.media.find((media) => media.role === "primary") ?? offer.media[0];
            return <Pressable key={offer.offerId} accessibilityRole="link" accessibilityLabel={"عرض " + offer.productName + " داخل سوق بثواني"} onPress={() => router.push(marketplacePath(offer.productId))} style={{ width: cardWidth }}>
              <BthwaniSurface tone="base" style={styles.productCard}>
                {image?.uri && !brokenImages.has(image.uri)
                  ? <ExpoImage cachePolicy="disk" accessibilityLabel={"صورة " + offer.productName} source={{ uri: image.uri }} contentFit="contain" style={styles.productImage} onError={() => setBrokenImages((prev) => new Set(prev).add(image.uri))} />
                  : <View style={[styles.productImage, styles.productPlaceholder]}><BthwaniIcon name="store" color={theme.colorMuted} size={26} /><Text style={styles.secondary}>صورة غير متوفرة</Text></View>}
                <Text style={styles.productName} numberOfLines={2}>{offer.productName}</Text>
                {offer.variantTitle?.trim() ? <Text style={styles.secondary} numberOfLines={1}>{offer.variantTitle}</Text> : null}
                <Text style={styles.price}>{formatMoney(offer.priceMinor, offer.currency)}</Text>
                {!offer.availability ? <Text style={styles.unavailableLabel}>غير متوفر حاليًا</Text> : null}
              </BthwaniSurface>
            </Pressable>;
          })}
        </View> : <View style={styles.empty}>
          <BthwaniIcon name="store" color={theme.colorMuted} size={32} />
          <Text style={styles.secondary}>{activeCategoryID || appliedQuery ? "لا توجد نتائج مطابقة لهذا البحث أو التصنيف." : "لا توجد منتجات منشورة للعرض حاليًا."}</Text>
          {activeCategoryID || appliedQuery ? <BthwaniButton label="عرض جميع المنتجات" onPress={() => { setQuery(""); void applyFilter("", ""); }} variant="secondary" /> : null}
        </View>}
        {ready.catalog.nextCursor && !catalogBusy ? <View style={styles.more}><BthwaniButton label="عرض المزيد من المنتجات" busy={loadingMore} onPress={() => void loadMore()} variant="secondary" /></View> : null}
      </View>

      <View style={styles.section} onLayout={(event) => { contactOffset.current = event.nativeEvent.layout.y; }}>
        <Text accessibilityRole="header" style={styles.title}>التواصل مع المتجر</Text>
        <StorePublicContactCard storeID={storeId} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>{store.name} · بثواني</Text>
        <Text style={styles.secondary}>يُعرض هذا الموقع من بيانات المتجر المنشورة في سوق بثواني.</Text>
        <BthwaniButton label="العودة إلى المتجر داخل سوق بثواني" onPress={goToMarket} variant="secondary" />
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
