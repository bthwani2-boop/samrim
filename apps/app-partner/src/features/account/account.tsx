import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppearancePicker, useAppearanceTheme } from "@bthwani/design-system/native";

import { direction, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
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
    container: { backgroundColor: theme.background, direction: direction.defaultDirection, flexGrow: 1, gap: 14, padding: 20 },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 28, fontWeight: "800", textAlign: startTextAlign },
    description: { color: theme.colorMuted, fontSize: 15, lineHeight: 23, textAlign: startTextAlign },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
    cardTitle: { color: theme.color, fontSize: 16, fontWeight: "800", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 12, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
    buttonText: { color: theme.onAction, fontSize: 15, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    notice: { color: theme.warning, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
  });
}
