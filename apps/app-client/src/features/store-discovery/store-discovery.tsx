import { borders, elevation, opacity, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSearchField, BthwaniSectionHeader, BthwaniSkeleton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import type { PublicStoreView } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, type TextInput, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { listPublishedStores } from "./store-discovery-client";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; stores: ReadonlyArray<PublicStoreView> }
  | { kind: "empty" }
  | { kind: "error" };

export default function StoreDiscovery({ isAuthenticated = true, onRequireAuthentication, autoFocusSearch = false }: { isAuthenticated?: boolean; onRequireAuthentication?: (() => void) | undefined; autoFocusSearch?: boolean }) {
  const router = useRouter();
  const { cities, selectedCityID } = useServiceCityScope();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<DiscoveryState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);
  const shouldAutoFocusSearch = autoFocusSearch && state.kind !== "loading";

  const cityName = cities.find((city) => city.id === selectedCityID)?.displayNameAr ?? "مدينتك";

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      if (!selectedCityID) {
        setState({ kind: "empty" });
        return;
      }
      const stores = await listPublishedStores(selectedCityID);
      setState(stores.length ? { kind: "ready", stores } : { kind: "empty" });
    } catch {
      setState({ kind: "error" });
    }
  }, [selectedCityID]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!shouldAutoFocusSearch) return;
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [shouldAutoFocusSearch]);

  const filteredStores = useMemo(() => {
    if (state.kind !== "ready") return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return state.stores;
    return state.stores.filter((store) => store.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, state]);

  const searchField = <BthwaniSearchField accessibilityLabel="البحث في المتاجر" inputRef={searchInputRef} onChangeText={setQuery} onClear={() => setQuery("")} placeholder="ابحث باسم المتجر" value={query} />;

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

      {searchField}

      <BthwaniSectionHeader title={`متاجر في ${cityName}`} subtitle={`${filteredStores.length} متجر متاح للطلب`} />
      {filteredStores.length === 0 ? (
        <BthwaniSurface tone="inset" style={styles.noResults}>
          <BthwaniIcon name="search" color={theme.colorMuted} size={sizing.iconXl} />
          <Text style={styles.cardTitle}>لا توجد نتائج بهذا الاسم</Text>
          <Text style={styles.muted}>جرّب اسمًا أقصر أو امسح البحث لعرض كل المتاجر.</Text>
          <BthwaniButton label="مسح البحث" onPress={() => setQuery("")} variant="quiet" />
        </BthwaniSurface>
      ) : (
        <View style={styles.list}>
          {filteredStores.map((store) => (
            <Pressable
              key={store.id}
              accessibilityRole="button"
              accessibilityLabel={`فتح متجر ${store.name}`}
              onPress={() => router.push(`/store/${encodeURIComponent(store.id)}` as Href)}
              style={({ pressed }) => [styles.storeCard, pressed && styles.pressed]}
            >
              <View style={styles.storeIcon}><BthwaniIcon name="store" color={theme.interactiveText} size={sizing.iconLg} /></View>
              <View style={styles.storeCopy}><Text style={styles.storeTitle} numberOfLines={2}>{store.name}</Text><Text style={styles.storeMeta}>{store.serviceCity.displayNameAr} · متاح للطلب</Text><Text style={styles.storeHint}>افتح الكتالوج واستكشف المنتجات</Text></View>
              <BthwaniIcon name="forward" color={theme.colorMuted} size={sizing.iconMd} />
            </Pressable>
          ))}
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
    storeCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, flexDirection: "row", gap: spacing[3], minHeight: 100, padding: spacing[3], ...elevation.raised },
    storeIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarLg, justifyContent: "center", width: sizing.avatarLg },
    storeCopy: { flex: 1, gap: spacing[1] },
    storeTitle: { ...typography.titleSm, color: theme.color },
    storeMeta: { ...typography.bodySm, color: theme.interactiveText },
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
  });
}
