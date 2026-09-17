import { useMemo, type PropsWithChildren } from "react";
import { ScrollView, StyleSheet, Text, useColorScheme, View, type ColorValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { direction, radius, resolveRowDirection, resolveTextAlign, resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";

export function PartnerScrollScreen({ children }: PropsWithChildren) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}

export function createPartnerTabOptions(theme: ReturnType<typeof resolveTheme>) {
  const styles = createStyles(theme);
  const icons = { store: "▣", orders: "▤", account: "◉" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: () => <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><PartnerHeader styles={styles} /></SafeAreaView>,
    tabBarActiveBackgroundColor: theme.actionSoft,
    tabBarActiveTintColor: theme.interactiveText,
    tabBarHideOnKeyboard: true,
    tabBarInactiveTintColor: theme.colorMuted,
    tabBarShowIcon: true,
    tabBarIcon: ({ color }: { color: ColorValue }) => <Text accessible={false} style={[styles.navigationIcon, { color }]}>{icons[route.name as keyof typeof icons] ?? "•"}</Text>,
    tabBarItemStyle: styles.navigationItem,
    tabBarLabelStyle: styles.navigationLabel,
    tabBarStyle: styles.navigation,
    sceneStyle: styles.scene,
  });
}

export function PartnerHeader({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.header}><View><Text style={styles.brand}>بثواني</Text><Text style={styles.context}>مساحة الشريك · تشغيل المتجر</Text></View><View style={styles.headerMark} accessibilityElementsHidden><View style={styles.headerMarkNavy} /><View style={styles.headerMarkOrange} /></View></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);
  return StyleSheet.create({
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: 1, flexDirection: rowDirection, justifyContent: "space-between", paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
    brand: { color: theme.color, fontSize: typography.titleMd.fontSize, fontWeight: "800", lineHeight: typography.titleMd.lineHeight, textAlign: startTextAlign },
    context: { color: theme.colorMuted, fontSize: typography.caption.fontSize, marginTop: spacing[1], textAlign: startTextAlign },
    headerMark: { alignItems: "flex-end", flexDirection: rowDirection, gap: spacing[1], height: sizing.avatarSm },
    headerMarkNavy: { backgroundColor: theme.structure, borderRadius: radius.xs, height: sizing.avatarSm, width: 9 },
    headerMarkOrange: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: 16, width: 9 },
    scene: { backgroundColor: theme.background, direction: activeDirection },
    screenContent: { direction: activeDirection, flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: 1, direction: activeDirection, flexDirection: rowDirection, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    navigationItem: { borderRadius: radius.md, minHeight: sizing.controlLg, paddingHorizontal: spacing[2] },
    navigationIcon: { fontSize: 22, fontWeight: "800", lineHeight: 26 },
    navigationLabel: { fontSize: typography.caption.fontSize, fontWeight: "700" },
  });
}
