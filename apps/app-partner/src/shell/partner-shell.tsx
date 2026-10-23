import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";

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

export function createPartnerTabOptions(theme: ReturnType<typeof resolveTheme>, canSearchOrders: boolean, desktopWeb = false) {
  const styles = createStyles(theme);
  const icons = { orders: "orders", products: "cart", wallet: "wallet", more: "categories" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: ({ route: headerRoute, navigation }: { route: { name: string; params?: unknown }; navigation: unknown }) => {
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[] } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><PartnerHeader title={headerRoute.name === "orders" ? "الطلبات" : headerRoute.name === "products" ? "المنتجات" : headerRoute.name === "wallet" ? "المحفظة" : headerRoute.name === "account" ? "الحساب" : headerRoute.name === "onboarding" ? "الانضمام" : headerRoute.name === "store" ? ((headerRoute.params as { section?: string } | undefined)?.section === "promotions" ? "العروض" : (headerRoute.params as { section?: string } | undefined)?.section === "team" ? "الفريق" : (headerRoute.params as { section?: string } | undefined)?.section === "settings" ? "الصور" : "التشغيل") : "المزيد"} canSearchOrders={canSearchOrders && headerRoute.name === "orders"} focus={params?.focus} searchQuery={params?.q} navigation={navigation as PartnerSearchNavigation} styles={styles} /></SafeAreaView>;
    },
    tabBarPosition: desktopWeb ? "right" as const : "bottom" as const,
    tabBarVariant: desktopWeb ? "material" as const : "uikit" as const,
    tabBarActiveBackgroundColor: theme.actionSoft,
    tabBarActiveTintColor: theme.interactiveText,
    tabBarHideOnKeyboard: true,
    tabBarInactiveTintColor: theme.colorMuted,
    tabBarShowIcon: true,
    tabBarIcon: ({ color }: { color: ColorValue }) => { const icon = icons[route.name as keyof typeof icons]; return icon ? <BthwaniIcon name={icon} color={color} size={sizing.iconLg} /> : null; },
    tabBarItemStyle: desktopWeb ? styles.desktopNavigationItem : styles.navigationItem,
    tabBarLabelStyle: styles.navigationLabel,
    tabBarStyle: desktopWeb ? styles.desktopNavigation : styles.navigation,
    sceneStyle: styles.scene,
  });
}

function PartnerHeader({ title, canSearchOrders, focus: rawFocus, searchQuery: rawQuery, navigation, styles }: { title: string; canSearchOrders: boolean; focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation: PartnerSearchNavigation; styles: ReturnType<typeof createStyles> }) {
  const theme = useAppearanceTheme();
  const { stores, selectedStore, selectStore } = usePartnerStoreScope();
  const [pickerOpen, setPickerOpen] = useState(false);
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const isSearchOpen = canSearchOrders && focus === "search";
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isSearchOpen]);

  return <>
    <View style={styles.header}>
      {isSearchOpen ? <View style={styles.headerSearchActions}>
        <BthwaniSearchField accessibilityLabel="البحث في الطلبات" autoCapitalize="none" autoCorrect={false} containerStyle={styles.headerSearchField} inputRef={searchInputRef} onChangeText={(value) => navigation.setParams({ q: value })} onClear={() => navigation.setParams({ q: "" })} placeholder="ابحث في الطلبات" returnKeyType="search" value={searchQuery} />
        <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => navigation.setParams({ focus: "", q: "" })} size={sizing.controlMd} tone="soft" />
      </View> : <>
        <Text accessibilityRole="header" style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerActions}>
          {canSearchOrders ? <BthwaniIconButton icon="search" label="البحث في الطلبات" onPress={() => navigation.navigate("orders", { focus: "search" })} size={sizing.controlMd} tone="soft" /> : null}
          {stores.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="تبديل المتجر" onPress={() => setPickerOpen(true)} style={styles.storePickerButton}><BthwaniIcon name="store" size={20} color={theme.brandAction} /><Text style={styles.pickerArrow}>⌄</Text></Pressable> : null}
        </View>
      </>}
    </View>
    <Modal visible={pickerOpen && stores.length > 1} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
      <View style={styles.pickerBackdrop}><View style={styles.pickerPanel}>
        <Text style={styles.pickerTitle}>اختيار المتجر</Text>
        <ScrollView accessibilityLabel="قائمة المتاجر" nestedScrollEnabled style={styles.pickerList} showsVerticalScrollIndicator>
          {stores.map((store) => <Pressable key={store.id} accessibilityRole="button" accessibilityState={{ selected: store.id === selectedStore?.id }} onPress={() => { selectStore(store.id); setPickerOpen(false); }} style={styles.pickerStore}><Text style={styles.pickerStoreLabel}>{store.name}</Text>{store.id === selectedStore?.id ? <BthwaniIcon name="success" size={sizing.iconMd} /> : null}</Pressable>)}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={() => setPickerOpen(false)} style={styles.pickerClose}><Text style={styles.pickerStoreLabel}>إغلاق</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", minHeight: 48, paddingHorizontal: spacing[4], paddingVertical: 5 },
    headerTitle: { ...typography.titleLg, fontSize: 23, fontWeight: "800", color: theme.color, flex: 1 },
    storePickerButton: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 38, paddingHorizontal: 9, borderRadius: radius.sm, backgroundColor: theme.actionSoft },
    pickerArrow: { ...typography.titleMd, color: theme.colorMuted },
    pickerBackdrop: { backgroundColor: "rgba(0,0,0,0.38)", flex: 1, justifyContent: "center", padding: spacing[5] },
    pickerPanel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.lg, maxHeight: "85%", padding: spacing[4], gap: spacing[2] },
    pickerTitle: { ...typography.titleMd, color: theme.color, marginBottom: spacing[2] },
    pickerList: { flexShrink: 1, maxHeight: "70%" },
    pickerStore: { minHeight: 52, justifyContent: "space-between", flexDirection: "row", alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, paddingVertical: spacing[2] },
    pickerStoreLabel: { ...typography.bodyStrong, color: theme.color },
    pickerClose: { minHeight: 48, justifyContent: "center", alignItems: "center" },
    headerActions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    headerSearchActions: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    headerSearchField: { flex: 1, minWidth: 0 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[3], paddingHorizontal: spacing[4], alignSelf: "center", maxWidth: 1280, width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, paddingHorizontal: spacing[2] },
    desktopNavigation: { backgroundColor: theme.surface, borderLeftColor: theme.borderColorStrong, borderLeftWidth: borders.hairline, width: 208, paddingHorizontal: spacing[2], paddingVertical: spacing[4] },
    desktopNavigationItem: { borderRadius: radius.lg, marginVertical: spacing[1], minHeight: sizing.controlLg },
    navigationItem: { borderRadius: radius.md, paddingHorizontal: spacing[2] },
    navigationLabel: { ...typography.caption },
  });
}
