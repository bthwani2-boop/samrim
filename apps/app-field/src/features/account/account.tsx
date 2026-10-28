import { Button, Host } from "@expo/ui";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniIcon, BthwaniSurface, useMobileAppearance } from "@bthwani/design-system/native";
import { fieldAdmissionStateLabel } from "@bthwani/dsh";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { fieldAdmissionActionability } from "../field-operations/field-eligibility";
import { useOwnFieldAdmission } from "../field-operations/use-field-admission";

type OwnAdmissionState = ReturnType<typeof useOwnFieldAdmission>["state"];

function profileDescription(state: OwnAdmissionState, phone?: string | null): string {
  if (state.kind === "loading") return "جارٍ قراءة الملف…";
  if (state.kind === "missing") return "لم يكتمل تفعيل حسابك للميدان بعد. تواصل مع فريق التشغيل.";
  if (state.kind === "error") return "تعذر قراءة الملف الآن؛ أعد المحاولة عند توفر الاتصال.";
  return phone || "رقم الهاتف غير متاح";
}

export default function FieldAccount() {
  const { theme, themeName } = useMobileAppearance();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const { state: profileState, verification, refresh: refreshProfile } = useOwnFieldAdmission();
  const profile = profileState.kind === "ready" ? profileState.admission : null;
  const profileActionability = profile ? fieldAdmissionActionability(profile) : null;

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

  return (
    <View style={styles.container} accessibilityLabel="حساب الميدان">
      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconLg} /></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>{profile?.fullNameAr || "ملف الميداني"}</Text>
          <Text style={styles.profileDescription}>{profileDescription(profileState, profile?.contactPhoneE164)}{profile ? ` · أهلية الميدان: ${profileActionability === "profile_review" ? "الملف يحتاج مراجعة" : fieldAdmissionStateLabel(profile.state)}` : ""}</Text>
          {verification === "checking" && profile ? <Text accessibilityLiveRegion="polite" style={styles.profileDescription}>جارٍ إعادة التحقق من أهلية الميدان…</Text> : null}
          {verification === "verified" && profileActionability === "profile_review" ? <Text accessibilityLiveRegion="polite" style={styles.profileDescription}>تواصل مع فريق التشغيل لاستكمال مراجعة الملف قبل استخدام وظائف الميدان.</Text> : null}
          {verification === "failed" && profile ? <Text accessibilityRole="alert" style={styles.profileDescription}>تعذر تأكيد أهلية الميدان. الوظائف محجوبة حتى إعادة التحقق.</Text> : null}
        </View>
      </BthwaniSurface>
      {profileState.kind === "missing" || profileState.kind === "error" || verification === "failed" ? (
        <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
          <Button label="إعادة التحقق من الأهلية" onPress={() => void refreshProfile()} testID="field-retry-admission" variant="outlined" />
        </Host>
      ) : null}

      <View style={styles.settings}>
        <AppearancePicker compact title="المظهر" helper="" />
      </View>

    <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
      <Button variant="text" style={{ height: 48 }}
        onPress={() => void Clipboard.setStringAsync([
          "بثواني", Application.nativeApplicationVersion ?? "—",
          "build:" + (Application.nativeBuildVersion ?? "—"),
          Device.modelName ?? "جهاز غير معروف", Device.osVersion ?? "—",
        ].join(" · ")).then(() => setNotice("تم نسخ معلومات إصدار التطبيق")).catch(() => setNotice("تعذر نسخ معلومات التطبيق"))}
        label={"إصدار التطبيق " + (Application.nativeApplicationVersion ?? "—") + " · نسخ معلومات الإصدار"}
        testID="field-copy-app-version" />
    </Host>
      <View style={styles.footer}>
        <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
          <Button disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} testID="field-account-logout" variant="outlined" />
        </Host>
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flexGrow: 1, gap: spacing[2], paddingTop: spacing[2], width: "100%" },
    footer: { gap: spacing[2], marginTop: "auto", paddingTop: spacing[4] },
    profileCard: { alignItems: "center", borderRadius: radius.md, flexDirection: "row", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    profileIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.controlMd, justifyContent: "center", width: sizing.controlMd },
    profileCopy: { flex: 1, gap: 0, minWidth: 0 },
    profileTitle: { ...typography.bodyStrong, color: theme.color },
    profileDescription: { ...typography.caption, color: theme.colorMuted },
    settings: { gap: spacing[2] },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
