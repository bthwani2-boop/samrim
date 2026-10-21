import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { type PropsWithChildren, useEffect, useMemo, useRef, useState } from "react";
import { type ColorValue, Modal, Pressable, ScrollView, StyleSheet, Text, type TextInput, View } from "react-native";
import { usePartnerStoreScope } from "../features/partner-onboarding/partner-store-scope-context";
import { SafeAreaView } from "react-native-safe-area-context";

type PartnerSearchNavigation = {
  navigate: (screen: "orders", params: { focus: "search" }) => void;
  setParams: (params: { focus?: string; q?: string }) => void;
};

export function PartnerScrollScreen({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}

export function createPartnerTabOptions(theme: ReturnType<typeof resolveTheme>, canSearchOrders: boolean) {
  const styles = createStyles(theme);
  const icons = { orders: "orders", products: "cart", wallet: "wallet", more: "categories" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: ({ route: headerRoute, navigation }: { route: { name: string; params?: unknown }; navigation: unknown }) => {
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[] } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><PartnerHeader canSearchOrders={canSearchOrders && headerRoute.name === "orders"} focus={params?.focus} searchQuery={params?.q} navigation={navigation as PartnerSearchNavigation} styles={styles} /></SafeAreaView>;
    },
    tabBarActiveBackgroundColor: theme.actionSoft,
    tabBarActiveTintColor: theme.interactiveText,
    tabBarHideOnKeyboard: true,
    tabBarInactiveTintColor: theme.colorMuted,
    tabBarShowIcon: true,
    tabBarIcon: ({ color }: { color: ColorValue }) => { const icon = icons[route.name as keyof typeof icons]; return icon ? <BthwaniIcon name={icon} color={color} size={sizing.iconLg} /> : null; },
    tabBarItemStyle: styles.navigationItem,
    tabBarLabelStyle: styles.navigationLabel,
    tabBarStyle: styles.navigation,
    sceneStyle: styles.scene,
  });
}

function PartnerHeader({ canSearchOrders, focus: rawFocus, searchQuery: rawQuery, navigation, styles }: { canSearchOrders: boolean; focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation: PartnerSearchNavigation; styles: ReturnType<typeof createStyles> }) {
  const router = useRouter();
  const { stores, selectedStore, selectStore } = usePartnerStoreScope();
  const [pickerOpen, setPickerOpen] = useState(false);
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const isSearchOpen = focus === "search";
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isSearchOpen]);

  return <><View style={styles.header}>{isSearchOpen ? <View style={styles.headerSearchActions}><BthwaniSearchField accessibilityLabel="البحث في الطلبات" autoCapitalize="none" autoCorrect={false} containerStyle={styles.headerSearchField} inputRef={searchInputRef} onChangeText={(value) => navigation.setParams({ q: value })} onClear={() => navigation.setParams({ q: "" })} placeholder="ابحث برقم الطلب أو العنوان أو المنتج" returnKeyType="search" value={searchQuery} /><BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => navigation.setParams({ focus: "", q: "" })} size={sizing.controlMd} tone="soft" /></View> : <><Pressable style={styles.headerIdentity} accessibilityRole="button" accessibilityLabel={stores.length > 1 ? "اختيار المتجر الحالي" : "المتجر الحالي"} accessibilityState={{ disabled: stores.length < 2 }} disabled={stores.length < 2} onPress={() => setPickerOpen(true)}><Text numberOfLines={1} style={styles.brand}>{selectedStore?.name ?? "بثواني · الشريك"}</Text>{stores.length > 1 ? <Text style={styles.pickerArrow}>⌄</Text> : null}</Pressable><View style={styles.headerActions}>{canSearchOrders ? <BthwaniIconButton icon="search" label="البحث في الطلبات" onPress={() => navigation.navigate("orders", { focus: "search" })} size={sizing.controlMd} tone="soft" /> : null}<BthwaniIconButton icon="notifications" label="الإشعارات" onPress={() => router.push("/notifications" as Href)} size={sizing.controlMd} tone="soft" /></View></>}</View><Modal visible={pickerOpen && stores.length > 1} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}><View style={styles.pickerBackdrop}><View style={styles.pickerPanel}><Text style={styles.pickerTitle}>اختيار المتجر</Text>{stores.map((store) => <Pressable key={store.id} accessibilityRole="button" accessibilityState={{ selected: store.id === selectedStore?.id }} onPress={() => { selectStore(store.id); setPickerOpen(false); }} style={styles.pickerStore}><Text style={styles.pickerStoreLabel}>{store.name}</Text>{store.id === selectedStore?.id ? <BthwaniIcon name="success" size={sizing.iconMd} /> : null}</Pressable>)}<Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={styles.pickerClose}><Text style={styles.pickerStoreLabel}>إغلاق</Text></Pressable></View></View></Modal></>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", minHeight: sizing.controlLg, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
    headerIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing[2] },
    pickerArrow: { ...typography.titleMd, color: theme.colorMuted },
    pickerBackdrop: { backgroundColor: "rgba(0,0,0,0.38)", flex: 1, justifyContent: "center", padding: spacing[5] },
    pickerPanel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.lg, padding: spacing[4], gap: spacing[2] },
    pickerTitle: { ...typography.titleMd, color: theme.color, marginBottom: spacing[2] },
    pickerStore: { minHeight: 52, justifyContent: "space-between", flexDirection: "row", alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, paddingVertical: spacing[2] },
    pickerStoreLabel: { ...typography.bodyStrong, color: theme.color },
    pickerClose: { minHeight: 48, justifyContent: "center", alignItems: "center" },
    brand: { ...typography.titleMd, color: theme.color },
    headerActions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    headerSearchActions: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    headerSearchField: { flex: 1, minWidth: 0 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingHorizontal: spacing[3] },
    navigationItem: { borderRadius: radius.md, paddingHorizontal: spacing[2] },
    navigationLabel: { ...typography.caption },
  });
}
