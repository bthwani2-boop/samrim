import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, useAppearanceTheme } from "@bthwani/design-system/native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";

export default function PartnerAccount() {
const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function logout() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try { await logoutIdentity(); } catch { setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم."); } finally { setBusy(false); }
  }
  return <View style={styles.container} accessibilityLabel="حساب الشريك"><Text style={styles.eyebrow}>إدارة الحساب</Text><Text style={styles.title}>حساب الشريك</Text><Text style={styles.description}>تظل حالة المتجر والكتالوج والطلبات مرتبطة بصلاحيات الشريك الحالية.</Text><View style={styles.card}><Text style={styles.cardTitle}>جلسة التشغيل</Text><Text style={styles.description}>الجلسة الحالية مفعّلة لهذا الجهاز.</Text></View><AppearancePicker /><Pressable accessibilityRole="button" accessibilityLabel="تسجيل الخروج" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void logout()} style={[styles.button, busy && styles.disabledButton]}><Text style={[styles.buttonText, busy && styles.disabledButtonText]}>{busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}</Text></Pressable>{notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}</View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const startTextAlign = resolveTextAlign("start", direction.defaultDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.background, direction: direction.defaultDirection, flexGrow: 1, gap: spacing[3], padding: spacing[5] },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.hero, color: theme.color, textAlign: startTextAlign },
    description: { ...typography.body, color: theme.colorMuted, textAlign: startTextAlign },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] },
    cardTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[4] },
    buttonText: { ...typography.bodyStrong, color: theme.onAction },
    disabledButton: { backgroundColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    notice: { ...typography.bodySm, color: theme.warning, textAlign: startTextAlign },
  });
}
