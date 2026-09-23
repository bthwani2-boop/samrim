import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommerceVertical, DiscoveryContentView, PromotionView, PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nManager, Image, Pressable, ScrollView, StyleSheet, Text, type TextInput, useWindowDimensions, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { recordDiscoveryClick, recordDiscoveryImpression } from "./discovery-analytics";
import { listCatalogVerticals, listFavoriteStoreIDs, listOwnDeliveryAddresses, listPublicDiscoveryContent, listPublicPromotions, listPublishedStores, setFavoriteStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView>; favoriteStoreIDs: ReadonlyArray<string> }
  | { kind: "empty" }
  | { kind: "error" };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication, autoFocusSearch = false }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined; autoFocusSearch?: boolean }) {
  const router = useRouter();
  const { cities, selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [discoveryContainerWidth, setDiscoveryContainerWidth] = useState(0);
  const carouselCardWidth = Math.max(200, Math.min((discoveryContainerWidth || viewportWidth) - spacing[4], 560));
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [query, setQuery] = useState("");
  const [storeFilter, setStoreFilter] = useState<"all" | "newest" | "nearest" | "favorites">("all");
  const [selectedVerticalID, setSelectedVerticalID] = useState("");
  const [favoriteBusyStoreID, setFavoriteBusyStoreID] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [marketing, setMarketing] = useState<{ content: ReadonlyArray<DiscoveryContentView>; promotions: ReadonlyArray<PromotionView>; error: boolean }>({ content: [], promotions: [], error: false });
  const searchInputRef = useRef<TextInput>(null);
  const shouldAutoFocusSearch = autoFocusSearch && state.kind !== "loading";

  const cityName = cities.find((city) => city.id === selectedCityID)?.displayNameAr ?? "مدينتك";

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
      const stores = await listPublishedStores(selectedCityID, location);
      const marketingResults = await Promise.allSettled([listPublicDiscoveryContent(selectedCityID), listPublicPromotions(selectedCityID)]);
      const content = marketingResults[0].status === "fulfilled" ? marketingResults[0].value.items : [];
      const promotions = marketingResults[1].status === "fulfilled" ? marketingResults[1].value.promotions : [];
      setMarketing({ content, promotions, error: marketingResults.some((result) => result.status === "rejected") });
      let availableVerticals: ReadonlyArray<CommerceVertical> = [];
      try {
        availableVerticals = (await listCatalogVerticals()).filter((vertical) => vertical.active);
      } catch {
        // Store discovery remains usable if the optional filter registry is unavailable.
      }
      setVerticals(availableVerticals);
      setSelectedVerticalID("");
      let favoriteStoreIDs: ReadonlyArray<string> = [];
      if (isAuthenticated) {
        try {
          favoriteStoreIDs = await listFavoriteStoreIDs();
        } catch {
          setFavoriteError("تعذر تحديث قائمة المفضلة. يمكنك متابعة تصفح المتاجر.");
        }
      }
      setState(stores.length ? { kind: "ready", stores, favoriteStoreIDs } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, [isAuthenticated, selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!shouldAutoFocusSearch) return;
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [shouldAutoFocusSearch]);

  const filteredStores = useMemo(() => {
    if (state.kind !== "ready") return [];
    const stores = state.stores.filter((store) => (storeFilter !== "favorites" || state.favoriteStoreIDs.includes(store.id)) && (storeFilter !== "nearest" || typeof store.distanceMeters === "number") && (!selectedVerticalID || store.primaryVerticalId === selectedVerticalID));
    if (storeFilter === "newest") stores.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    if (storeFilter === "nearest") stores.sort((left, right) => (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return stores;
    return stores.filter((store) => store.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, selectedVerticalID, state, storeFilter]);

  const visibleVerticals = useMemo(() => {
    if (state.kind !== "ready") return [];
    return verticals.filter((vertical) => state.stores.some((store) => store.primaryVerticalId === vertical.id));
  }, [state, verticals]);

  const mediaContent = useMemo(() => marketing.content.filter((item) => Boolean(item.mediaUri) && (item.kind === "BANNER" || item.kind === "CAROUSEL")).slice(0, 8), [marketing.content]);
  const textContent = useMemo(() => marketing.content.filter((item) => !item.mediaUri || (item.kind !== "BANNER" && item.kind !== "CAROUSEL")).slice(0, 4), [marketing.content]);

  const searchField = <BthwaniSearchField accessibilityLabel="البحث في المتاجر" inputRef={searchInputRef} onChangeText={setQuery} onClear={() => setQuery("")} placeholder="ابحث باسم المتجر" value={query} />;

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
    return <View style={styles.state}><BthwaniIcon name="warning" color={theme.warning} size={sizing.iconXl} /><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.title}>تعذر تجهيز الاكتشاف</Text><Text style={styles.muted}>تحقق من الاتصال ثم أعد المحاولة.</Text>{searchField}<BthwaniButton label="إعادة المحاولة" onPress={() => void load()} />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} variant="secondary" /> : null}</View>;
  }

  if (state.kind === "empty") {
    return <View style={styles.state}><View style={styles.emptyIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconXl} /></View><Text style={styles.title}>{selectedCityID ? "لا توجد متاجر متاحة بعد" : "اختر مدينة للبدء"}</Text><Text style={styles.muted}>{selectedCityID ? `لا توجد متاجر منشورة للطلب في ${cityName} حاليًا.` : "تظهر المتاجر بحسب مدينة الخدمة التي تختارها."}</Text>{searchField}<BthwaniButton label="تحديث المتاجر" onPress={() => void load()} variant="secondary" />{!isAuthenticated && onRequireAuthentication ? <BthwaniButton label="تسجيل الدخول للطلب" onPress={onRequireAuthentication} /> : null}</View>;
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
      <BthwaniSurface tone="raised" style={styles.hero}>
        <View style={styles.heroIcon}><BthwaniIcon name="store" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>اكتشاف بثواني</Text>
          <Text style={styles.heroTitle}>ماذا ترغب اليوم؟</Text>
          <Text style={styles.heroText}>تصفّح المتاجر المتاحة للطلب في {cityName}، ثم افتح الكتالوج واختر ما يناسبك.</Text>
        </View>
      </BthwaniSurface>

      {isAuthenticated ? <BthwaniSurface tone="inset" style={styles.multiStoreCta}><View style={styles.multiStoreCopy}><Text style={styles.eyebrow}>تجربة موحّدة</Text><Text style={styles.cardTitle}>اطلب من عدة متاجر</Text><Text style={styles.muted}>اجمع السلال، وأنشئ طلبًا مستقلًا لكل متجر مع نتيجة واضحة.</Text></View><BthwaniButton label="فتح الطلب المتعدد" onPress={() => router.push("/multi-store-checkout" as Href)} variant="secondary" /></BthwaniSurface> : null}

      {visibleVerticals.length ? <View style={styles.verticalShortcutBlock}>
        <BthwaniSectionHeader title="تسوق حسب النشاط" />
        <ScrollView accessibilityLabel="اختصارات قطاعات المتاجر" contentContainerStyle={styles.verticalShortcutContent} horizontal showsHorizontalScrollIndicator={false}>
          <BthwaniChip label="كل المجالات" selected={!selectedVerticalID} onPress={() => setSelectedVerticalID("")} />
          {visibleVerticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} selected={selectedVerticalID === vertical.id} onPress={() => setSelectedVerticalID(vertical.id)} />)}
        </ScrollView>
      </View> : null}

      {marketing.content.length || marketing.promotions.length ? <View accessibilityLabel="العروض ومحتوى الاكتشاف" style={styles.marketingBlock}>
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
      </View> : marketing.error ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل بعض العروض والمحتوى. يمكنك متابعة تصفح المتاجر.</Text> : null}

      {searchField}
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

      <BthwaniSectionHeader title={`متاجر في ${cityName}`} subtitle={`${filteredStores.length} متجر متاح للطلب`} />
      {filteredStores.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.noResults}>
          <BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} />
          <Text style={styles.cardTitle}>{query.trim() ? "لا توجد نتائج بهذا الاسم" : selectedVerticalID ? "لا توجد متاجر ضمن هذا المجال" : "لا توجد متاجر مطابقة"}</Text>
          <Text style={styles.muted}>{query.trim() ? "جرّب اسمًا أقصر أو امسح البحث لعرض كل المتاجر." : "غيّر المجال أو أزل الفلاتر لعرض المتاجر المتاحة."}</Text>
          {query.trim() ? <BthwaniButton label="مسح البحث" onPress={() => setQuery("")} variant="quiet" /> : null}
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
                <View style={styles.storeCopy}><Text style={styles.storeTitle} numberOfLines={2}>{store.name}</Text><Text style={styles.storeMeta}>{typeof store.distanceMeters === "number" ? `${(store.distanceMeters / 1000).toFixed(2)} كم · ` : ""}{store.serviceCity.displayNameAr} · متاح للطلب</Text><Text style={styles.storeRating}>{store.ratingCount > 0 ? `★ ${store.ratingAverage.toFixed(1)} (${store.ratingCount})` : "لا توجد تقييمات بعد"}</Text><Text style={styles.storeHint}>افتح الكتالوج واستكشف المنتجات</Text></View>
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
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { gap: spacing[4], paddingBottom: spacing[4], width: "100%" },
    hero: { alignItems: "center", borderRadius: radius.xl, flexDirection: "row", gap: spacing[3], padding: spacing[4], ...elevation.raised },
    heroIcon: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.lg, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    heroCopy: { flex: 1, gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    heroTitle: { ...typography.titleLg, color: theme.color },
    heroText: { ...typography.bodySm, color: theme.colorMuted },
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
    verticalShortcutBlock: { gap: spacing[1] },
    verticalShortcutContent: { alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[1] },
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
