import { borders, direction, radius, resolveTextAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
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
  if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "network") return "تعذر الاتصال بالخدمة. تحقق من الاتصال ثم أعد المحاولة.";
  return "تعذر حفظ موقع أصل المتجر. حاول مرة أخرى.";
}

export function StoreDeliveryOrigin({ storeId }: { storeId: string }) {
const theme = useAppearanceTheme();
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
      setNotice("تم التقاط موقع الأصل. احفظه لتثبيت البيانات الكانونية.");
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
      setNotice("تم حفظ موقع أصل المتجر وتثبيت البيانات الكانونية.");
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
      <Text selectable style={styles.muted}>يلتقط التطبيق موقعًا أماميًا عند طلبك فقط. لا ينتج هذا السطح حكمًا على إمكانية التوصيل.</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة موقع الأصل…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة موقع الأصل" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? <>
        <View style={styles.coordinateBox}><Text style={styles.coordinateLabel}>حالة موقع الأصل</Text><Text selectable style={styles.coordinateValue}>{state.origin ? "تم حفظ موقع أصل المتجر" : "لم يُحفظ موقع أصل بعد"}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="التقاط موقع أصل المتجر" accessibilityState={{ busy: locationBusy, disabled: busy || locationBusy }} disabled={busy || locationBusy} onPress={() => void captureLocation()} style={[styles.secondaryButton, (busy || locationBusy) && styles.disabledButton]}><Text style={[styles.secondaryButtonText, (busy || locationBusy) && styles.disabledButtonText]}>{locationBusy ? "جارٍ التقاط الموقع…" : "التقاط موقع الأصل"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="حفظ موقع أصل المتجر" accessibilityState={{ busy, disabled: busy || !coordinates }} disabled={busy || !coordinates} onPress={() => void save()} style={[styles.primaryButton, (busy || !coordinates) && styles.disabledButton]}><Text style={[styles.primaryButtonText, (busy || !coordinates) && styles.disabledButtonText]}>{busy ? "جارٍ الحفظ…" : "حفظ موقع الأصل"}</Text></Pressable>
        {notice ? <Text accessibilityLiveRegion="polite" selectable style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      </> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], marginTop: spacing[3], padding: spacing[3], width: "100%", direction: activeDirection },
    title: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    state: { alignItems: "center", gap: spacing[2], minHeight: 92, justifyContent: "center" },
    coordinateBox: { backgroundColor: theme.structureSoft, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
    coordinateLabel: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    coordinateValue: { ...typography.bodySm, color: theme.color, fontVariant: ["tabular-nums"], textAlign: startTextAlign },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
    primaryButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[3] },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    primaryButtonText: { ...typography.bodyStrong, color: theme.onAction },
    notice: { backgroundColor: theme.successSoft, borderRadius: radius.sm, color: theme.success, ...typography.label, padding: spacing[2], textAlign: startTextAlign },
    error: { backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, ...typography.label, padding: spacing[2], textAlign: startTextAlign },
  });
}
