import { direction, resolveTextAlign, resolveTextInputAlign, resolveTheme } from "@bthwani/design-system";
import type { DeliveryAddress } from "@bthwani/dsh";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";
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
    container: { backgroundColor: theme.background, gap: 12, padding: 16, width: "100%", direction: activeDirection },
    eyebrow: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textAlign: startTextAlign },
    title: { color: theme.color, fontSize: 22, fontWeight: "800", textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 20, textAlign: startTextAlign },
    formCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
    listCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
    sectionTitle: { color: theme.color, fontSize: 16, fontWeight: "800", textAlign: startTextAlign },
    fieldLabel: { color: theme.color, fontSize: 14, fontWeight: "700", textAlign: startTextAlign },
    cityList: { direction: activeDirection, flexDirection: "row", flexWrap: "wrap", gap: 8 },
    cityButton: { borderColor: theme.borderColor, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
    cityButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    cityButtonText: { color: theme.color, fontSize: 13, fontWeight: "700" },
    input: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, color: theme.color, minHeight: 84, paddingHorizontal: 12, paddingVertical: 12, textAlign: startInputTextAlign, textAlignVertical: "top", writingDirection: activeDirection },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColorStrong, borderRadius: 12, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
    secondaryButtonText: { color: theme.color, fontSize: 14, fontWeight: "800" },
    coordinateBox: { backgroundColor: theme.structureSoft, borderRadius: 12, gap: 4, padding: 12 },
    coordinateLabel: { color: theme.colorMuted, fontSize: 12, textAlign: startTextAlign },
    coordinateValue: { color: theme.color, fontSize: 14, fontVariant: ["tabular-nums"], textAlign: startTextAlign },
    actionRow: { direction: activeDirection, flexDirection: "row", gap: 10 },
    primaryButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 12, flex: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    primaryButtonText: { color: theme.onAction, fontSize: 14, fontWeight: "800", textAlign: "center" },
    cancelButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 16 },
    cancelButtonText: { color: theme.color, fontSize: 14, fontWeight: "800" },
    notice: { backgroundColor: theme.successSoft, borderRadius: 10, color: theme.success, fontSize: 13, padding: 10, textAlign: startTextAlign },
    error: { backgroundColor: theme.dangerSoft, borderRadius: 10, color: theme.danger, fontSize: 13, padding: 10, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, minHeight: 110, justifyContent: "center" },
    addressList: { gap: 10 },
    addressItem: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 8, padding: 12 },
    addressText: { color: theme.color, fontSize: 15, fontWeight: "700", lineHeight: 22, textAlign: startTextAlign },
    addressMeta: { color: theme.colorMuted, fontSize: 12, fontVariant: ["tabular-nums"], lineHeight: 18, textAlign: startTextAlign },
    editButton: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center", paddingHorizontal: 6 },
    editButtonText: { color: theme.interactiveText, fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
  });
}
