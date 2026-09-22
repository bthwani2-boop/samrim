import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommerceVertical, DiscoveryContentView, PromotionView, PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, type TextInput, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { listCatalogVerticals, listFavoriteStoreIDs, listPublicDiscoveryContent, listPublicPromotions, listPublishedStores, setFavoriteStore } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView>; favoriteStoreIDs: ReadonlyArray<string> }
  | { kind: "empty" }
  | { kind: "error" };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication, autoFocusSearch = false }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined; autoFocusSearch?: boolean }) {
  const router = useRouter();
  const { cities, selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [query, setQuery] = useState("");
  const [favoriteFilter, setFavoriteFilter] = useState(false);
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
      const stores = await listPublishedStores(selectedCityID);
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
    const stores = state.stores.filter((store) => (!favoriteFilter || state.favoriteStoreIDs.includes(store.id)) && (!selectedVerticalID || store.primaryVerticalId === selectedVerticalID));
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return stores;
    return stores.filter((store) => store.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [favoriteFilter, query, selectedVerticalID, state]);

  const visibleVerticals = useMemo(() => {
    if (state.kind !== "ready") return [];
    return verticals.filter((vertical) => state.stores.some((store) => store.primaryVerticalId === vertical.id));
  }, [state, verticals]);

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
    <View style={styles.container} accessibilityLabel="اكتشاف المتاجر">
      <BthwaniSurface tone="raised" style={styles.hero}>
        <View style={styles.heroIcon}><BthwaniIcon name="store" color={theme.onAction} size={sizing.iconXl} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>اكتشاف بثواني</Text>
          <Text style={styles.heroTitle}>ماذا ترغب اليوم؟</Text>
          <Text style={styles.heroText}>تصفّح المتاجر المتاحة للطلب في {cityName}، ثم افتح الكتالوج واختر ما يناسبك.</Text>
        </View>
      </BthwaniSurface>

      {isAuthenticated ? <BthwaniSurface tone="inset" style={styles.multiStoreCta}><View style={styles.multiStoreCopy}><Text style={styles.eyebrow}>تجربة موحّدة</Text><Text style={styles.cardTitle}>اطلب من عدة متاجر</Text><Text style={styles.muted}>اجمع السلال، وأنشئ طلبًا مستقلًا لكل متجر مع نتيجة واضحة.</Text></View><BthwaniButton label="فتح الطلب المتعدد" onPress={() => router.push("/multi-store-checkout" as Href)} variant="secondary" /></BthwaniSurface> : null}

      {marketing.content.length || marketing.promotions.length ? <View accessibilityLabel="العروض ومحتوى الاكتشاف" style={styles.marketingBlock}>
        {marketing.content.length ? <>
          <BthwaniSectionHeader title="مختارات لك" subtitle="محتوى منشور من بثواني" />
          <View style={styles.marketingList}>{marketing.content.slice(0, 4).map((item) => <BthwaniSurface key={item.id} tone="inset" style={styles.marketingCard}><Text style={styles.eyebrow}>{item.kind === "BANNER" ? "إعلان" : item.kind === "CAROUSEL" ? "اختيارات" : "قصة قصيرة"}</Text><Text style={styles.cardTitle}>{item.titleAr}</Text>{item.bodyAr ? <Text style={styles.muted}>{item.bodyAr}</Text> : null}</BthwaniSurface>)}</View>
        </> : null}
        {marketing.promotions.length ? <>
          <BthwaniSectionHeader title="عروض نشطة" subtitle="طبّق الرمز عند إتمام الطلب" />
          <View style={styles.marketingList}>{marketing.promotions.slice(0, 4).map((promotion) => <BthwaniSurface key={promotion.id} tone="raised" style={styles.promotionCard}><View style={styles.promotionCopy}><Text style={styles.cardTitle}>{promotion.nameAr}</Text><Text style={styles.muted}>{promotion.descriptionAr || (promotion.kind === "PERCENTAGE" ? `خصم ${promotion.valueMinor}%` : `خصم بقيمة ${promotion.valueMinor}`)}</Text></View><Text accessibilityLabel={`رمز العرض ${promotion.code}`} style={styles.promotionCode}>{promotion.code}</Text></BthwaniSurface>)}</View>
        </> : null}
      </View> : marketing.error ? <Text accessibilityRole="alert" style={styles.error}>تعذر تحميل بعض العروض والمحتوى. يمكنك متابعة تصفح المتاجر.</Text> : null}

      {searchField}
      <View style={styles.filterRow}>
        <BthwaniChip label="كل المتاجر" selected={!favoriteFilter} onPress={() => setFavoriteFilter(false)} />
        <BthwaniChip
          icon="favorite"
          label="المفضلة"
          selected={favoriteFilter}
          onPress={() => {
            if (!isAuthenticated) {
              onRequireAuthentication?.();
              return;
            }
            setFavoriteFilter(true);
          }}
        />
      </View>
      {visibleVerticals.length ? <View accessibilityLabel="تصفية حسب المجال التجاري" style={styles.filterRow}><BthwaniChip label="كل المجالات" selected={!selectedVerticalID} onPress={() => setSelectedVerticalID("")} />{visibleVerticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} selected={selectedVerticalID === vertical.id} onPress={() => setSelectedVerticalID(vertical.id)} />)}</View> : null}
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
                <View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>
                <View style={styles.storeCopy}><Text style={styles.storeTitle} numberOfLines={2}>{store.name}</Text><Text style={styles.storeMeta}>{store.serviceCity.displayNameAr} · متاح للطلب</Text><Text style={styles.storeRating}>{store.ratingCount > 0 ? `★ ${store.ratingAverage.toFixed(1)} (${store.ratingCount})` : "لا توجد تقييمات بعد"}</Text><Text style={styles.storeHint}>افتح الكتالوج واستكشف المنتجات</Text></View>
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
    marketingBlock: { gap: spacing[3] },
    marketingList: { gap: spacing[2] },
    marketingCard: { borderRadius: radius.lg, gap: spacing[1], padding: spacing[3] },
    promotionCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    promotionCopy: { flex: 1, gap: spacing[1] },
    promotionCode: { ...typography.label, backgroundColor: theme.actionSoft, borderColor: theme.interactiveText, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.interactiveText, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    multiStoreCta: { borderRadius: radius.lg, gap: spacing[2], padding: spacing[3] },
    multiStoreCopy: { gap: spacing[1] },
  });
}
