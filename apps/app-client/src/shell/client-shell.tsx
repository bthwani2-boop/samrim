import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { type PropsWithChildren, useEffect, useMemo, useRef } from "react";
import { type ColorValue, ScrollView, StyleSheet, Text, type TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useServiceCityScope } from "../features/service-city/service-city-scope";

type ClientSearchNavigation = {
  navigate: (screen: "home", params: { focus: "search" }) => void;
  setParams: (params: { focus?: string; q?: string }) => void;
};

export function ClientPublicShell({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <SafeAreaView edges={["top"]} style={styles.shell}>
      <ClientPublicHeader safeArea={false} />
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

export function ClientPublicHeader({ safeArea = true }: { safeArea?: boolean }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { focus, q } = useLocalSearchParams<{ focus?: string | string[]; q?: string | string[] }>();
  const header = <ClientHeader context="اكتشاف المتاجر" searchOnCurrentRoute focus={focus} searchQuery={q} styles={styles} />;
  return safeArea ? <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>{header}</SafeAreaView> : header;
}

function ClientHeader({ context, searchOnCurrentRoute = false, focus: rawFocus, searchQuery: rawQuery, navigation, styles }: { context: string; searchOnCurrentRoute?: boolean; focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation?: ClientSearchNavigation; styles: ReturnType<typeof createStyles> }) {
  const router = useRouter();
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const isSearchOpen = focus === "search";
  const searchInputRef = useRef<TextInput>(null);
  const { cities, clearSelectedCity, selectedCityID } = useServiceCityScope();
  const cityName = cities.find((city) => city.id === selectedCityID)?.displayNameAr ?? "اختر المدينة";

  useEffect(() => {
    if (!isSearchOpen) return;
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isSearchOpen]);

  return (
    <View style={styles.header}>
      {isSearchOpen ? (
        <View style={styles.headerSearchActions}>
          <BthwaniSearchField
            accessibilityLabel="البحث في المتاجر"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.headerSearchField}
            inputRef={searchInputRef}
            onChangeText={(value) => { if (navigation) navigation.setParams({ q: value }); else router.setParams({ q: value }); }}
            onClear={() => { if (navigation) navigation.setParams({ q: "" }); else router.setParams({ q: "" }); }}
            placeholder="ابحث باسم المتجر"
            returnKeyType="search"
            value={searchQuery}
          />
          <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => { if (navigation) navigation.setParams({ focus: "", q: "" }); else router.setParams({ focus: "", q: "" }); }} size={sizing.controlMd} tone="soft" />
        </View>
      ) : (
        <>
          <View style={styles.headerIdentity}>
            <Text style={styles.brand}>بثواني</Text>
            <View style={styles.headerMeta}>
              <Text style={styles.context}>{context}</Text>
              <BthwaniChip accessibilityLabel="تغيير مدينة الخدمة" icon="location" label={cityName} onPress={() => void clearSelectedCity()} style={styles.headerCity} />
            </View>
          </View>
          <View style={styles.headerActions}>
            <BthwaniIconButton icon="search" label="البحث عن متجر" onPress={() => { if (searchOnCurrentRoute) { if (navigation) navigation.setParams({ focus: "search" }); else router.setParams({ focus: "search" }); } else if (navigation) navigation.navigate("home", { focus: "search" }); else router.push("/home?focus=search" as Href); }} size={sizing.controlMd} tone="soft" />
            <BthwaniIconButton icon="notifications" label="الإشعارات" onPress={() => router.push("/notifications" as Href)} size={sizing.controlMd} tone="soft" />
            <BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlMd} tone="soft" />
          </View>
        </>
      )}
    </View>
  );
}

export function ClientScrollScreen({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

export function createClientTabOptions(theme: ReturnType<typeof resolveTheme>) {
  const styles = createStyles(theme);
  const icons = { home: "home", orders: "orders", wallet: "wallet", account: "account" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: ({ route: headerRoute, navigation }: { route: { params?: unknown }; navigation: unknown }) => {
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[] } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><ClientHeader context="مساحة العميل" searchOnCurrentRoute={route.name === "home"} focus={params?.focus} searchQuery={params?.q} navigation={navigation as ClientSearchNavigation} styles={styles} /></SafeAreaView>;
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

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    shell: { backgroundColor: theme.background, flex: 1 },
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", minHeight: 76, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
    headerIdentity: { alignItems: "flex-end", flex: 1, gap: spacing[1], minWidth: 0 },
    brand: { ...typography.titleMd, color: theme.color },
    context: { ...typography.caption, color: theme.colorMuted, marginTop: spacing[1] },
    headerMeta: { alignItems: "center", flexDirection: "row", gap: spacing[2], maxWidth: "100%" },
    headerCity: { backgroundColor: theme.actionSoft, borderColor: theme.borderColorStrong, flexShrink: 1, minHeight: sizing.controlSm, paddingHorizontal: spacing[2] },
    headerActions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    headerSearchActions: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    headerSearchField: { flex: 1, minWidth: 0 },
    content: { flex: 1 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surfaceRaised, borderTopColor: theme.borderColorStrong, borderTopWidth: borders.hairline, elevation: 8, minHeight: 84, paddingHorizontal: spacing[3], paddingTop: spacing[2], zIndex: 8 },
    navigationItem: { borderRadius: radius.lg, flex: 1, minHeight: sizing.controlLg, paddingHorizontal: spacing[2], paddingVertical: spacing[1], transform: [{ translateY: -spacing[4] }] },
    navigationLabel: { ...typography.label, marginTop: spacing[1] },
  });
}
