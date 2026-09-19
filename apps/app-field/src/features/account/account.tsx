import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";

export default function FieldAccount() {
  const theme = useAppearanceTheme();
  const styles = createStyles(theme);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function logout() { if (busy) return; setBusy(true); setNotice(""); try { await logoutIdentity(); } catch { setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم."); } finally { setBusy(false); } }
  return <View style={styles.container} accessibilityLabel="حساب الميدان"><Text style={styles.eyebrow}>إدارة الحساب</Text><Text style={styles.title}>حساب الميدان</Text><Text style={styles.description}>تعكس حالة الحساب أهليتك وملفات الانضمام المتاحة لك.</Text><BthwaniSurface tone="base" style={styles.card}><Text style={styles.cardTitle}>جلسة التشغيل</Text><Text style={styles.description}>الجلسة الحالية مفعّلة لهذا الجهاز.</Text></BthwaniSurface><AppearancePicker /><BthwaniButton accessibilityLabel="تسجيل الخروج" busy={busy} label="تسجيل الخروج" onPress={() => void logout()} />{notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}</View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[3], padding: spacing[5] }, eyebrow: { ...typography.label, color: theme.interactiveText }, title: { ...typography.hero, color: theme.color }, description: { ...typography.body, color: theme.colorMuted }, card: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[4] }, cardTitle: { ...typography.bodyStrong, color: theme.color }, notice: { ...typography.bodySm, color: theme.warning } }); }
