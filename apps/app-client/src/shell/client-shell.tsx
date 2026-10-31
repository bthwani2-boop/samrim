import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniChip, BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { type PropsWithChildren, useEffect, useMemo, useRef } from "react";
import { type ColorValue, ScrollView, StyleSheet, Text, type TextInputInstance, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClientNotificationAction } from "../features/notifications/client-notification-action";
import { serviceCityDisplayName, useServiceCityScope } from "../features/service-city/service-city-scope";

type ClientSearchNavigation = {
  navigate: (screen: "home", params: { focus: "search" }) => void;
};

export function ClientPublicShell({ children, hideHeader = false, hideSearchAction = false }: PropsWithChildren<{ hideHeader?: boolean; hideSearchAction?: boolean }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <SafeAreaView edges={hideHeader ? [] : ["top"]} style={[styles.shell, hideHeader && { backgroundColor: theme.surfaceInset }]}>
      {!hideHeader ? <ClientPublicHeader hideSearchAction={hideSearchAction} safeArea={false} /> : null}
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

export function ClientPublicHeader({ safeArea = true, hideSearchAction = false, hideAccountAction = false, homeVariant = false, homeCompact = false, homeTransparent = false, searchOnCurrentRoute = false, searchOpen, searchQuery, onSearchOpenChange, onSearchQueryChange }: { safeArea?: boolean; hideSearchAction?: boolean; hideAccountAction?: boolean; homeVariant?: boolean; homeCompact?: boolean; homeTransparent?: boolean; searchOnCurrentRoute?: boolean; searchOpen?: boolean; searchQuery?: string; onSearchOpenChange?: (open: boolean) => void; onSearchQueryChange?: (query: string) => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { focus, q } = useLocalSearchParams<{ focus?: string | string[]; q?: string | string[] }>();
  const header = <ClientHeader hideSearchAction={hideSearchAction} hideAccountAction={hideAccountAction} homeVariant={homeVariant} homeCompact={homeCompact} homeTransparent={homeTransparent} searchOnCurrentRoute={searchOnCurrentRoute} focus={searchOpen === undefined ? focus : searchOpen ? "search" : ""} searchQuery={searchQuery ?? q} onSearchOpenChange={onSearchOpenChange} onSearchQueryChange={onSearchQueryChange} styles={styles} />;
  return safeArea ? <SafeAreaView edges={["top"]} style={[styles.headerSafeArea, homeVariant && { backgroundColor: homeTransparent ? "transparent" : homeCompact ? "#EFF9FA" : theme.brandAction }]}>{header}</SafeAreaView> : header;
}

function ClientHeader({ searchOnCurrentRoute = false, hideSearchAction = false, hideAccountAction = false, homeVariant = false, homeCompact = false, homeTransparent = false, focus: rawFocus, searchQuery: rawQuery, navigation, onSearchOpenChange, onSearchQueryChange, styles }: { searchOnCurrentRoute?: boolean; hideSearchAction?: boolean; hideAccountAction?: boolean; homeVariant?: boolean; homeCompact?: boolean; homeTransparent?: boolean; focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation?: ClientSearchNavigation; onSearchOpenChange?: ((open: boolean) => void) | undefined; onSearchQueryChange?: ((query: string) => void) | undefined; styles: ReturnType<typeof createStyles> }) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const isSearchOpen = focus === "search";
  const searchInputRef = useRef<TextInputInstance>(null);
  const headerHeight = useSharedValue(166);
  const animatedHeaderStyle = useAnimatedStyle(() => ({ height: headerHeight.value }));
  useEffect(() => {
    if (!homeVariant) return;
    headerHeight.value = withTiming(homeCompact ? 64 : 166, { duration: 230, reduceMotion: ReduceMotion.System });
  }, [headerHeight, homeVariant, homeCompact]);
  const { cities, clearSelectedCity, selectedCityID } = useServiceCityScope();
  const cityName = serviceCityDisplayName(cities.find((city) => city.id === selectedCityID)?.displayNameAr);

  useEffect(() => {
    if (!isSearchOpen) return;
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [isSearchOpen]);

  return (
    <Animated.View style={[styles.header, homeVariant && styles.homeHeader, homeTransparent && { backgroundColor: "transparent" }, homeVariant && animatedHeaderStyle, homeVariant && { overflow: "hidden" }, homeCompact && styles.homeCompactHeader]}>
      {homeVariant && !homeCompact && !homeTransparent ? <LinearGradient pointerEvents="none" colors={[theme.brandAction, "#FA8177"]} style={styles.homeGradient} /> : null}
      {homeVariant && homeCompact ? (
        <View style={styles.homeCompactRow}>
          <BthwaniSearchField
            accessibilityLabel="ابحث عن متجر أو منتج"
            containerStyle={styles.homeCompactSearch}
            inputRef={searchInputRef}
            onFocus={() => onSearchOpenChange?.(true)}
            onChangeText={(value) => { onSearchQueryChange?.(value); if (!onSearchQueryChange) router.setParams({ q: value }); }}
            onClear={() => { onSearchQueryChange?.(""); if (!onSearchQueryChange) router.setParams({ q: "" }); }}
            placeholder="ابحث في بثواني"
            returnKeyType="search"
            value={searchQuery}
          />
          {isSearchOpen ? <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => { onSearchOpenChange?.(false); onSearchQueryChange?.(""); }} size={sizing.controlMd} tone="soft" /> : <BthwaniChip icon="location" label={cityName} onPress={() => void clearSelectedCity()} />}
        </View>
      ) : homeVariant ? (
        <>
          <View style={styles.homeHeaderTop}>
            <View style={styles.homeHeaderTools}>
              <ClientNotificationAction />
              <BthwaniIconButton icon="cart" label="سلة التسوق" onPress={() => router.push("/multi-store-checkout" as Href)} size={sizing.controlMd} tone="soft" />
            </View>
            <View style={styles.homeHeaderIdentity}>
              <Text style={styles.homeBrand}>بثواني</Text>
              <BthwaniChip accessibilityLabel={`مدينة الخدمة: ${cityName}`} icon="location" label={cityName} onPress={() => void clearSelectedCity()} style={styles.homeCity} />
            </View>
          </View>
          <View style={styles.homeHeaderSearchRow}><BthwaniSearchField
            accessibilityLabel="ابحث عن متجر أو منتج"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.homeSearchField}
            inputRef={searchInputRef}
            onFocus={() => onSearchOpenChange?.(true)}
            onChangeText={(value) => { onSearchQueryChange?.(value); if (!onSearchQueryChange) router.setParams({ q: value }); }}
            onClear={() => { onSearchQueryChange?.(""); if (!onSearchQueryChange) router.setParams({ q: "" }); }}
            placeholder="ابحث عن متجر أو منتج"
            returnKeyType="search"
            value={searchQuery}
          />
          {isSearchOpen ? <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => { onSearchOpenChange?.(false); onSearchQueryChange?.(""); }} size={sizing.controlMd} tone="soft" /> : null}
          </View>
        </>
      ) : isSearchOpen ? (
        <View style={styles.headerSearchActions}>
          <BthwaniSearchField
            accessibilityLabel="البحث عن متجر أو منتج"
            autoCapitalize="none"
            autoCorrect={false}
            containerStyle={styles.headerSearchField}
            inputRef={searchInputRef}
            onChangeText={(value) => { onSearchQueryChange?.(value); if (!onSearchQueryChange) router.setParams({ q: value }); }}
            onClear={() => { onSearchQueryChange?.(""); if (!onSearchQueryChange) router.setParams({ q: "" }); }}
            placeholder="ابحث عن متجر أو منتج"
            returnKeyType="search"
            value={searchQuery}
          />
          <BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => { onSearchOpenChange?.(false); onSearchQueryChange?.(""); if (!onSearchOpenChange && !onSearchQueryChange) router.setParams({ focus: "", q: "" }); }} size={sizing.controlMd} tone="soft" />
        </View>
      ) : (
        <>
          <View style={styles.headerIdentity}>
            <Text style={styles.brand}>بثواني</Text>
            <BthwaniChip accessibilityLabel={cityName} icon="location" label={cityName} onPress={() => void clearSelectedCity()} style={styles.headerCity} />
          </View>
          <View style={styles.headerActions}>
            {!hideSearchAction ? <BthwaniIconButton icon="search" label="البحث عن متجر أو منتج" onPress={() => { if (onSearchOpenChange) onSearchOpenChange(true); else if (searchOnCurrentRoute) router.setParams({ focus: "search" }); else if (navigation) navigation.navigate("home", { focus: "search" }); else router.push("/home?focus=search" as Href); }} size={sizing.controlMd} tone="soft" /> : null}
            <ClientNotificationAction />
            {!hideAccountAction ? <BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlMd} tone="soft" /> : null}
            <BthwaniIconButton icon="cart" label="سلة التسوق" onPress={() => router.push("/multi-store-checkout" as Href)} size={sizing.controlMd} tone="soft" />
          </View>
        </>
      )}
    </Animated.View>
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

