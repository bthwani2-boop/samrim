import { Link, Slot, usePathname, type Href } from "expo-router";
import { useMemo, type PropsWithChildren } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { direction, radius, resolveRowDirection, resolveTextAlign, resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";

const navigation = [
  { href: "/home", label: "الرئيسية", accessibilityLabel: "الرئيسية" },
  { href: "/orders", label: "الطلبات", accessibilityLabel: "الطلبات" },
  { href: "/account", label: "الحساب", accessibilityLabel: "الحساب" },
] as const;

export default function ClientShell() {
  const pathname = usePathname();
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.shell}>
      <ClientHeader context="مساحة العميل" styles={styles} />
      <View style={styles.content}>
        <Slot />
      </View>
      <View style={styles.navigation} accessibilityRole="tablist">
        {navigation.map((item) => {
          const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href as Href} asChild>
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel={item.accessibilityLabel}
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.navigationItem, selected && styles.navigationItemSelected, pressed && styles.navigationItemPressed]}
              >
                <Text style={[styles.navigationLabel, selected && styles.navigationLabelSelected]}>{item.label}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export function ClientPublicShell({ children }: PropsWithChildren) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <SafeAreaView style={styles.shell}><ClientHeader context="اكتشاف المتاجر" styles={styles} /><View style={styles.content}>{children}</View></SafeAreaView>;
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

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);
  return StyleSheet.create({
    shell: { backgroundColor: theme.background, direction: activeDirection, flex: 1 },
    header: { alignItems: "center", backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: 1, flexDirection: rowDirection, justifyContent: "space-between", paddingHorizontal: spacing[5], paddingVertical: spacing[3] },
    brand: { color: theme.color, fontSize: typography.titleMd.fontSize, fontWeight: "800", lineHeight: typography.titleMd.lineHeight, textAlign: startTextAlign },
    context: { color: theme.colorMuted, fontSize: typography.caption.fontSize, marginTop: spacing[1], textAlign: startTextAlign },
    headerMark: { alignItems: "flex-end", flexDirection: rowDirection, gap: spacing[1], height: sizing.avatarSm },
    headerMarkNavy: { backgroundColor: theme.structure, borderRadius: radius.xs, height: sizing.avatarSm, width: 9 },
    headerMarkOrange: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: 16, width: 9 },
    content: { flex: 1 },
    screenContent: { flexGrow: 1, paddingBottom: 24 },
    navigation: { backgroundColor: theme.surface, borderTopColor: theme.borderColor, borderTopWidth: 1, flexDirection: rowDirection, gap: spacing[2], justifyContent: "space-around", paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    navigationItem: { alignItems: "center", borderRadius: radius.md, flex: 1, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[2] },
    navigationItemSelected: { backgroundColor: theme.actionSoft },
    navigationItemPressed: { opacity: 0.72 },
    navigationLabel: { color: theme.colorMuted, fontSize: typography.caption.fontSize, fontWeight: "700", textAlign: "center" },
    navigationLabelSelected: { color: theme.interactiveText },
  });
}
