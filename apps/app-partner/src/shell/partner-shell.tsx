import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";

import { PartnerOrderAvailability } from "../features/partner-onboarding/partner-order-availability";
import { dispatchPartnerProductAction } from "./partner-product-actions";

import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, type ColorValue, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, type TextInput, View } from "react-native";
import { usePartnerStoreScope } from "../features/partner-onboarding/partner-store-scope-context";
import { SafeAreaView } from "react-native-safe-area-context";

type PartnerSearchNavigation = {
  navigate: ((screen: "orders" | "products", params: { focus: "search" }) => void) & ((screen: "more") => void);
  canGoBack: () => boolean;
  goBack: () => void;
  setParams: (params: { focus?: string; q?: string }) => void;
};

export function PartnerScrollScreen({ children }: PropsWithChildren) {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const origin = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  // An Expo Tab screen can have Orders in its internal back history even when
  // the user entered this management screen from More. Respect that origin.
  useFocusEffect(useCallback(() => {
    const destination = origin === "more" ? "/more" : origin === "products" ? "/products" : null;
    if (Platform.OS !== "android" || !destination) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      router.navigate(destination as Href);
      return true;
    });
    return () => sub.remove();
  }, [origin, router]));
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
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[]; returnTo?: string; panel?: string } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><PartnerHeader title={headerRoute.name === "orders" ? "الطلبات" : headerRoute.name === "products" ? ((headerRoute.params as { panel?: string } | undefined)?.panel === "tools" ? "الكتالوج" : "المنتجات") : headerRoute.name === "wallet" ? "المحفظة" : headerRoute.name === "insights" ? "الأداء" : headerRoute.name === "account" ? "الحساب" : headerRoute.name === "onboarding" ? "الانضمام" : headerRoute.name === "store" ? ((headerRoute.params as { section?: string } | undefined)?.section === "promotions" ? "العروض" : (headerRoute.params as { section?: string } | undefined)?.section === "team" ? "الفريق" : (headerRoute.params as { section?: string } | undefined)?.section === "settings" ? "ملف المتجر" : "التشغيل") : "المزيد"} isOrders={headerRoute.name === "orders"} isProducts={headerRoute.name === "products" && params?.panel !== "tools"} isSubpage={["store", "account", "onboarding", "insights"].includes(headerRoute.name) || (headerRoute.name === "products" && params?.panel === "tools")} returnTo={params?.returnTo} canSearchOrders={canSearchOrders && headerRoute.name === "orders"} focus={params?.focus} searchQuery={params?.q} navigation={navigation as PartnerSearchNavigation} styles={styles} /></SafeAreaView>;
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

function PartnerHeader({ title, isOrders, isProducts, isSubpage, returnTo, canSearchOrders, focus: rawFocus, searchQuery: rawQuery, navigation, styles }: { title: string; isOrders: boolean; isProducts: boolean; isSubpage: boolean; returnTo?: string | undefined; canSearchOrders: boolean; focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation: PartnerSearchNavigation; styles: ReturnType<typeof createStyles> }) {
  const theme = useAppearanceTheme();
  const { stores, selectedStore, selectStore } = usePartnerStoreScope();
  const [pickerOpen, setPickerOpen] = useState(false);
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const canSearch = canSearchOrders || isProducts;
  const isSearchOpen = canSearch && focus === "search";
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isSearchOpen]);

  return <>
    <View style={styles.header}>
      {isSearchOpen ? <View style={styles.headerSearchActions}>
        <BthwaniSearchField accessibilityLabel={isProducts ? "بحث المنتجات" : "البحث في الطلبات"} autoCapitalize="none" autoCorrect={false} containerStyle={styles.headerSearchField} inputRef={searchInputRef} onChangeText={(value) => navigation.setParams({ q: value })} onClear={() => navigation.setParams({ q: "" })} placeholder={isProducts ? "ابحث عن منتج" : "ابحث في الطلبات"} returnKeyType="search" value={searchQuery} />
        <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => navigation.setParams({ focus: "", q: "" })} size={sizing.controlSm} tone="soft" />
      </View> : <>
        <View style={styles.headerMain}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{title}</Text>
          {isOrders && selectedStore && (selectedStore.owned || selectedStore.permissions.includes("store_operations")) ? <PartnerOrderAvailability key={selectedStore.id} storeID={selectedStore.id} published={selectedStore.publicationState === "published"} /> : null}
        </View>
        <View style={styles.headerActions}>
          {isProducts ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="إضافة منتج" onPress={() => dispatchPartnerProductAction("create")} style={[styles.productHeaderAction, styles.productHeaderPrimary]}><BthwaniIcon name="cart" size={15} color={theme.onAction} /><Text style={styles.productHeaderPrimaryLabel}>إضافة</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="تعديل المنتجات" onPress={() => dispatchPartnerProductAction("prices")} style={styles.productHeaderAction}><BthwaniIcon name="edit" size={15} color={theme.color} /><Text style={styles.productHeaderActionLabel}>تعديل</Text></Pressable>
          </> : null}
          {isSubpage && Platform.OS === "web" ? <BthwaniIconButton icon="back" label="رجوع" onPress={() => returnTo === "more" ? navigation.navigate("more") : navigation.canGoBack() ? navigation.goBack() : navigation.navigate("more")} size={sizing.controlSm} tone="soft" /> : null}
          {canSearch ? <BthwaniIconButton icon="search" label={isProducts ? "بحث المنتجات" : "البحث في الطلبات"} onPress={() => { if (isProducts) dispatchPartnerProductAction("list"); navigation.navigate(isProducts ? "products" : "orders", { focus: "search" }); }} size={sizing.controlSm} tone="soft" /> : null}
          {stores.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="تبديل المتجر" onPress={() => setPickerOpen(true)} style={styles.storePickerButton}><BthwaniIcon name="store" size={18} color={theme.brandAction} /><Text style={styles.pickerArrow}>⌄</Text></Pressable> : null}
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
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", height: 50, paddingHorizontal: spacing[4] },
    headerMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
    headerTitle: { ...typography.titleSm, fontSize: 19, fontWeight: "800", color: theme.color, flexShrink: 1 },
    storePickerButton: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 38, paddingHorizontal: 9, borderRadius: radius.sm, backgroundColor: theme.actionSoft },
    pickerArrow: { ...typography.titleMd, color: theme.colorMuted },
    pickerBackdrop: { backgroundColor: "rgba(0,0,0,0.38)", flex: 1, justifyContent: "center", padding: spacing[5] },
    pickerPanel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.lg, maxHeight: "85%", padding: spacing[4], gap: spacing[2] },
    pickerTitle: { ...typography.titleMd, color: theme.color, marginBottom: spacing[2] },
    pickerList: { flexShrink: 1, maxHeight: "70%" },
    pickerStore: { minHeight: 52, justifyContent: "space-between", flexDirection: "row", alignItems: "center", borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, paddingVertical: spacing[2] },
    pickerStoreLabel: { ...typography.bodyStrong, color: theme.color },
    pickerClose: { minHeight: 48, justifyContent: "center", alignItems: "center" },
    headerActions: { alignItems: "center", flexDirection: "row", gap: 5 },
    productHeaderAction: { minHeight: 33, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 9, paddingHorizontal: 7, flexDirection: "row", gap: 3, alignItems: "center" },
    productHeaderPrimary: { backgroundColor: theme.brandAction, borderColor: theme.brandAction },
    productHeaderActionLabel: { ...typography.caption, color: theme.color, fontWeight: "700" },
    productHeaderPrimaryLabel: { ...typography.caption, color: theme.onAction, fontWeight: "700" },
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
