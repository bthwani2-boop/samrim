import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { type PropsWithChildren, useMemo } from "react";
import { type ColorValue, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function CaptainScrollScreen({ children }: PropsWithChildren) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}

export function createCaptainTabOptions(theme: ReturnType<typeof resolveTheme>) {
  const styles = createStyles(theme);
  const icons = { home: "home", offers: "offers", deliveries: "deliveries", account: "account" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: () => <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><CaptainHeader styles={styles} /></SafeAreaView>,
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

function CaptainHeader({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.header}><View><Text style={styles.brand}>بثواني · الكابتن</Text><Text style={styles.context}>الجاهزية والتوصيل</Text></View><View style={styles.headerMark} accessibilityElementsHidden><View style={styles.headerMarkNavy} /><View style={styles.headerMarkOrange} /></View></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    headerSafeArea: { backgroundColor: theme.surface },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: borders.hairline, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
    brand: { ...typography.titleMd, color: theme.color },
    context: { ...typography.caption, color: theme.colorMuted, marginTop: spacing[1] },
    headerMark: { alignItems: "flex-end", flexDirection: "row", gap: spacing[1], height: sizing.avatarSm },
    headerMarkNavy: { backgroundColor: theme.structure, borderRadius: radius.xs, height: sizing.avatarSm, width: 9 },
    headerMarkOrange: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: 16, width: 9 },
    scene: { backgroundColor: theme.background },
    screenContent: { flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: borders.hairline, elevation: 8, paddingHorizontal: spacing[2], paddingTop: spacing[2], zIndex: 8 },
    navigationItem: { alignItems: "center", borderRadius: radius.md, gap: spacing[1], justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[1] },
    navigationLabel: { ...typography.caption },
  });
}
