import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme, type MobileIconName } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability } from "./store-readback-client";
import { onStoreAvailabilityChanged } from "./store-availability-events";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type Destination = "operations" | "promotions" | "team" | "settings";
type MenuItem = Readonly<{ label: string; icon: MobileIconName; description: string; destination?: Destination; href?: Href }>;

export function PartnerMore() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { selectedStore, stores, selectStore, state, reload } = usePartnerStoreScope();
  const [availability, setAvailability] = useState<PartnerStoreOperationalAvailabilityResponse | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const firstManageable = stores.find((store) => store.owned || store.permissions.includes("store_operations") || store.permissions.includes("promotions"));
  useEffect(() => {
    if (state.kind !== "ready" || !firstManageable || !selectedStore) return;
    const permitted = selectedStore.owned || selectedStore.permissions.includes("store_operations") || selectedStore.permissions.includes("promotions");
    if (!permitted && firstManageable.id !== selectedStore.id) selectStore(firstManageable.id);
  }, [state.kind, firstManageable, selectedStore, selectStore]);
  const can = (permission: "store_operations" | "promotions") => Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes(permission)));
  const canOperate = can("store_operations");
  const storeID = canOperate ? selectedStore?.id : undefined;
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
    ...(canOperate ? [{ label: "التشغيل", icon: "store" as const, description: "الجاهزية والجدول وطرق التسليم", destination: "operations" as const }] : []),
    ...(can("promotions") ? [{ label: "العروض", icon: "offers" as const, description: "إنشاء ومتابعة العروض", destination: "promotions" as const }] : []),
    ...(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? [{ label: "الكتالوج", icon: "cart" as const, description: "الأقسام والإضافات والاستيراد", href: "/products?panel=tools" as Href }] : []),
    ...(selectedStore?.owned ? [
      { label: "الفريق", icon: "account" as const, description: "الموظفون وأذونات الوصول", destination: "team" as const },
      { label: "الصور", icon: "edit" as const, description: "صور المتجر والعقود", destination: "settings" as const },
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
    {stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={["store_operations", "promotions"]} /> : null}
    {state.kind === "error" ? <View style={styles.warning}><Text style={styles.muted}>تعذر تحميل المتاجر</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void reload()} /></View> : null}
    {canOperate ? <View style={styles.statusCard} accessibilityLabel="حالة المتجر">
      <View style={styles.statusCopy}>
        <View style={styles.statusHeading}><View style={[styles.dot, { backgroundColor: orderable && !stopped ? theme.success : theme.warning }]} /><Text style={styles.statusTitle}>{statusTitle}</Text></View>

      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="تغيير ساعات العمل واستقبال الطلبات" onPress={() => navigate(operationalItem)} style={styles.statusAction}>
        <BthwaniIcon name="store" color={theme.onAction} size={18} />
        <Text style={styles.statusActionLabel}>إدارة التشغيل</Text>
      </Pressable>
    </View> : null}
    <View style={styles.grid}>
      {actions.map((item, index) => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => navigate(item)} style={({ pressed }) => [styles.menuCard, pressed && styles.menuPressed]}>
        <View style={styles.menuTop}><View style={[styles.menuIcon, { backgroundColor: index % 3 === 0 ? theme.actionSoft : theme.surfaceRaised }]}><BthwaniIcon name={item.icon} size={20} color={index % 3 === 0 ? theme.brandAction : theme.color} /></View><Text numberOfLines={1} style={styles.menuTitle}>{item.label}</Text></View>
      </Pressable>)}
    </View>
  </View>;
}

function createStyles(p: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  screen: { paddingTop: 10, paddingBottom: 12, gap: 10 },
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
