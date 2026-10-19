import { type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniNavigationRow, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity, subscribeIdentitySession } from "../../bootstrap/identity";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { StoreAccessInvitationInbox } from "./store-access-invitations";

export default function ClientAccount() {
  const router = useRouter();
  const theme = useAppearanceTheme();
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
      {!isAuthenticated ? <BthwaniButton label="تسجيل الدخول" onPress={() => router.replace("/?returnTo=/account" as Href)} /> : null}
      <View style={styles.actions}>
        <BthwaniNavigationRow compact description="" icon="orders" title="طلباتي" onPress={() => router.push("/orders" as Href)} />
        <BthwaniNavigationRow compact description="" icon="wallet" title="محفظتي" onPress={() => router.push("/wallet" as Href)} />
        <BthwaniNavigationRow compact description="" icon="location" title="عناوين التوصيل" onPress={() => router.push("/addresses" as Href)} />
        <BthwaniNavigationRow compact description={changingCity ? "جارٍ التغيير…" : cityName} disabled={changingCity} icon="location" title="تغيير المدينة" onPress={() => void changeCity()} />
      </View>
      {isAuthenticated ? <StoreAccessInvitationInbox key={invitationReadKey} /> : null}
      <AppearancePicker compact title="المظهر" helper="" />
      {isAuthenticated ? <BthwaniButton busy={busy} disabled={busy} label="تسجيل الخروج" onPress={() => void logout()} variant="secondary" /> : null}
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
