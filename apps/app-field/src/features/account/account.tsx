import { radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, BthwaniNavigationRow, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { fieldAdmissionStateLabel } from "@bthwani/dsh";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { logoutIdentity } from "../../bootstrap/identity";
import { useOwnFieldAdmission } from "../field-operations/use-field-admission";
import { StoreAccessInvitationSummary } from "./store-access-invitations";

type OwnAdmissionState = ReturnType<typeof useOwnFieldAdmission>["state"];

function profileDescription(state: OwnAdmissionState, phone?: string | null): string {
  if (state.kind === "loading") return "جارٍ قراءة الملف…";
  if (state.kind === "missing") return "لم يكتمل تفعيل حسابك للميدان بعد. تواصل مع فريق التشغيل.";
  if (state.kind === "error") return "تعذر قراءة الملف الآن؛ أعد المحاولة عند توفر الاتصال.";
  return phone || "رقم الهاتف غير متاح";
}

export default function FieldAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showAppearance, setShowAppearance] = useState(false);
  const { state: profileState, refresh: refreshProfile } = useOwnFieldAdmission();
  const profile = profileState.kind === "ready" ? profileState.admission : null;

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
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>مساحة الميدان</Text>
        <Text style={styles.title}>الحساب</Text>
      </View>

      <BthwaniSurface tone="raised" style={styles.profileCard}>
        <View style={styles.profileIcon}><BthwaniIcon name="account" color={theme.interactiveText} size={sizing.iconLg} /></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>{profile?.fullNameAr || "ملف الميداني"}</Text>
          <Text style={styles.profileDescription}>{profileDescription(profileState, profile?.contactPhoneE164)}</Text>
          {profile ? <Text style={styles.profileDescription}>حالة التفعيل: {fieldAdmissionStateLabel(profile.state)}</Text> : null}
        </View>
      </BthwaniSurface>
      {profileState.kind === "missing" || profileState.kind === "error" ? <BthwaniButton label="تحديث حالة التفعيل" onPress={() => void refreshProfile()} variant="secondary" /> : null}

      <StoreAccessInvitationSummary onPress={() => router.push("/invitations" as Href)} />

      <View style={styles.settings}>
        <BthwaniNavigationRow description="فاتح أو داكن أو حسب إعدادات النظام" icon="appearance" title="مظهر التطبيق" onPress={() => setShowAppearance((current) => !current)} />
        {showAppearance ? <BthwaniSurface tone="inset" style={styles.appearancePanel}>
          <AppearancePicker title="اختيار النسق" helper="يُطبَّق التغيير مباشرة على شاشات التطبيق." />
        </BthwaniSurface> : null}
      </View>

      <BthwaniButton busy={busy} disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} variant="secondary" />
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { flexGrow: 1, gap: spacing[3], paddingTop: spacing[4], width: "100%" },
    heading: { gap: spacing[1] },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.hero, color: theme.color },
    profileCard: { alignItems: "center", borderRadius: radius.lg, flexDirection: "row", gap: spacing[3], padding: spacing[3] },
    profileIcon: { alignItems: "center", backgroundColor: theme.actionSoft, borderRadius: radius.md, height: sizing.avatarMd, justifyContent: "center", width: sizing.avatarMd },
    profileCopy: { flex: 1, gap: spacing[1], minWidth: 0 },
    profileTitle: { ...typography.titleSm, color: theme.color },
    profileDescription: { ...typography.bodySm, color: theme.colorMuted },
    settings: { gap: spacing[2] },
    appearancePanel: { borderRadius: radius.lg, padding: spacing[3] },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
