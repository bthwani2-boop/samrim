import { borders, radius, sizing, spacing, type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

export default function ClientWallet() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={styles.container} accessibilityLabel="محفظة العميل"><Text style={styles.eyebrow}>المال داخل بثواني</Text><Text style={styles.title}>المحفظة</Text><Text style={styles.description}>رصيد بثواني الداخلي منفصل عن المحافظ الرسمية الخارجية، ولا يظهر إلا من قراءة WLT المعتمدة.</Text><BthwaniSurface tone="raised" style={styles.card}><View style={styles.cardHeading}><View style={styles.icon}><BthwaniIcon name="wallet" color={theme.interactiveText} size={sizing.iconLg} /></View><View style={styles.copy}><Text style={styles.cardTitle}>الرصيد الداخلي</Text><Text style={styles.muted}>لا يوجد رصيد معروض حاليًا لهذا الحساب.</Text></View></View><Text style={styles.notice}>سيظهر الرصيد هنا بعد تفعيل قناة الشحن الرسمية وربطها بدفتر WLT.</Text></BthwaniSurface><BthwaniButton label="فتح الحساب" onPress={() => router.replace("/account")} variant="secondary" /></View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({ container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[4], padding: spacing[5] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.hero, color: theme.color }, description: { ...typography.body, color: theme.colorMuted }, card: { borderColor: theme.borderColor, borderRadius: radius.xl, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] }, cardHeading: { alignItems: "center", flexDirection: "row", gap: spacing[3] }, icon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd }, copy: { flex: 1, gap: spacing[1] }, cardTitle: { ...typography.titleSm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, notice: { ...typography.bodySm, color: theme.warning } });
}
