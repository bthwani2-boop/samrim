import { radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { useMemo, useState } from "react";
import { type Href, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { PartnerAccessInvitationsCard } from "../partner-onboarding/partner-access-invitations";

export default function PartnerAccount() {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await logoutIdentity();
    } catch {
      setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم.");
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.container} accessibilityLabel="حساب الشريك">
    <PartnerAccessInvitationsCard />
    <BthwaniSurface tone="raised" style={styles.appearancePanel}>
      <AppearancePicker title="المظهر" helper="" />
    </BthwaniSurface>
    <BthwaniButton label="الإشعارات" onPress={() => router.push("/notifications" as Href)} variant="quiet" />
    <BthwaniButton busy={busy} disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} variant="secondary" />
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flexGrow: 1, gap: spacing[3], paddingTop: spacing[3], width: "100%" },
    title: { ...typography.titleMd, color: theme.color },
    appearancePanel: { borderRadius: radius.lg, padding: spacing[3] },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
