import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, useAppearanceTheme, type MobileIconName } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability } from "./store-readback-client";
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
    if (storeID) void readOwnStoreOperationalAvailability(storeID).then(
      (value) => { if (active) setAvailability(value); },
      () => { if (active) setAvailabilityError(true); },
    );
    return () => { active = false; };
  }, [storeID]));
  const orderable = availability?.orderabilityByMode.some((mode) => mode.state === "OPEN_FOR_ORDERS") ?? false;
  const stopped = availability?.availability.paused ?? false;
  const statusTitle = availabilityError ? "تعذر قراءة حالة المتجر" : !availability ? "جارٍ التحقق من الحالة" : stopped ? "استقبال الطلبات متوقف" : orderable ? "المتجر مفتوح" : "المتجر مغلق";
  const statusDetail = !availability ? "حالة استقبال الطلبات" : stopped ? "الإيقاف مؤقت، يمكنك استئناف الطلبات" : orderable ? "جاهز لاستقبال الطلبات الآن" : "راجع ساعات العمل وجاهزية المتجر";
  const actions: MenuItem[] = [
    ...(canOperate ? [{ label: "التشغيل وساعات العمل", icon: "store" as const, description: "الجاهزية والجدول وطرق التسليم", destination: "operations" as const }] : []),
    ...(can("promotions") ? [{ label: "العروض والتخفيضات", icon: "offers" as const, description: "إنشاء ومتابعة العروض", destination: "promotions" as const }] : []),
    ...(selectedStore && (selectedStore.owned || selectedStore.permissions.includes("catalog")) ? [{ label: "أدوات الكتالوج", icon: "cart" as const, description: "الأقسام والإضافات والاستيراد", href: "/products?panel=tools" as Href }] : []),
    ...(selectedStore?.owned ? [
      { label: "الفريق والصلاحيات", icon: "account" as const, description: "الموظفون وأذونات الوصول", destination: "team" as const },
      { label: "الصور والاتفاقيات", icon: "edit" as const, description: "صور المتجر والعقود", destination: "settings" as const },
    ] : []),
    ...(state.kind === "ready" && !stores.length ? [{ label: "حالة الانضمام", icon: "store" as const, description: "متابعة طلب الشراكة", href: "/onboarding" as Href }] : []),
    { label: "الحساب والإعدادات", icon: "account", description: "معلومات الحساب وتفضيلاته", href: "/account" as Href },
  ];
  function navigate(item: MenuItem) {
    if (item.destination) router.push({ pathname: "/store", params: { section: item.destination } } as Href);
    else if (item.href) router.push(item.href);
  }
  const operationalItem: MenuItem = { label: "التشغيل وساعات العمل", icon: "store", description: "إعدادات التشغيل", destination: "operations" };
  return <View style={styles.screen}>
    {stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={["store_operations", "promotions"]} /> : null}
    {state.kind === "error" ? <View style={styles.warning}><Text style={styles.muted}>تعذر تحميل المتاجر</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void reload()} /></View> : null}
    <Text accessibilityRole="header" style={styles.pageTitle}>المزيد</Text>
    <Text style={styles.subtitle}>إدارة متجرك وإعداداته في مكان واحد</Text>
    {canOperate ? <View style={styles.statusCard} accessibilityLabel="حالة المتجر">
      <View style={styles.statusCopy}>
        <View style={styles.statusHeading}><View style={[styles.dot, { backgroundColor: orderable && !stopped ? theme.success : theme.warning }]} /><Text style={styles.statusTitle}>{statusTitle}</Text></View>
        <Text style={styles.statusCaption}>{statusDetail}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="تغيير ساعات العمل واستقبال الطلبات" onPress={() => navigate(operationalItem)} style={styles.statusAction}>
        <BthwaniIcon name="store" color={theme.brandAction} size={24} />
        <Text style={styles.statusActionLabel}>إدارة التشغيل</Text>
      </Pressable>
    </View> : null}
    <View style={styles.grid}>
      {actions.map((item, index) => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => navigate(item)} style={({ pressed }) => [styles.menuCard, pressed && styles.menuPressed]}>
        <View style={styles.menuTop}><View style={[styles.menuIcon, { backgroundColor: index % 3 === 0 ? theme.actionSoft : theme.surfaceRaised }]}><BthwaniIcon name={item.icon} size={25} color={index % 3 === 0 ? theme.brandAction : theme.color} /></View><BthwaniIcon name="back" size={16} color={theme.colorMuted} /></View>
        <Text style={styles.menuTitle}>{item.label}</Text>
        <Text style={styles.menuDetail} numberOfLines={2}>{item.description}</Text>
      </Pressable>)}
    </View>
    <View style={styles.appearance}><AppearancePicker compact title="المظهر" helper="" /></View>
  </View>;
}

function createStyles(p: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  screen: { paddingTop: spacing[4], paddingBottom: spacing[6], gap: spacing[3] },
  pageTitle: { ...typography.titleLg, fontSize: 30, fontWeight: "800", color: p.color },
  subtitle: { ...typography.bodySm, color: p.colorMuted, marginTop: -8, marginBottom: 6 },
  statusCard: { backgroundColor: p.actionSoft, borderColor: p.brandAction, borderWidth: 1, borderRadius: 22, padding: 16, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 104 },
  statusCopy: { flex: 1, gap: 7, alignItems: "flex-start" },
  statusHeading: { flexDirection: "row", gap: 8, alignItems: "center" },
  statusTitle: { ...typography.titleSm, color: p.color, fontWeight: "800" },
  statusCaption: { ...typography.caption, color: p.colorMuted },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusAction: { backgroundColor: p.actionSoft, padding: 10, borderRadius: 15, alignItems: "center", gap: 5, minWidth: 90, minHeight: 70, justifyContent: "center" },
  statusActionLabel: { ...typography.caption, color: p.color },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10 },
  menuCard: { width: "48.4%", borderWidth: 1, borderColor: p.borderColor, borderRadius: 17, backgroundColor: p.surface, minHeight: 151, padding: 13, gap: 8 },
  menuPressed: { opacity: .75 },
  menuTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle: { ...typography.bodyStrong, color: p.color, fontSize: 14 },
  menuDetail: { ...typography.caption, color: p.colorMuted, lineHeight: 19 },
  appearance: { backgroundColor: p.surface, borderRadius: 17, borderWidth: 1, borderColor: p.borderColor, padding: 12 },
  warning: { gap: 8 },
  muted: { ...typography.bodySm, color: p.colorMuted },
}); }
