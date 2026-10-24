import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme, type MobileIconName } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreImagesResponse } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability, readOwnStoreImages } from "./store-readback-client";
import { onStoreAvailabilityChanged } from "./store-availability-events";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type Destination = "operations" | "promotions" | "team" | "settings";
type MenuItem = Readonly<{ label: string; icon: MobileIconName; description: string; destination?: Destination; href?: Href }>;

export function PartnerMore() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { selectedStore, stores, state, reload } = usePartnerStoreScope();
  const [availability, setAvailability] = useState<PartnerStoreOperationalAvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [storeImages, setStoreImages] = useState<StoreImagesResponse | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const can = (permission: "store_operations" | "promotions") => Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes(permission)));
  const canOperate = can("store_operations");
  const storeID = canOperate ? selectedStore?.id : undefined;
  const selectedID = selectedStore?.id;
  useFocusEffect(useCallback(() => {
    let active = true;
    setStoreImages(null);
    setCoverFailed(false);
    setLogoFailed(false);
    if (selectedID) void readOwnStoreImages(selectedID).then((value) => { if (active && value.storeId === selectedID) setStoreImages(value); }).catch(() => { if (active) setStoreImages(null); });
    return () => { active = false; };
  }, [selectedID]));
  useFocusEffect(useCallback(() => {
    let active = true;
    setAvailability(null);
    setAvailabilityError(false);
    const refresh = () => { if (storeID) void readOwnStoreOperationalAvailability(storeID).then(
      (value) => { if (active) { setAvailability(value); setAvailabilityError(false); } },
      () => { if (active) setAvailabilityError(true); },
    ); };
    refresh();
    const stop = storeID ? onStoreAvailabilityChanged(storeID, refresh) : () => {};
    return () => { active = false; stop(); };
  }, [storeID]));
  const orderable = availability?.orderabilityByMode.some((mode) => mode.state === "OPEN_FOR_ORDERS") ?? false;
  const stopped = availability?.availability.paused ?? false;
  const statusTitle = availabilityError ? "تعذر قراءة حالة المتجر" : !availability ? "جارٍ التحقق من الحالة" : stopped ? "استقبال الطلبات متوقف" : orderable ? "المتجر مفتوح" : "المتجر مغلق";
  const actions: MenuItem[] = [
    ...(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? [{ label: "أدوات الكتالوج", icon: "cart" as const, description: "إدارة الفئات والإضافات", href: "/products?panel=tools" as Href }] : []),
    ...(canOperate ? [{ label: "التشغيل", icon: "store" as const, description: "الجاهزية والجدول وطرق التسليم", destination: "operations" as const }] : []),
    ...(can("promotions") ? [{ label: "العروض", icon: "offers" as const, description: "إنشاء ومتابعة العروض", destination: "promotions" as const }] : []),
    ...(selectedStore?.owned ? [
      { label: "الفريق", icon: "account" as const, description: "الموظفون وأذونات الوصول", destination: "team" as const },
    ] : []),
    ...(state.kind === "ready" && !stores.length ? [{ label: "حالة الانضمام", icon: "store" as const, description: "متابعة طلب الشراكة", href: "/onboarding" as Href }] : []),
    { label: "الأداء", icon: "orders", description: "مؤشرات المتجر وفرص النمو", href: "/insights" as Href },
    { label: "الحساب", icon: "account", description: "معلومات الحساب وتفضيلاته", href: "/account" as Href },
  ];
  function navigate(item: MenuItem) {
    if (item.destination) router.push({ pathname: "/store", params: { section: item.destination, returnTo: "more" } } as Href);
    else if (item.href) router.push((String(item.href).includes("?") ? String(item.href) + "&returnTo=more" : String(item.href) + "?returnTo=more") as Href);
  }
  const operationalItem: MenuItem = { label: "التشغيل وساعات العمل", icon: "store", description: "إعدادات التشغيل", destination: "operations" };
  return <View style={styles.screen}>
    {stores.length > 1 ? <PartnerStoreScopeSelector /> : null}
    {state.kind === "error" ? <View style={styles.warning}><Text style={styles.muted}>تعذر تحميل المتاجر</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void reload()} /></View> : null}
    {selectedStore && !canOperate && !can("promotions") ? <Text style={styles.muted}>لا تتوفر صلاحية إدارة هذا المتجر. اختر متجرًا آخر عند الحاجة.</Text> : null}
    {selectedStore ? <Pressable accessibilityRole="button" accessibilityLabel={"ملف المتجر " + selectedStore.name + "، عرض الشعار والغلاف والبيانات"}
      onPress={() => router.push({ pathname: "/store", params: { section: "settings", returnTo: "more" } } as Href)}
      style={styles.storeHero}>
      <View style={styles.heroCoverArea}>
        {storeImages?.storeCoverImage?.uri && !coverFailed ? <Image source={{ uri: storeImages.storeCoverImage.uri }} onError={() => setCoverFailed(true)} resizeMode="cover" style={styles.heroCover} /> : <View style={styles.heroFallback}><BthwaniIcon name="store" color={theme.brandAction} size={36}/></View>}
      </View>
      <View style={styles.heroFooter}>
        <View style={[styles.heroLogo, { borderColor: theme.borderColor }]}>
          {storeImages?.storeProfileImage?.uri && !logoFailed ? <Image source={{ uri: storeImages.storeProfileImage.uri }} onError={() => setLogoFailed(true)} resizeMode="cover" style={styles.heroLogoImage} /> : <BthwaniIcon name="store" color={theme.brandAction} size={27} />}
        </View>
        <View style={styles.heroText}>
          <Text numberOfLines={1} style={styles.heroName}>{selectedStore.name}</Text>
          <View style={styles.heroStatus}>
            {canOperate ? <View style={[styles.dot, { backgroundColor: orderable && !stopped ? theme.success : theme.warning }]} /> : null}
            <Text numberOfLines={1} style={styles.heroSubtitle}>{canOperate ? statusTitle : "صور وبيانات المتجر"}</Text>
          </View>
        </View>
        <View style={styles.heroEdit}>
          <BthwaniIcon name="edit" size={16} color={theme.brandAction}/>
          <Text style={styles.heroEditLabel}>ملف المتجر</Text>
        </View>
      </View>
    </Pressable> : null}
    <View style={styles.grid}>
      {actions.map((item, index) => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => navigate(item)} style={({ pressed }) => [styles.menuCard, pressed && styles.menuPressed]}>
        <View style={styles.menuTop}><View style={[styles.menuIcon, { backgroundColor: index % 3 === 0 ? theme.actionSoft : theme.surfaceRaised }]}><BthwaniIcon name={item.icon} size={20} color={index % 3 === 0 ? theme.brandAction : theme.color} /></View><Text numberOfLines={1} style={styles.menuTitle}>{item.label}</Text></View>
      </Pressable>)}
    </View>
  </View>;
}

