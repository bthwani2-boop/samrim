import { borders, radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { type MobileIconName } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type Destination = "operations" | "promotions" | "team" | "settings";
type MenuItem = Readonly<{ label: string; icon: MobileIconName; destination?: Destination; href?: Href }>;

export function PartnerMore() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    screen: { gap: spacing[3], paddingTop: spacing[3] },
    title: { ...typography.titleMd, color: theme.color },
    context: { ...typography.caption, color: theme.colorMuted },
    panel: { backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: borders.hairline, borderColor: theme.borderColor, overflow: "hidden" },
    entry: { minHeight: 60, alignItems: "center", flexDirection: "row", gap: spacing[3], paddingHorizontal: spacing[4] },
    entryPressed: { backgroundColor: theme.surfaceInset },
    divider: { borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, marginHorizontal: spacing[4] },
    icon: { alignItems: "center", justifyContent: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: 38, width: 38 },
    entryLabel: { ...typography.bodyStrong, color: theme.color, flex: 1, textAlign: "right" },
    message: { ...typography.bodySm, color: theme.colorMuted },
  }), [theme]);
  const { selectedStore, stores, selectStore, state, reload } = usePartnerStoreScope();
  const firstManageable = stores.find((store) => store.owned || store.permissions.includes("store_operations") || store.permissions.includes("promotions"));
  useEffect(() => {
    if (state.kind !== "ready" || !firstManageable || !selectedStore) return;
    const permitted = selectedStore.owned || selectedStore.permissions.includes("store_operations") || selectedStore.permissions.includes("promotions");
    if (!permitted && firstManageable.id !== selectedStore.id) selectStore(firstManageable.id);
  }, [state.kind, firstManageable, selectedStore, selectStore]);

  const can = (permission: "store_operations" | "promotions") => Boolean(selectedStore && (selectedStore.owned || selectedStore.permissions.includes(permission)));
  const actions: MenuItem[] = [
    ...(can("store_operations") ? [{ label: "التشغيل وساعات العمل", icon: "store" as const, destination: "operations" as const }] : []),
    ...(can("promotions") ? [{ label: "العروض والتخفيضات", icon: "offers" as const, destination: "promotions" as const }] : []),
    ...(selectedStore?.owned ? [
      { label: "الفريق والصلاحيات", icon: "account" as const, destination: "team" as const },
      { label: "بيانات المتجر", icon: "edit" as const, destination: "settings" as const },
    ] : []),
    ...(state.kind === "ready" && !stores.length ? [{ label: "إضافة متجر", icon: "add" as const, href: "/onboarding" as Href }] : []),
    { label: "الحساب والإعدادات", icon: "account", href: "/account" as Href },
  ];

  function navigate(item: MenuItem) {
    if (item.destination) router.push({ pathname: "/store", params: { section: item.destination } } as Href);
    else if (item.href) router.push(item.href);
  }

  return <View style={styles.screen}>
    <Text style={styles.title}>المزيد</Text>
    {stores.length > 1 ? <PartnerStoreScopeSelector requiredPermissions={["store_operations", "promotions"]} /> : null}
    {selectedStore && firstManageable ? <Text style={styles.context}>{selectedStore.name}</Text> : null}
    {state.kind === "error" ? <View style={{ gap: spacing[2] }}>
      <Text accessibilityRole="alert" style={styles.message}>تعذر تحميل المتاجر</Text>
      <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => void reload()} />
    </View> : null}
    <View style={styles.panel}>
      {actions.map((item, index) => <View key={item.label}>
        <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={() => navigate(item)} style={({ pressed }) => [styles.entry, pressed && styles.entryPressed]}>
          <View style={styles.icon}><BthwaniIcon name={item.icon} size={21} color={theme.interactiveText} /></View>
          <Text style={styles.entryLabel}>{item.label}</Text>
          <BthwaniIcon name="back" size={18} color={theme.colorMuted} />
        </Pressable>
        {index < actions.length - 1 ? <View style={styles.divider} /> : null}
      </View>)}
    </View>
  </View>;
}
