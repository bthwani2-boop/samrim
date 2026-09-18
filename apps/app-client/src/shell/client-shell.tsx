import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniChip, BthwaniIcon, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { type PropsWithChildren, useMemo } from "react";
import { Alert, type ColorValue, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useServiceCityScope } from "../features/service-city/service-city-scope";

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
  const header = <ClientHeader context="اكتشاف المتاجر" searchHref={"/?focus=search" as Href} styles={styles} />;
  return safeArea ? <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>{header}</SafeAreaView> : header;
}

function ClientHeader({ context, searchHref, styles }: { context: string; searchHref: Href; styles: ReturnType<typeof createStyles> }) {
  const router = useRouter();
  const { cities, clearSelectedCity, selectedCityID } = useServiceCityScope();
  const cityName = cities.find((city) => city.id === selectedCityID)?.displayNameAr ?? "اختر المدينة";

  return (
    <View style={styles.header}>
      <View style={styles.headerIdentity}>
        <Text style={styles.brand}>بثواني</Text>
        <View style={styles.headerMeta}>
          <Text style={styles.context}>{context}</Text>
          <BthwaniChip accessibilityLabel="تغيير مدينة الخدمة" icon="location" label={cityName} onPress={() => void clearSelectedCity()} style={styles.headerCity} />
        </View>
      </View>
      <View style={styles.headerActions}>
        <BthwaniIconButton icon="search" label="البحث عن متجر" onPress={() => router.push(searchHref)} size={sizing.controlSm} tone="soft" />
        <BthwaniIconButton icon="notifications" label="الإشعارات" onPress={() => Alert.alert("الإشعارات", "لا توجد إشعارات جديدة.")} size={sizing.controlSm} tone="soft" />
        <BthwaniIconButton icon="account" label="الحساب" onPress={() => router.push("/account" as Href)} size={sizing.controlSm} tone="soft" />
      </View>
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
  const icons = { home: "home", orders: "orders", account: "account" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: () => <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><ClientHeader context="مساحة العميل" searchHref={"/home?focus=search" as Href} styles={styles} /></SafeAreaView>,
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
    content: { flex: 1 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surfaceRaised, borderTopColor: theme.borderColorStrong, borderTopWidth: borders.hairline, minHeight: 84, paddingHorizontal: spacing[3], paddingTop: spacing[2] },
    navigationItem: { borderRadius: radius.lg, flex: 1, minHeight: sizing.controlLg, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    navigationLabel: { ...typography.label, marginTop: spacing[1] },
  });
}
