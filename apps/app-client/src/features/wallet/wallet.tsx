import { spacing, type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ClientScrollScreen } from "../../shell/client-shell";
import { ClientCashInPanel } from "./cash-in-panel";

export default function ClientWallet() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <ClientScrollScreen><View style={styles.container} accessibilityLabel="محفظة العميل"><View style={styles.header}><View><Text style={styles.eyebrow}>المال داخل بثواني</Text><Text style={styles.title}>المحفظة</Text><Text style={styles.description}>رصيدك الداخلي وسجل الشحن يُقرآن من WLT. شحن المحفظة الرسمية يضيف إلى رصيد بثواني بعد التحقق فقط.</Text></View><BthwaniIcon name="wallet" color={theme.interactiveText} size={spacing[6]} /></View><ClientCashInPanel /><Text style={styles.disclosure}>سحب رصيد العميل غير متاح ذاتيًا؛ الطلب النادر يمر عبر العمليات والمالية والمطابقة المستقلة.</Text><BthwaniButton label="فتح الحساب" onPress={() => router.replace("/account")} variant="secondary" /></View></ClientScrollScreen>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[4], paddingTop: spacing[5] }, header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.hero, color: theme.color }, description: { ...typography.body, color: theme.colorMuted }, disclosure: { ...typography.bodySm, color: theme.colorMuted } }); }
