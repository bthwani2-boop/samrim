import { borders, direction, radius, resolveTextAlign, resolveTextInputAlign, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import type { DeliveryAddress } from "@bthwani/dsh";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useServiceCityScope } from "../service-city/service-city-scope";
import { createOwnDeliveryAddress, isLocationHttpError, listOwnDeliveryAddresses, updateOwnDeliveryAddress } from "./delivery-address-client";

type AddressState =
  | { kind: "loading" }
  | { kind: "ready"; addresses: ReadonlyArray<DeliveryAddress>; nextCursor: string }
  | { kind: "error" };

type Coordinates = Readonly<{ latitude: number; longitude: number }>;

function errorText(error: unknown): string {
  if (isLocationHttpError(error, 401)) return "انتهت جلسة العميل. سجّل الدخول مجددًا.";
  if (isLocationHttpError(error, 403)) return "جلسة العميل الحالية لا تسمح بقراءة هذا العنوان.";
  if (isLocationHttpError(error, 404)) return "لم يعد العنوان متاحًا. أعد قراءة العناوين.";
  if (isLocationHttpError(error, 409)) return "تغيّر العنوان من جلسة أخرى. أعد القراءة قبل حفظ التعديل.";
  if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "network") return "تعذر الاتصال بالخدمة. تحقق من الاتصال ثم أعد المحاولة.";
  return "تعذر حفظ العنوان. تحقق من البيانات ثم أعد المحاولة.";
}