export function createClientTabOptions(theme: ReturnType<typeof resolveTheme>, desktopWeb = false) {
  const styles = createStyles(theme);
  const icons = { home: "home", orders: "orders", account: "account" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: route.name !== "home",
    header: ({ route: headerRoute, navigation }: { route: { params?: unknown }; navigation: unknown }) => {
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[] } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><ClientHeader searchOnCurrentRoute={route.name === "home"} focus={params?.focus} searchQuery={params?.q} navigation={navigation as ClientSearchNavigation} styles={styles} /></SafeAreaView>;
    },
    tabBarPosition: desktopWeb ? "right" as const : "bottom" as const,
    tabBarVariant: desktopWeb ? "material" as const : "uikit" as const,
    tabBarActiveBackgroundColor: theme.actionSoft,
    tabBarActiveTintColor: theme.interactiveText,
    tabBarHideOnKeyboard: true,
    tabBarInactiveTintColor: theme.colorMuted,
    tabBarShowIcon: true,
    tabBarIcon: ({ color }: { color: ColorValue }) => { const icon = icons[route.name as keyof typeof icons]; return icon ? <BthwaniIcon name={icon} color={color} size={sizing.iconLg} /> : null; },
    tabBarItemStyle: desktopWeb ? styles.desktopNavigationItem : route.name === "home" ? styles.homeNavigationItem : styles.navigationItem,
    tabBarLabelStyle: styles.navigationLabel,
    tabBarStyle: desktopWeb ? styles.desktopNavigation : route.name === "home" ? styles.homeNavigation : styles.navigation,
    sceneStyle: styles.scene,
  });
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    shell: { backgroundColor: theme.background, flex: 1 },
    headerSafeArea: { backgroundColor: theme.surface },
    homeGradient: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    homeHeader: { backgroundColor: theme.brandAction, borderBottomWidth: 0, flexDirection: "column", alignItems: "stretch", justifyContent: "space-between", gap: spacing[2], paddingTop: spacing[3], paddingBottom: spacing[4] },
    homeCompactHeader: { backgroundColor: "#EFF9FA", paddingVertical: spacing[1], paddingHorizontal: spacing[2], justifyContent: "center" },
    homeCompactRow: { alignItems: "center", flexDirection: "row-reverse", gap: spacing[1], width: "100%" },
    homeCompactSearch: { flex: 1, minWidth: 0, borderRadius: radius.round, backgroundColor: "#FFFFFF" },
    homeHeaderTop: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    homeHeaderTools: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    homeHeaderIdentity: { alignItems: "flex-start", gap: spacing[1], flex: 1 },
    homeBrand: { ...typography.titleLg, fontSize: 30, lineHeight: 39, color: "#FFFFFF", fontWeight: "800" },
    homeCity: { backgroundColor: theme.surface, borderWidth: 0, minHeight: sizing.controlSm },
    homeHeaderSearchRow: { flexDirection: "row-reverse", alignItems: "center", gap: spacing[1], width: "100%" },
    homeSearchField: { flex: 1, minWidth: 0, backgroundColor: theme.surface, borderRadius: radius.round },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", minHeight: 60, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    headerIdentity: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    brand: { ...typography.titleMd, color: theme.color },
    headerCity: { backgroundColor: theme.actionSoft, borderColor: theme.borderColorStrong, flexShrink: 1, minHeight: sizing.controlSm, paddingHorizontal: spacing[2] },
    headerActions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    headerSearchActions: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    headerSearchField: { flex: 1, minWidth: 0 },
    content: { flex: 1 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], alignSelf: "center", maxWidth: 1280, width: "100%" },
    navigation: { backgroundColor: theme.surfaceRaised, borderTopColor: theme.borderColorStrong, borderTopWidth: borders.hairline, elevation: 8, minHeight: 84, paddingHorizontal: spacing[3], paddingTop: spacing[2], zIndex: 8 },
    homeNavigation: { backgroundColor: theme.surfaceRaised, borderRadius: radius.round, borderColor: theme.borderColor, borderWidth: borders.hairline, position: "absolute", left: spacing[3], right: spacing[3], bottom: spacing[3], minHeight: 70, paddingTop: spacing[1], paddingHorizontal: spacing[2], elevation: 12 },
    homeNavigationItem: { borderRadius: radius.round, flex: 1, minHeight: sizing.controlLg, paddingHorizontal: spacing[1], paddingVertical: spacing[1] },
    desktopNavigation: { backgroundColor: theme.surface, borderLeftColor: theme.borderColorStrong, borderLeftWidth: borders.hairline, width: 208, paddingHorizontal: spacing[2], paddingVertical: spacing[4] },
    desktopNavigationItem: { borderRadius: radius.lg, marginVertical: spacing[1], minHeight: sizing.controlLg },
    navigationItem: { borderRadius: radius.lg, flex: 1, minHeight: sizing.controlLg, paddingHorizontal: spacing[2], paddingVertical: spacing[1], transform: [{ translateY: -spacing[4] }] },
    navigationLabel: { ...typography.label, marginTop: spacing[1] },
  });
}
