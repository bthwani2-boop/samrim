import { useCallback, useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { isOriginHttpError, readStoreDeliveryOrigin, setStoreDeliveryOrigin } from "./store-delivery-origin-client";

type Coordinates = Readonly<{ latitude: number; longitude: number }>;
type OriginState =
  | { kind: "loading" }
  | { kind: "ready"; originVersion: number; origin: Coordinates | null }
  | { kind: "error" };

function errorText(error: unknown): string {
  if (isOriginHttpError(error, 401)) return "انتهت جلسة الشريك. سجّل الدخول مجددًا.";
  if (isOriginHttpError(error, 403)) return "لا تملك صلاحية إدارة أصل هذا المتجر.";
  if (isOriginHttpError(error, 404)) return "لم يعد المتجر متاحًا. أعد قراءة بيانات المتجر.";
  if (isOriginHttpError(error, 409)) return "تغيّرت بيانات المتجر. أعد القراءة قبل حفظ موقع الأصل.";
  if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "network") return "تعذر الاتصال بـ DSH. تحقق من الاتصال ثم أعد المحاولة.";
  return "تعذر حفظ موقع أصل المتجر. حاول مرة أخرى.";
}

export function StoreDeliveryOrigin({ storeId }: { storeId: string }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<OriginState>({ kind: "loading" });
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const result = await readStoreDeliveryOrigin(storeId);
      const origin = result.origin ? { latitude: result.origin.latitude, longitude: result.origin.longitude } : null;
      setState({ kind: "ready", originVersion: result.originVersion, origin });
      setCoordinates(origin);
    } catch (cause) {
      setState({ kind: "error" });
      setError(errorText(cause));
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function captureLocation() {
    if (busy || locationBusy) return;
    setLocationBusy(true);
    setError("");
    setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setError("لم يُسمح بالوصول إلى الموقع. يمكنك المحاولة مجددًا من إعدادات الجهاز.");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setError("خدمة الموقع متوقفة على الجهاز. فعّلها ثم حاول التقاط الموقع.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setNotice("تم التقاط موقع الأصل. احفظه لقراءة DSH الكانونية.");
    } catch {
      setError("تعذر التقاط الموقع الحالي. تحقق من إعدادات الموقع ثم أعد المحاولة.");
    } finally {
      setLocationBusy(false);
    }
  }

  async function save() {
    if (busy || state.kind !== "ready" || !coordinates) {
      setError("التقط موقع أصل المتجر قبل الحفظ.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await setStoreDeliveryOrigin(storeId, coordinates.latitude, coordinates.longitude, state.originVersion);
      setState({ kind: "ready", originVersion: result.originVersion, origin: result.origin ? { latitude: result.origin.latitude, longitude: result.origin.longitude } : null });
      setCoordinates(result.origin ? { latitude: result.origin.latitude, longitude: result.origin.longitude } : null);
      setNotice("تم حفظ موقع أصل المتجر وقراءته من DSH.");
    } catch (cause) {
      setError(errorText(cause));
      if (isOriginHttpError(cause, 409)) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="موقع أصل المتجر">
      <Text style={styles.title}>موقع أصل المتجر</Text>
      <Text selectable style={styles.muted}>يلتقط التطبيق موقعًا أماميًا عند طلبك فقط. لا ينتج هذا السطح حكمًا على قابلية الخدمة.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة موقع الأصل…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة موقع الأصل" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? <>
        <View style={styles.coordinateBox}><Text style={styles.coordinateLabel}>حالة موقع الأصل</Text><Text selectable style={styles.coordinateValue}>{state.origin ? "تم حفظ موقع أصل المتجر" : "لم يُحفظ موقع أصل بعد"}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="التقاط موقع أصل المتجر" accessibilityState={{ busy: locationBusy, disabled: busy || locationBusy }} disabled={busy || locationBusy} onPress={() => void captureLocation()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{locationBusy ? "جارٍ التقاط الموقع…" : "التقاط موقع الأصل"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="حفظ موقع أصل المتجر" accessibilityState={{ busy, disabled: busy || !coordinates }} disabled={busy || !coordinates} onPress={() => void save()} style={[styles.primaryButton, (busy || !coordinates) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{busy ? "جارٍ الحفظ…" : "حفظ موقع الأصل"}</Text></Pressable>
        {notice ? <Text accessibilityLiveRegion="polite" selectable style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      </> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 16, borderWidth: 1, gap: 10, marginTop: 14, padding: 14, width: "100%", direction: "rtl" },
    title: { color: theme.structure, fontSize: 16, fontWeight: "800", textAlign: "right" },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: "right" },
    state: { alignItems: "center", gap: 8, minHeight: 92, justifyContent: "center" },
    coordinateBox: { backgroundColor: theme.structureSoft, borderRadius: 12, gap: 4, padding: 12 },
    coordinateLabel: { color: theme.colorMuted, fontSize: 12, textAlign: "right" },
    coordinateValue: { color: theme.structure, fontSize: 14, fontVariant: ["tabular-nums"], textAlign: "right" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColorStrong, borderRadius: 12, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.structure, fontSize: 14, fontWeight: "800" },
    primaryButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 12, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
    disabledButton: { backgroundColor: theme.borderColorStrong },
    primaryButtonText: { color: theme.onAction, fontSize: 14, fontWeight: "800" },
    notice: { backgroundColor: theme.successSoft, borderRadius: 10, color: theme.success, fontSize: 13, padding: 10, textAlign: "right" },
    error: { backgroundColor: theme.dangerSoft, borderRadius: 10, color: theme.danger, fontSize: 13, padding: 10, textAlign: "right" },
  });
}