function createStyles(p: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  screen: { paddingTop: 5, paddingBottom: 12, gap: 10 },
  storeHero: { overflow: "hidden", borderWidth: 1, borderColor: p.borderColor, borderRadius: 14, backgroundColor: p.surface },
  heroCoverArea: { height: 106, overflow: "hidden", backgroundColor: p.surfaceRaised },
  heroFallback: { flex: 1, justifyContent: "center", alignItems: "center" },
  heroCover: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  heroFooter: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, minHeight: 77 },
  heroLogo: { width: 54, height: 54, borderRadius: 11, borderWidth: 1, backgroundColor: p.surface, justifyContent: "center", alignItems: "center", overflow: "hidden" },
  heroLogoImage: { width: "100%", height: "100%" },
  heroText: { flex: 1, minWidth: 0, gap: 5 },
  heroStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroName: { ...typography.titleSm, fontWeight: "800", color: p.color },
  heroSubtitle: { ...typography.caption, color: p.colorMuted },
  heroEdit: { padding: 7, borderRadius: 10, alignItems: "center", gap: 4 },
  heroEditLabel: { ...typography.caption, color: p.brandAction, fontWeight: "700" },
  statusCard: { backgroundColor: p.actionSoft, borderColor: p.brandAction, borderWidth: 1, borderRadius: 15, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 72 },
  statusCopy: { flex: 1, alignItems: "flex-start" },
  statusHeading: { flexDirection: "row", gap: 7, alignItems: "center" },
  statusTitle: { ...typography.bodyStrong, color: p.color, fontWeight: "800", fontSize: 15, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusAction: { backgroundColor: p.brandAction, paddingHorizontal: 10, borderRadius: 11, alignItems: "center", gap: 5, minHeight: 44, justifyContent: "center", flexDirection: "row" },
  statusActionLabel: { ...typography.caption, color: p.onAction, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 9 },
  menuCard: { width: "48.5%", borderWidth: 1, borderColor: p.borderColor, borderRadius: 14, backgroundColor: p.surface, minHeight: 76, padding: 10, justifyContent: "center" },
  menuPressed: { opacity: .7 },
  menuTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 7 },
  menuIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  menuTitle: { ...typography.bodyStrong, color: p.color, fontSize: 14, flex: 1 },
  warning: { gap: 8 },
  muted: { ...typography.bodySm, color: p.colorMuted },
}); }
