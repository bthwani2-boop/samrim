import { useMemo, type PropsWithChildren } from "react";
import { ScrollView, StyleSheet, Text, useColorScheme, View, type ColorValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { direction, radius, resolveTextAlign, resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";

export function ClientPublicShell({ children }: PropsWithChildren) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <SafeAreaView edges={["top"]} style={styles.shell}>
      <ClientHeader context="اكتشاف المتاجر" styles={styles} />
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

function ClientHeader({ context, styles }: { context: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>بثواني</Text>
        <Text style={styles.context}>{context}</Text>
      </View>
      <View style={styles.headerMark} accessibilityElementsHidden>
        <View style={styles.headerMarkNavy} />
        <View style={styles.headerMarkOrange} />
      </View>
    </View>
  );
}

export function ClientScrollScreen({ children }: PropsWithChildren) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

export function createClientTabOptions(theme: ReturnType<typeof resolveTheme>) {
  const styles = createStyles(theme);
  const icons = { home: "⌂", orders: "▤", account: "◉" } as const;
  return ({ route }: { route: { name: string } }) => ({
    headerShown: true,
    header: () => <SafeAreaView edges={["top"]} style={styles.headerSafeArea}><ClientHeader context="مساحة العميل" styles={styles} /></SafeAreaView>,
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

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  return StyleSheet.create({
    shell: { backgroundColor: theme.background, direction: activeDirection, flex: 1 },
    headerSafeArea: { backgroundColor: theme.surface, direction: activeDirection },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: 1, direction: activeDirection, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
    brand: { color: theme.color, fontSize: typography.titleMd.fontSize, fontWeight: "800", lineHeight: typography.titleMd.lineHeight, textAlign: startTextAlign },
    context: { color: theme.colorMuted, fontSize: typography.caption.fontSize, marginTop: spacing[1], textAlign: startTextAlign },
    headerMark: { alignItems: "flex-end", direction: activeDirection, flexDirection: "row", gap: spacing[1], height: sizing.avatarSm },
    headerMarkNavy: { backgroundColor: theme.structure, borderRadius: radius.xs, height: sizing.avatarSm, width: 9 },
    headerMarkOrange: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: 16, width: 9 },
    content: { direction: activeDirection, flex: 1 },
    scene: { backgroundColor: theme.background, direction: activeDirection },
    screenContent: { direction: activeDirection, flexGrow: 1, paddingBottom: spacing[5], paddingHorizontal: spacing[5], width: "100%" },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: 1, direction: activeDirection, flexDirection: "row", paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    navigationItem: { borderRadius: radius.md, minHeight: sizing.controlLg, paddingHorizontal: spacing[2] },
    navigationIcon: { fontSize: 22, fontWeight: "800", lineHeight: 26 },
    navigationLabel: { fontSize: typography.caption.fontSize, fontWeight: "700" },
  });
}
