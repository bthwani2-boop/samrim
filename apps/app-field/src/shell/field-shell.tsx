import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, BthwaniIconButton, BthwaniSearchField, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { type PropsWithChildren, useEffect, useMemo, useRef } from "react";
import { type ColorValue, ScrollView, StyleSheet, Text, type TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type FieldSearchNavigation = {
  navigate: (screen: "cases", params: { focus: "search" }) => void;
  setParams: (params: { focus?: string; q?: string }) => void;
};

export function FieldScrollScreen({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}

export function createFieldTabOptions(theme: ReturnType<typeof resolveTheme>) {
  const styles = createStyles(theme);
  const icons = { home: "home", cases: "cases", wallet: "wallet", account: "account" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: ({ route: headerRoute, navigation }: { route: { params?: unknown }; navigation: unknown }) => {
      const params = headerRoute.params as { focus?: string | string[]; q?: string | string[] } | undefined;
      return <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><FieldHeader focus={params?.focus} searchQuery={params?.q} navigation={navigation as FieldSearchNavigation} styles={styles} /></SafeAreaView>;
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

function FieldHeader({ focus: rawFocus, searchQuery: rawQuery, navigation, styles }: { focus?: string | string[] | undefined; searchQuery?: string | string[] | undefined; navigation: FieldSearchNavigation; styles: ReturnType<typeof createStyles> }) {
  const router = useRouter();
  const focus = Array.isArray(rawFocus) ? rawFocus[0] : rawFocus;
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const isSearchOpen = focus === "search";
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isSearchOpen) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isSearchOpen]);

  return <View style={styles.header}>{isSearchOpen ? <View style={styles.headerSearchActions}><BthwaniSearchField accessibilityLabel="البحث في الملفات" autoCapitalize="none" autoCorrect={false} containerStyle={styles.headerSearchField} inputRef={searchInputRef} maxLength={128} onChangeText={(value) => navigation.setParams({ q: value.slice(0, 128) })} onClear={() => navigation.setParams({ q: "" })} placeholder="ابحث باسم النشاط أو المتجر أو الهاتف" returnKeyType="search" value={searchQuery.slice(0, 128)} /><BthwaniIconButton icon="close" label="إغلاق البحث" onPress={() => navigation.setParams({ focus: "", q: "" })} size={sizing.controlMd} tone="soft" /></View> : <><View style={styles.headerIdentity}><Text style={styles.brand}>بثواني · الميدان</Text><Text style={styles.context}>الأهلية وملفات الانضمام</Text></View><View style={styles.headerActions}><BthwaniIconButton icon="search" label="البحث في الملفات" onPress={() => navigation.navigate("cases", { focus: "search" })} size={sizing.controlMd} tone="soft" /><BthwaniIconButton icon="notifications" label="الإشعارات" onPress={() => router.push("/notifications" as Href)} size={sizing.controlMd} tone="soft" /><BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlMd} tone="soft" /></View></>}</View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", minHeight: 76, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
    headerIdentity: { flex: 1, minWidth: 0 },
    brand: { ...typography.titleMd, color: theme.color },
    context: { ...typography.caption, color: theme.colorMuted, marginTop: spacing[1] },
    headerActions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    headerSearchActions: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing[2], minWidth: 0 },
    headerSearchField: { flex: 1, minWidth: 0 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, elevation: 8, paddingHorizontal: spacing[3], paddingTop: spacing[2], zIndex: 8 },
    navigationItem: { alignItems: "center", borderRadius: radius.md, flex: 1, gap: spacing[1], justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[2], transform: [{ translateY: -spacing[4] }] },
    navigationLabel: { ...typography.caption },
  });
}
