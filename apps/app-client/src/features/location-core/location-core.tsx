import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { BthwaniMap } from "@bthwani/design-system/native/map";
import type { DeliveryAddress } from "@bthwani/dsh";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { subscribeClientCartActorChanges } from "../cart-checkout/cart-session-scope";
import { serviceCityDisplayName, useServiceCityScope } from "../service-city/service-city-scope";
import { appendDistinctDeliveryAddresses } from "./address-pagination";
import { createOwnDeliveryAddress, isLocationHttpError, listOwnDeliveryAddresses, updateOwnDeliveryAddress } from "./delivery-address-client";

type AddressState =
  | { kind: "loading" }
  | { kind: "ready"; actorID: string; addresses: ReadonlyArray<DeliveryAddress>; nextCursor: string }
  | { kind: "error" };

type Coordinates = Readonly<{ latitude: number; longitude: number }>;

function currentAddressActorID(): string {
  const session = currentIdentityState();
  return session.kind === "authenticated" ? session.identity.subject.trim() : "";
}

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
  const pageGeneration = useRef(0);
  const locationGeneration = useRef(0);
  const actorRevision = useRef(0);
  const activeActorIDRef = useRef(currentAddressActorID());
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const generation = ++pageGeneration.current;
    const actorID = currentAddressActorID();
    setLoadingMore(false);
    setState({ kind: "loading" });
    setError("");
    if (!actorID) { setState({ kind: "error" }); return; }
    try {
      const result = await listOwnDeliveryAddresses();
      if (generation !== pageGeneration.current || currentAddressActorID() !== actorID) return;
      setState({ kind: "ready", actorID, addresses: result.addresses, nextCursor: result.nextCursor });
      if (firstSuccessfulLoad.current) {
        setFormOpen(result.addresses.length === 0);
        firstSuccessfulLoad.current = false;
      }
    } catch (cause) {
      if (generation !== pageGeneration.current || currentAddressActorID() !== actorID) return;
      setState({ kind: "error" });
      setError(errorText(cause));
    }
  }, []);

  async function loadMore() {
    if (loadingMore || state.kind !== "ready" || state.actorID !== currentAddressActorID() || !state.nextCursor) return;
    const generation = pageGeneration.current;
    const actorID = currentAddressActorID();
    if (!actorID) return;
    const isCurrent = () => generation === pageGeneration.current && currentAddressActorID() === actorID;
    const cursor = state.nextCursor;
    setLoadingMore(true);
    setError("");
    try {
      const result = await listOwnDeliveryAddresses(cursor);
      if (!isCurrent()) return;
      setState((current) => current.kind === "ready" && current.actorID === actorID && current.nextCursor === cursor
        ? { ...current, addresses: appendDistinctDeliveryAddresses(current.addresses, result.addresses), nextCursor: result.nextCursor }
        : current);
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause));
    } finally {
      if (isCurrent()) setLoadingMore(false);
    }
  }

  useEffect(() => {
    const subscription = subscribeClientCartActorChanges(
      activeActorIDRef.current,
      currentAddressActorID,
      (listener) => subscribeIdentitySession((session) => {
        listener(session.kind === "authenticated" ? session.identity.subject.trim() : "");
      }),
      (actorID) => {
        activeActorIDRef.current = actorID;
        pageGeneration.current += 1;
        locationGeneration.current += 1;
        actorRevision.current += 1;
        firstSuccessfulLoad.current = true;
        // Clear private addresses, edits and location before requesting the next actor's data.
        setState({ kind: "loading" });
        setEditing(null);
        setAddressText("");
        setAddressCityID("");
        setCoordinates(null);
        setFormOpen(true);
        setBusy(false);
        setLoadingMore(false);
        setLocationBusy(false);
        setError("");
        setNotice("");
        if (actorID) void load();
        else setState({ kind: "error" });
      },
    );
    if (!subscription.changedDuringSync) void load();
    return () => {
      pageGeneration.current += 1;
      locationGeneration.current += 1;
      actorRevision.current += 1;
      subscription.unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    if (!editing && selectedCityID && !addressCityID) setAddressCityID(selectedCityID);
  }, [addressCityID, editing, selectedCityID]);

  async function captureLocation() {
    if (busy || locationBusy) return;
    const actorID = currentAddressActorID();
    if (!actorID) return;
    const generation = ++locationGeneration.current;
    const isCurrent = () => generation === locationGeneration.current && currentAddressActorID() === actorID;
    setLocationBusy(true);
    setError("");
    setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setError("لم يُسمح بالوصول إلى الموقع. يمكنك المحاولة مجددًا من إعدادات الجهاز.");
        return;
      }
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!isCurrent()) return;
      if (!servicesEnabled) {
        setError("خدمة الموقع متوقفة على الجهاز. فعّلها ثم حاول التقاط الموقع.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!isCurrent()) return;
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setNotice("تم تحديد موقعك الحالي. راجعه أو عدّل النقطة على الخريطة ثم احفظ العنوان.");
    } catch {
      if (isCurrent()) setError("تعذر التقاط الموقع الحالي. تحقق من إعدادات الموقع ثم أعد المحاولة.");
    } finally {
      if (isCurrent()) setLocationBusy(false);
    }
  }

  function beginEdit(address: DeliveryAddress) {
    if (state.kind !== "ready" || state.actorID !== currentAddressActorID() || !state.addresses.some((item) => item.id === address.id)) return;
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
    const actorID = currentAddressActorID();
    if (!actorID) return;
    const generation = actorRevision.current;
    const isCurrent = () => generation === actorRevision.current && currentAddressActorID() === actorID;
    // New-address forms are private too: a stale A form must not create a
    // B-owned record if Identity switches before the subscription resets UI.
    if (state.kind !== "ready" || state.actorID !== actorID || activeActorIDRef.current !== actorID) return;
    if (busy || value.length < 3 || value.length > 500 || !coordinates || !addressCityID) {
      setError("اكتب وصفًا واضحًا للعنوان وحدد موقعه على الخريطة أو التقطه قبل الحفظ.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let successNotice: string;
      if (editing) {
        await updateOwnDeliveryAddress(editing.id, { addressText: value, latitude: coordinates.latitude, longitude: coordinates.longitude, serviceCityId: addressCityID }, editing.version, actorID);
        successNotice = "تم حفظ تغييرات العنوان.";
      } else {
        await createOwnDeliveryAddress({ addressText: value, latitude: coordinates.latitude, longitude: coordinates.longitude, serviceCityId: addressCityID }, actorID);
        successNotice = "تم حفظ العنوان.";
      }
      if (!isCurrent()) return;
      cancelEdit();
      setFormOpen(false);
      setNotice(successNotice);
      await load();
    } catch (cause) {
      if (!isCurrent()) return;
      setError(errorText(cause));
      if (isLocationHttpError(cause, 409)) await load();
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  // A previously rendered actor must not leak their private list during a session transition.
  const displayState: AddressState = state.kind === "ready" && state.actorID !== currentAddressActorID()
    ? { kind: "loading" } : state;
  // The address form and map can contain private text and precise coordinates.
  // Do not render them before this actor's own list has been read back.
  const privateFormReady = displayState.kind === "ready" &&
    activeActorIDRef.current === displayState.actorID &&
    displayState.actorID === currentAddressActorID();

  return (
    <View style={styles.container} accessibilityLabel="العناوين المحفوظة">
      <Text style={styles.eyebrow}>عنوان التوصيل</Text>
      <Text style={styles.title}>عناوينك المملوكة</Text>
      <Text selectable style={styles.muted}>احفظ أكثر من عنوان. الموقع يُطلب فقط عند التقاطه، ولا يُستخدم هنا لاتخاذ قرار إمكانية التوصيل.</Text>
      {notice && privateFormReady ? <Text accessibilityLiveRegion="polite" selectable style={styles.notice}>{notice}</Text> : null}
      {error && displayState.kind !== "ready" ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      {privateFormReady && !formOpen ? <BthwaniButton accessibilityLabel="إضافة عنوان جديد" label="إضافة عنوان جديد" onPress={() => { setFormOpen(true); setNotice(""); setError(""); }} variant="secondary" /> : null}

      {privateFormReady && formOpen ? <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>{editing ? "تعديل العنوان" : "إضافة عنوان"}</Text>
        <Text style={styles.fieldLabel}>مدينة العنوان</Text>
        <View style={styles.cityList}>{cities.map((city) => <BthwaniChip key={city.id} label={serviceCityDisplayName(city.displayNameAr)} onPress={() => setAddressCityID(city.id)} selected={addressCityID === city.id} />)}</View>
        <Text style={styles.fieldLabel}>وصف العنوان</Text>
        <TextInput
          accessibilityLabel="وصف العنوان"
          editable={!busy}
          multiline
          onChangeText={setAddressText}
          placeholder="مثال: شارع الزبيري، جوار المبنى الأبيض"
          placeholderTextColor={theme.colorMuted}
          style={styles.input}
          value={addressText}
        />
        <Text style={styles.fieldLabel}>حدد نقطة التوصيل على الخريطة</Text>
        <Text style={styles.muted}>حرّك الخريطة ثم المس النقطة الصحيحة أو اسحب الدبوس. احفظها بعد مراجعة العنوان.</Text>
        <BthwaniMap accessibilityLabel="اختيار نقطة عنوان التوصيل" selection={coordinates} selectionTitle="عنوان التوصيل" onSelectCoordinate={(coordinate) => { if (!busy) { setCoordinates(coordinate); setNotice("تم تحديد نقطة العنوان على الخريطة."); setError(""); } }} />
        <BthwaniButton accessibilityLabel="التقاط الموقع الحالي" busy={locationBusy} disabled={busy} label="التقاط الموقع الحالي" onPress={() => void captureLocation()} variant="secondary" />
        <View style={styles.coordinateBox}>
          <Text style={styles.coordinateLabel}>حالة الموقع</Text>
          <Text selectable style={styles.coordinateValue}>{coordinates ? "تم تحديد الموقع" : "لم يُحدد الموقع بعد"}</Text>
        </View>
        <View style={styles.actionRow}>
          <BthwaniButton accessibilityLabel={editing ? "حفظ تغييرات العنوان" : "حفظ العنوان"} busy={busy} label={editing ? "حفظ تغييرات العنوان" : "حفظ العنوان"} onPress={() => void save()} style={styles.actionButton} />
          {editing ? <BthwaniButton accessibilityLabel="إلغاء تعديل العنوان" disabled={busy} label="إلغاء" onPress={cancelEdit} variant="secondary" /> : null}
        </View>
        {error && displayState.kind === "ready" ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" selectable style={styles.error}>{error}</Text> : null}
      </View> : null}

      <View style={styles.listCard}>
        <Text style={styles.sectionTitle}>العناوين المحفوظة</Text>
        {displayState.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة العناوين…</Text></View> : null}
        {displayState.kind === "error" ? <View style={styles.state}><Text selectable style={styles.muted}>{error || "تعذر قراءة العناوين."}</Text><BthwaniButton accessibilityLabel="إعادة قراءة العناوين" label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /></View> : null}
        {displayState.kind === "ready" && displayState.addresses.length === 0 ? <View style={styles.state}><Text style={styles.muted}>لا توجد عناوين محفوظة بعد.</Text><Text style={styles.muted}>أضف عنوانًا ليصبح جاهزًا للاستخدام لاحقًا.</Text></View> : null}
        {displayState.kind === "ready" && displayState.addresses.length > 0 ? <><View style={styles.addressList}>{displayState.addresses.map((address) => <View key={address.id} style={styles.addressItem}><Text selectable style={styles.addressText}>{address.addressText}</Text><Text selectable style={styles.addressMeta}>الموقع: تم تحديد الموقع</Text><Pressable accessibilityRole="button" accessibilityLabel={`تعديل العنوان ${address.addressText}`} disabled={busy} onPress={() => beginEdit(address)} style={styles.editButton}><Text style={styles.editButtonText}>تعديل العنوان</Text></Pressable></View>)}</View>{displayState.nextCursor ? <BthwaniButton accessibilityLabel="عرض المزيد من العناوين" busy={loadingMore} label="عرض المزيد" onPress={() => void loadMore()} variant="secondary" /> : null}</> : null}
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.background, gap: spacing[3], padding: spacing[4], width: "100%" },
    eyebrow: { ...typography.label, color: theme.interactiveText },
    title: { ...typography.titleMd, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    formCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    listCard: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
    sectionTitle: { ...typography.bodyStrong, color: theme.color },
    fieldLabel: { ...typography.bodyStrong, color: theme.color },
    cityList: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    actionButton: { flex: 1 },
    input: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 84, paddingHorizontal: spacing[3], paddingVertical: spacing[3], textAlignVertical: "top" },
    coordinateBox: { backgroundColor: theme.structureSoft, borderRadius: radius.md, gap: spacing[1], padding: spacing[3] },
    coordinateLabel: { ...typography.caption, color: theme.colorMuted },
    coordinateValue: { ...typography.bodySm, color: theme.color, fontVariant: ["tabular-nums"] },
    actionRow: { flexDirection: "row", gap: spacing[3] },
    notice: { ...typography.bodySm, backgroundColor: theme.successSoft, borderRadius: radius.sm, color: theme.success, padding: spacing[2] },
    error: { ...typography.bodySm, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, padding: spacing[2] },
    state: { alignItems: "center", gap: spacing[2], justifyContent: "center", paddingVertical: spacing[8] },
    addressList: { gap: spacing[3] },
    addressItem: { backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    addressText: { ...typography.bodyStrong, color: theme.color },
    addressMeta: { ...typography.caption, color: theme.colorMuted, fontVariant: ["tabular-nums"] },
    editButton: { alignSelf: "flex-start", minHeight: sizing.controlMd, justifyContent: "center", paddingHorizontal: spacing[1] },
    editButtonText: { ...typography.label, color: theme.interactiveText, textDecorationLine: "underline" },
  });
}