export default function LocationCore() {
  const { cities, selectedCityID } = useServiceCityScope();
const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<AddressState>({ kind: "loading" });
  const [addressText, setAddressText] = useState("");
  const [addressCityID, setAddressCityID] = useState("");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [editing, setEditing] = useState<DeliveryAddress | null>(null);
  const [formOpen, setFormOpen] = useState(true);
  const firstSuccessfulLoad = useRef(true);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const result = await listOwnDeliveryAddresses();
      setState({ kind: "ready", addresses: result.addresses, nextCursor: result.nextCursor });
      if (firstSuccessfulLoad.current) {
        setFormOpen(result.addresses.length === 0);
        firstSuccessfulLoad.current = false;
      }
    } catch (cause) {
      setState({ kind: "error" });
      setError(errorText(cause));
    }
  }, []);

  async function loadMore() {
    if (loadingMore || state.kind !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await listOwnDeliveryAddresses(state.nextCursor);
      setState((current) => current.kind === "ready" ? { kind: "ready", addresses: [...current.addresses, ...result.addresses], nextCursor: result.nextCursor } : current);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing && selectedCityID && !addressCityID) setAddressCityID(selectedCityID);
  }, [addressCityID, editing, selectedCityID]);

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
      setNotice("تم التقاط الموقع الحالي. راجع النص ثم احفظ العنوان.");
    } catch {
      setError("تعذر التقاط الموقع الحالي. تحقق من إعدادات الموقع ثم أعد المحاولة.");
    } finally {
      setLocationBusy(false);
    }
  }

  function beginEdit(address: DeliveryAddress) {
    setFormOpen(true);
    setEditing(address);
    setAddressText(address.addressText);
    setAddressCityID(address.serviceCityId || selectedCityID || "");
    setCoordinates({ latitude: address.latitude, longitude: address.longitude });
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditing(null);
    setAddressText("");
    setAddressCityID(selectedCityID || "");
    setCoordinates(null);
    setError("");
  }

  async function save() {
    const value = addressText.trim();
    if (busy || value.length < 3 || value.length > 500 || !coordinates || !addressCityID) {
      setError("اكتب وصفًا واضحًا للعنوان والتقط موقعه قبل الحفظ.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let successNotice: string;
      if (editing) {
        await updateOwnDeliveryAddress(editing.id, { addressText: value, latitude: coordinates.latitude, longitude: coordinates.longitude, serviceCityId: addressCityID }, editing.version);
        successNotice = "تم حفظ تغييرات العنوان.";
      } else {
        await createOwnDeliveryAddress({ addressText: value, latitude: coordinates.latitude, longitude: coordinates.longitude, serviceCityId: addressCityID });
        successNotice = "تم حفظ العنوان.";
      }
      cancelEdit();
      setFormOpen(false);
      setNotice(successNotice);
      await load();
    } catch (cause) {
      setError(errorText(cause));
      if (isLocationHttpError(cause, 409)) await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="العناوين المحفوظة">
      <Text style={styles.eyebrow}>عنوان التوصيل</Text>
      <Text style={styles.title}>عناوينك المملوكة</Text>
      <Text selectable style={styles.muted}>احفظ أكثر من عنوان. الموقع يُطلب فقط عند التقاطه، ولا يُستخدم هنا لاتخاذ قرار إمكانية التوصيل.</Text>
      {notice ? <Text accessibilityLiveRegion="polite" selectable style={styles.notice}>{notice}</Text> : null}
      {error && state.kind !== "ready" ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      {!formOpen ? <Pressable accessibilityRole="button" accessibilityLabel="إضافة عنوان جديد" onPress={() => { setFormOpen(true); setNotice(""); setError(""); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إضافة عنوان جديد</Text></Pressable> : null}

      {formOpen ? <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>{editing ? "تعديل العنوان" : "إضافة عنوان"}</Text>
        <Text style={styles.fieldLabel}>مدينة العنوان</Text>
        <View style={styles.cityList}>{cities.map((city) => <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected: addressCityID === city.id }} onPress={() => setAddressCityID(city.id)} style={[styles.cityButton, addressCityID === city.id && styles.cityButtonSelected]}><Text style={styles.cityButtonText}>{city.displayNameAr}</Text></Pressable>)}</View>
        <Text style={styles.fieldLabel}>وصف العنوان</Text>
        <TextInput
          accessibilityLabel="وصف العنوان"
          editable={!busy}
          multiline
          onChangeText={setAddressText}
          placeholder="مثال: شارع الزبيري، جوار المبنى الأبيض"
          placeholderTextColor={theme.colorMuted}
          style={styles.input}
          textAlign={resolveTextInputAlign("start", direction.defaultDirection)}
          value={addressText}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="التقاط الموقع الحالي" accessibilityState={{ busy: locationBusy, disabled: busy || locationBusy }} disabled={busy || locationBusy} onPress={() => void captureLocation()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{locationBusy ? "جارٍ التقاط الموقع…" : "التقاط الموقع الحالي"}</Text>
        </Pressable>
        <View style={styles.coordinateBox}>
          <Text style={styles.coordinateLabel}>حالة الموقع</Text>
          <Text selectable style={styles.coordinateValue}>{coordinates ? "تم تحديد الموقع" : "لم يُحدد الموقع بعد"}</Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={editing ? "حفظ تغييرات العنوان" : "حفظ العنوان"} accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void save()} style={[styles.primaryButton, busy && styles.disabledButton]}>
            <Text style={[styles.primaryButtonText, busy && styles.disabledButtonText]}>{busy ? "جارٍ الحفظ…" : editing ? "حفظ تغييرات العنوان" : "حفظ العنوان"}</Text>
          </Pressable>
          {editing ? <Pressable accessibilityRole="button" accessibilityLabel="إلغاء تعديل العنوان" disabled={busy} onPress={cancelEdit} style={styles.cancelButton}><Text style={styles.cancelButtonText}>إلغاء</Text></Pressable> : null}
        </View>
        {error && state.kind === "ready" ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      </View> : null}

      <View style={styles.listCard}>
        <Text style={styles.sectionTitle}>العناوين المحفوظة</Text>
        {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة العناوين…</Text></View> : null}
        {state.kind === "error" ? <View style={styles.state}><Text selectable style={styles.muted}>{error || "تعذر قراءة العناوين."}</Text><Pressable accessibilityRole="button" accessibilityLabel="إعادة قراءة العناوين" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
        {state.kind === "ready" && state.addresses.length === 0 ? <View style={styles.state}><Text style={styles.muted}>لا توجد عناوين محفوظة بعد.</Text><Text style={styles.muted}>أضف عنوانًا ليصبح جاهزًا للاستخدام لاحقًا.</Text></View> : null}
        {state.kind === "ready" && state.addresses.length > 0 ? <><View style={styles.addressList}>{state.addresses.map((address) => <View key={address.id} style={styles.addressItem}><Text selectable style={styles.addressText}>{address.addressText}</Text><Text selectable style={styles.addressMeta}>الموقع: تم تحديد الموقع</Text><Pressable accessibilityRole="button" accessibilityLabel={`تعديل العنوان ${address.addressText}`} disabled={busy} onPress={() => beginEdit(address)} style={styles.editButton}><Text style={styles.editButtonText}>تعديل العنوان</Text></Pressable></View>)}</View>{state.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="عرض المزيد من العناوين" accessibilityState={{ busy: loadingMore }} disabled={loadingMore} onPress={() => void loadMore()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{loadingMore ? "جارٍ تحميل المزيد…" : "عرض المزيد"}</Text></Pressable> : null}</> : null}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);

  return StyleSheet.create({
    container: { backgroundColor: theme.background, direction: activeDirection, gap: spacing[3], padding: spacing[4], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText, textAlign: startTextAlign },
    title: { ...typography.titleMd, color: theme.color, textAlign: startTextAlign },
    muted: { ...typography.bodySm, color: theme.colorMuted, textAlign: startTextAlign },
    formCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    listCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    sectionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    fieldLabel: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    cityList: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    cityButton: { borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    cityButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    cityButtonText: { ...typography.bodySm, color: theme.color, textAlign: startTextAlign },
    input: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 84, paddingHorizontal: spacing[3], paddingVertical: spacing[3], textAlign: startInputTextAlign, textAlignVertical: "top", writingDirection: activeDirection },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlMd, paddingHorizontal: spacing[3] },
    secondaryButtonText: { ...typography.bodyStrong, color: theme.color },
    coordinateBox: { backgroundColor: theme.structureSoft, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
    coordinateLabel: { ...typography.caption, color: theme.colorMuted, textAlign: startTextAlign },
    coordinateValue: { ...typography.bodySm, color: theme.color, fontVariant: ["tabular-nums"], textAlign: startTextAlign },
    actionRow: { direction: activeDirection, flexDirection: "row", gap: spacing[3] },
    primaryButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, flex: 1, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[3] },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    primaryButtonText: { ...typography.bodyStrong, color: theme.onAction, textAlign: "center" },
    cancelButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, justifyContent: "center", minHeight: sizing.controlLg, paddingHorizontal: spacing[4] },
    cancelButtonText: { ...typography.bodyStrong, color: theme.color },
    notice: { ...typography.bodySm, backgroundColor: theme.successSoft, borderRadius: radius.sm, color: theme.success, padding: spacing[2], textAlign: startTextAlign },
    error: { ...typography.bodySm, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, padding: spacing[2], textAlign: startTextAlign },
    state: { alignItems: "center", gap: spacing[2], justifyContent: "center", paddingVertical: spacing[8] },
    addressList: { gap: spacing[3] },
    addressItem: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    addressText: { ...typography.bodyStrong, color: theme.color, textAlign: startTextAlign },
    addressMeta: { ...typography.caption, color: theme.colorMuted, fontVariant: ["tabular-nums"], textAlign: startTextAlign },
    editButton: { alignSelf: "flex-start", minHeight: sizing.controlMd, justifyContent: "center", paddingHorizontal: spacing[1] },
    editButtonText: { ...typography.label, color: theme.interactiveText, textDecorationLine: "underline" },
  });
}
