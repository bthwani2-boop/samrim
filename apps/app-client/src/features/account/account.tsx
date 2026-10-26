import { Button, Host } from "@expo/ui";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniNavigationRow, useMobileAppearance } from "@bthwani/design-system/native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity, subscribeIdentitySession } from "../../bootstrap/identity";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { StoreAccessInvitationInbox } from "./store-access-invitations";
import { MarketingContactPreference } from "./marketing-contact-preference";

export default function ClientAccount() {
  const router = useRouter();
  const { theme, themeName } = useMobileAppearance();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { cities, clearSelectedCity, selectedCityID } = useServiceCityScope();
  const [isAuthenticated, setIsAuthenticated] = useState(() => currentIdentityState().kind === "authenticated");
  const [busy, setBusy] = useState(false);
  const [changingCity, setChangingCity] = useState(false);
  const [notice, setNotice] = useState("");
  const [invitationReadKey, setInvitationReadKey] = useState(0);
  useFocusEffect(useCallback(() => { setInvitationReadKey((current) => current + 1); }, []));
  const cityName = serviceCityDisplayName(cities.find((city) => city.id === selectedCityID)?.displayNameAr);

  useEffect(() => {
    const unsubscribe = subscribeIdentitySession((state) => setIsAuthenticated(state.kind === "authenticated"));
    setIsAuthenticated(currentIdentityState().kind === "authenticated");
    return unsubscribe;
  }, []);

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
      router.replace("/?returnTo=/account" as Href);
    }
  }

  async function changeCity() {
    if (changingCity) return;
    setChangingCity(true);
    setNotice("");
    try {
      await clearSelectedCity();
    } catch {
      setNotice("تعذر فتح اختيار المدينة. حاول مجددًا.");
    } finally {
      setChangingCity(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="الحساب">
      <Text style={styles.title}>حسابي</Text>
      {!isAuthenticated ? (
        <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
          <Button label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/account" as Href)} testID="client-account-login" />
        </Host>
      ) : null}
      <View style={styles.actions}>
        <BthwaniNavigationRow compact description="" icon="orders" title="طلباتي" onPress={() => router.push("/orders" as Href)} />
        <BthwaniNavigationRow compact description="" icon="wallet" title="محفظتي" onPress={() => router.push((isAuthenticated ? "/wallet" : "/?returnTo=/wallet") as Href)} />
        <BthwaniNavigationRow compact description="" icon="location" title="عناوين التوصيل" onPress={() => router.push("/addresses" as Href)} />
        <BthwaniNavigationRow compact description={changingCity ? "جارٍ التغيير…" : cityName} disabled={changingCity} icon="location" title="تغيير المدينة" onPress={() => void changeCity()} />
      </View>
      {isAuthenticated ? <StoreAccessInvitationInbox key={invitationReadKey} /> : null}
      <MarketingContactPreference active={isAuthenticated} />
      <AppearancePicker compact title="المظهر" helper="" />
    <Pressable accessibilityRole="button" accessibilityLabel="نسخ معلومات إصدار التطبيق"
      onPress={() => void Clipboard.setStringAsync([
        "بثواني", Application.nativeApplicationVersion ?? "—",
        "build:" + (Application.nativeBuildVersion ?? "—"),
        Device.modelName ?? "جهاز غير معروف", Device.osVersion ?? "—",
      ].join(" · ")).then(() => setNotice("تم نسخ معلومات إصدار التطبيق")).catch(() => setNotice("تعذر نسخ معلومات التطبيق"))}
      style={{ paddingVertical: 7, alignItems: "center" }}>
      <Text style={{ color: theme.colorMuted, fontSize: 12 }}>
        {"إصدار التطبيق " + (Application.nativeApplicationVersion ?? "—") + " · نسخ معلومات الإصدار"}
      </Text>
    </Pressable>
      {isAuthenticated ? (
        <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
          <Button disabled={busy} label={busy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"} onPress={() => void logout()} testID="client-account-logout" variant="outlined" />
        </Host>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, flexGrow: 1, gap: spacing[3], paddingBottom: spacing[5], width: "100%" },
    title: { ...typography.titleLg, color: theme.color },
    actions: { gap: spacing[2] },
    notice: { ...typography.bodySm, color: theme.warning },
  });
}
