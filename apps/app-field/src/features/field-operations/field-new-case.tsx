import { BthwaniButton, BthwaniChip, BthwaniMap, useAppearanceTheme, type BthwaniMapCoordinate } from "@bthwani/design-system/native";
import { fieldAdmissionStateLabel, isMediaProvenanceInputValid, type CommercialStoreType, type CommerceVertical, type CreateJoiningCaseRequest, type DshImageUploadInput, type JoiningCaseProofType, type JoiningCaseResponse, joiningCaseStateLabel, type MediaProvenanceInput, type ServiceCity, type StoreWorkingHoursInterval } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Switch, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";
import { useOwnFieldAdmission } from "./use-field-admission";

type PendingCreateAttempt = Readonly<{ request: CreateJoiningCaseRequest; idempotencyKey: string; correlationID: string }>;
type StoreImageDraft = DshImageUploadInput & Readonly<{ provenance: MediaProvenanceInput }>;
type PendingImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: StoreImageDraft; idempotencyKey: string; correlationID: string }>;
type PendingProofImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;
type EditableWorkingHoursInterval = Readonly<{ id: string; opensAt: string; closesAt: string; closesNextDay: boolean }>;

const weekdays = [
  { day: 1, label: "الاثنين" },
  { day: 2, label: "الثلاثاء" },
  { day: 3, label: "الأربعاء" },
  { day: 4, label: "الخميس" },
  { day: 5, label: "الجمعة" },
  { day: 6, label: "السبت" },
  { day: 7, label: "الأحد" },
] as const;

const proofTypeOptions: ReadonlyArray<{ value: JoiningCaseProofType; label: string }> = [
  { value: "COMMERCIAL_REGISTRATION", label: "سجل تجاري" },
  { value: "IDENTITY_DOCUMENT", label: "هوية" },
  { value: "FREELANCE_WORK_DOCUMENT", label: "وثيقة عمل حر" },
];

function initialJoiningCaseInput(): CreateJoiningCaseRequest {
  return {
    contactPhoneE164: "",
    ownerFullName: "",
    businessName: "",
    firstStoreName: "",
    firstStoreAddress: "",
    serviceCityId: "",
    firstStoreVerticalId: "",
    firstStoreCommercialTypeId: "",
    firstStoreLatitude: 0,
    firstStoreLongitude: 0,
    firstStoreWorkingHours: { intervals: [] },
    firstStoreProofType: "COMMERCIAL_REGISTRATION",
    firstStoreProofNumber: "",
    firstStoreFulfillmentModes: [],
  };
}

function isValidLocalTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

function toWorkingHoursIntervals(schedule: Readonly<Record<number, ReadonlyArray<EditableWorkingHoursInterval>>>): ReadonlyArray<StoreWorkingHoursInterval> {
  return weekdays.flatMap(({ day }) => (schedule[day] ?? []).map((interval) => ({ dayOfWeek: day, opensAt: interval.opensAt, closesAt: interval.closesAt, closesNextDay: interval.closesNextDay })));
}

function isValidWorkingHours(schedule: Readonly<Record<number, ReadonlyArray<EditableWorkingHoursInterval>>>): boolean {
  const intervals = toWorkingHoursIntervals(schedule);
  return intervals.length > 0 && intervals.length <= 28 && intervals.every((interval) =>
    isValidLocalTime(interval.opensAt)
    && isValidLocalTime(interval.closesAt)
    && (interval.closesNextDay || interval.opensAt !== interval.closesAt),
  );
}

function isOutcomeUncertain(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const error = cause as { kind?: unknown; status?: unknown };
  return error.kind === "network" || (error.kind === "http" && typeof error.status === "number" && error.status >= 500);
}

function dshErrorCode(cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function FieldNewCase() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { state: admissionState, refresh: refreshAdmission } = useOwnFieldAdmission();
  const [input, setInput] = useState<CreateJoiningCaseRequest>(initialJoiningCaseInput);
  const [workingHoursByDay, setWorkingHoursByDay] = useState<Record<number, ReadonlyArray<EditableWorkingHoursInterval>>>({});
  const [selectedStoreOrigin, setSelectedStoreOrigin] = useState<BthwaniMapCoordinate | null>(null);
  const [createdCase, setCreatedCase] = useState<JoiningCaseResponse | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [commercialTypes, setCommercialTypes] = useState<ReadonlyArray<CommercialStoreType>>([]);
  const [commercialTypesLoading, setCommercialTypesLoading] = useState(false);
  const [commercialTypesError, setCommercialTypesError] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationError, setLocationError] = useState("");
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);
  const [proofImage, setProofImage] = useState<DshImageUploadInput | null>(null);
  const [pendingCreateAttempt, setPendingCreateAttempt] = useState<PendingCreateAttempt | null>(null);
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingImageAttempt | null>(null);
  const [pendingProofImageAttempt, setPendingProofImageAttempt] = useState<PendingProofImageAttempt | null>(null);
  const formLocked = busy || Boolean(pendingCreateAttempt) || Boolean(pendingImageAttempt) || Boolean(pendingProofImageAttempt) || Boolean(createdCase && storeImage);

  const loadAdmission = useCallback(async () => {
    setError("");
    await refreshAdmission();
  }, [refreshAdmission]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const [nextCities, nextVerticals] = await Promise.all([fieldClient().listActiveServiceCities(), fieldClient().listCatalogVerticals()]);
      setCities(nextCities);
      setVerticals(nextVerticals);
    } catch (cause) {
      console.warn("DSH Field canonical options read failed", cause);
      setOptionsError("تعذر قراءة المدن والأنشطة المتاحة. أعد المحاولة.");
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  useEffect(() => {
    const verticalId = input.firstStoreVerticalId;
    setCommercialTypes([]);
    setCommercialTypesError("");
    setInput((current) => current.firstStoreCommercialTypeId ? { ...current, firstStoreCommercialTypeId: "" } : current);
    if (!verticalId) return;
    let active = true;
    setCommercialTypesLoading(true);
    void fieldClient().listCommercialStoreTypes(verticalId)
      .then((items) => { if (active) setCommercialTypes(items.filter((item) => item.active)); })
      .catch((cause: unknown) => {
        console.warn("DSH Field commercial store type read failed", cause);
        if (active) setCommercialTypesError("تعذر قراءة أنواع المتاجر لهذه الفئة.");
      })
      .finally(() => { if (active) setCommercialTypesLoading(false); });
    return () => { active = false; };
  }, [input.firstStoreVerticalId]);

  async function createCase() {
    if (busy || (createdCase && storeImage)) return;
    if (storeImage && !isMediaProvenanceInputValid(storeImage.provenance)) {
      setError("أكمل منشئ الصورة ومصدرها وبيان حق استخدامها، ثم أكّد صحة التصريح.");
      return;
    }
    let attempt: PendingCreateAttempt;
    if (pendingCreateAttempt) {
      attempt = pendingCreateAttempt;
    } else {
      if (!input.contactPhoneE164.trim() || !input.ownerFullName.trim() || !input.businessName.trim() || !input.firstStoreName.trim() || !input.firstStoreAddress.trim() || !input.serviceCityId || !input.firstStoreVerticalId || !input.firstStoreCommercialTypeId || !input.firstStoreProofNumber.trim() || !isValidWorkingHours(workingHoursByDay) || input.firstStoreFulfillmentModes.length === 0 || !selectedStoreOrigin) {
        setError("أكمل اسم المالك والنشاط والمتجر والعنوان والمدينة والتصنيف والإثبات وساعات العمل والموقع، واختر طريقة توصيل واحدة على الأقل.");
        return;
      }
      const { firstStoreNotes, ...requiredInput } = input;
      const normalizedNotes = firstStoreNotes?.trim();
      const request: CreateJoiningCaseRequest = {
        ...requiredInput,
        contactPhoneE164: input.contactPhoneE164.trim(),
        ownerFullName: input.ownerFullName.trim(),
        businessName: input.businessName.trim(),
        firstStoreName: input.firstStoreName.trim(),
        firstStoreAddress: input.firstStoreAddress.trim(),
        serviceCityId: input.serviceCityId.trim(),
        firstStoreVerticalId: input.firstStoreVerticalId.trim(),
        firstStoreWorkingHours: { intervals: toWorkingHoursIntervals(workingHoursByDay) },
        firstStoreProofNumber: input.firstStoreProofNumber.trim(),
        ...(normalizedNotes ? { firstStoreNotes: normalizedNotes } : {}),
        firstStoreLatitude: selectedStoreOrigin.latitude,
        firstStoreLongitude: selectedStoreOrigin.longitude,
      };
      attempt = { request, idempotencyKey: `field_joining_case_create_${Crypto.randomUUID()}`, correlationID: `field_joining_case_corr_${Crypto.randomUUID()}` };
    }
    setPendingCreateAttempt(attempt);
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().createFieldJoiningCase(token, attempt.request, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(response);
      setPendingCreateAttempt(null);
      if (storeImage) {
        await uploadStoreImage(response, storeImage);
      }
      setSelectedStoreOrigin(null);
      setInput(initialJoiningCaseInput());
      setWorkingHoursByDay({});
      await loadAdmission();
    } catch (cause) {
      console.warn("DSH Field joining-case creation failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("تعذر تأكيد الحفظ. أعد المحاولة للتحقق من النتيجة قبل إنشاء طلب جديد.");
      } else {
        setPendingCreateAttempt(null);
        const code = dshErrorCode(cause);
        setError(code === "JOINING_CASE_EXISTS"
          ? "يوجد طلب نشط لهذا الهاتف. افتح قائمة الشركاء للتحقق منه قبل إنشاء طلب آخر."
          : code === "SERVICE_CITY_UNAVAILABLE"
            ? "مدينة الخدمة لم تعد نشطة. أعد قراءة المدن واختر مدينة أخرى."
            : code === "VERTICAL_UNAVAILABLE"
              ? "الفئة الرئيسية لم تعد نشطة. أعد قراءة الأنشطة واختر فئة أخرى."
              : "تعذر حفظ طلب الشريك. تحقق من الهاتف والأسماء والاختيارات ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function useCurrentLocation() {
    if (formLocked || locationBusy) return;
    setLocationBusy(true);
    setLocationMessage("");
    setLocationError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationError("لم نتمكن من استخدام موقعك. اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setLocationError("خدمة الموقع غير مفعّلة. فعّلها أو اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude) || coordinate.latitude < -90 || coordinate.latitude > 90 || coordinate.longitude < -180 || coordinate.longitude > 180) {
        setLocationError("تعذر تحديد موقع صالح. اختر موقع المتجر يدويًا على الخريطة.");
        return;
      }
      setSelectedStoreOrigin(coordinate);
      setLocationMessage("حددنا موقعك كنقطة بداية. اسحب المؤشر أو المس الخريطة لضبط موقع المتجر.");
    } catch {
      setLocationError("تعذر تحديد موقعك الآن. يمكنك اختيار موقع المتجر يدويًا على الخريطة.");
    } finally {
      setLocationBusy(false);
    }
  }

  function toggleFulfillmentMode(mode: "BTHWANI_CAPTAIN" | "PARTNER_CAPTAIN" | "CUSTOMER_PICKUP") {
    setInput((current) => {
      const selected = current.firstStoreFulfillmentModes.includes(mode);
      return { ...current, firstStoreFulfillmentModes: selected ? current.firstStoreFulfillmentModes.filter((value) => value !== mode) : [...current.firstStoreFulfillmentModes, mode] };
    });
  }

  async function pickStoreImage() {
    if (busy || pendingImageAttempt) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المتجر."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      setStoreImage({ uri: asset.uri, name: asset.fileName ?? "store-image.jpg", type: asset.mimeType ?? "image/jpeg", blob, provenance: { creator: "", sourceDescription: "", sourceUri: "", rightsStatement: "", rightsUri: "", rightsAttested: false } });
      setError("");
    } catch (cause) {
      console.warn("Field store image preparation failed", cause);
      setError("تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
    }
  }

  async function pickProofImage() {
    if (busy || pendingProofImageAttempt) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة الإثبات."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";
    if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
      setError("صيغة صورة الإثبات غير مدعومة. اختر صورة بصيغة JPG أو PNG.");
      return;
    }
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("PROOF_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("PROOF_IMAGE_SIZE_INVALID");
      setProofImage({ uri: asset.uri, name: asset.fileName ?? "joining-case-proof.jpg", type: mimeType, blob });
      setError("");
    } catch (cause) {
      console.warn("Field proof image preparation failed", cause);
      setError(cause instanceof Error && cause.message === "PROOF_IMAGE_SIZE_INVALID" ? "يجب ألا يتجاوز حجم صورة الإثبات 10 ميغابايت." : "تعذر تجهيز صورة الإثبات. اختر الصورة مرة أخرى.");
    }
  }

  async function retryStoreImage() {
    if (!createdCase || !storeImage || busy) return;
    setBusy(true);
    setError("");
    try {
      await uploadStoreImage(createdCase, storeImage, pendingImageAttempt ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  async function uploadStoreImage(current: JoiningCaseResponse, image: StoreImageDraft, existingAttempt?: PendingImageAttempt) {
    const attempt = existingAttempt ?? { caseID: current.case.id, expectedVersion: current.case.version, image, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    try {
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.image.provenance, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(uploaded);
      setStoreImage(null);
      setPendingImageAttempt(null);
    } catch (cause) {
      console.warn("DSH Field store image upload failed", cause);
      if (dshErrorCode(cause) === "MEDIA_STORAGE_UNAVAILABLE") {
        setPendingImageAttempt(null);
        setError("تعذر تخزين الصورة. أعد رفع الملف المختار أو اختر صورة أخرى.");
        return;
      }
      if (isOutcomeUncertain(cause)) {
        setError("حُفظت المسودة، لكن لم نتأكد من رفع الصورة بعد. أعد المحاولة للتحقق من حالتها.");
        return;
      }
      setPendingImageAttempt(null);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
        setCreatedCase(latest);
      } catch (readError) {
        console.warn("DSH Field case reconciliation after image upload failed", readError);
      }
      setError("حُفظ الطلب، لكن تعذر تأكيد رفع الصورة. حدّث الحالة قبل المحاولة مجددًا.");
    }
  }

  async function retryProofImage() {
    if (!createdCase || !proofImage || busy) return;
    setBusy(true);
    setError("");
    try {
      await uploadProofImage(createdCase, proofImage, pendingProofImageAttempt ?? undefined);
    } finally {
      setBusy(false);
    }
  }

  async function uploadProofImage(current: JoiningCaseResponse, image: DshImageUploadInput, existingAttempt?: PendingProofImageAttempt) {
    const attempt = existingAttempt ?? { caseID: current.case.id, expectedVersion: current.case.version, image, idempotencyKey: `field_proof_image_${Crypto.randomUUID()}`, correlationID: `field_proof_image_corr_${Crypto.randomUUID()}` };
    setPendingProofImageAttempt(attempt);
    try {
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadFieldJoiningCaseProofImage(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(uploaded);
      setProofImage(null);
      setPendingProofImageAttempt(null);
    } catch (cause) {
      console.warn("DSH Field proof image upload failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("لم نتأكد من رفع صورة الإثبات بعد. أعد المحاولة للتحقق من حالتها.");
        return;
      }
      setPendingProofImageAttempt(null);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
        setCreatedCase(latest);
      } catch (readError) {
        console.warn("DSH Field case reconciliation after proof image upload failed", readError);
      }
      setError("تعذر تأكيد صورة الإثبات. حدّث المسودة قبل إعادة الرفع.");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="إضافة شريك">
      <Text style={styles.title}>إضافة شريك</Text>
      <Text style={styles.muted}>أدخل بيانات المالك والمتجر والإثبات. تُحفظ المسودة أولًا؛ ارفع صورة الواجهة والإثبات قبل إرسالها للمراجعة.</Text>
      {admissionState.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة حالة التفعيل…</Text></View> : null}
      {admissionState.kind === "missing" ? <View style={styles.card}><Text style={styles.cardTitle}>لم يكتمل تفعيل الحساب</Text><Text style={styles.muted}>تواصل مع فريق التشغيل لإكمال تسجيلك للميدان.</Text></View> : null}
      {admissionState.kind === "ready" && admissionState.admission.state !== "eligible" ? <View style={styles.card}><Text style={styles.cardTitle}>لا يمكن إضافة شريك الآن</Text><Text style={styles.muted}>حالة التفعيل الحالية: {fieldAdmissionStateLabel(admissionState.admission.state)}. تابع الحالة أو تواصل مع فريق التشغيل.</Text></View> : null}
      {admissionState.kind === "error" ? <View style={styles.card}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة حالة تفعيلك الآن. أعد المحاولة عند توفر الاتصال.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void loadAdmission()} variant="secondary" /></View> : null}
      {admissionState.kind === "ready" && admissionState.admission.state === "eligible" ? <View style={styles.card}>
        <Text style={styles.label}>اسم المالك الكامل</Text>
        <TextInput accessibilityLabel="اسم المالك الكامل" editable={!formLocked} autoComplete="name" placeholder="الاسم كما يظهر في الإثبات" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.ownerFullName} onChangeText={(value) => setInput((current) => ({ ...current, ownerFullName: value }))} />
        <Text style={styles.label}>رقم جوال المالك</Text>
        <TextInput accessibilityLabel="رقم جوال المالك" editable={!formLocked} autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: ‎+967…" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
        <Text style={styles.label}>اسم النشاط أو المنشأة</Text>
        <TextInput accessibilityLabel="اسم النشاط" editable={!formLocked} placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
        <Text style={styles.label}>اسم المتجر</Text>
        <TextInput accessibilityLabel="اسم أول متجر" editable={!formLocked} placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
        <Text style={styles.label}>عنوان المتجر</Text>
        <TextInput accessibilityLabel="عنوان المتجر" editable={!formLocked} multiline placeholder="الحي، الشارع، وأقرب معلم" placeholderTextColor={theme.colorMuted} style={[styles.input, { minHeight: 88, paddingTop: 12, textAlignVertical: "top" }]} value={input.firstStoreAddress} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreAddress: value }))} />
        <Text style={styles.label}>مدينة الخدمة</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
        {optionsError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text><BthwaniButton label="إعادة قراءة الخيارات" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
        {!optionsLoading && !optionsError && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => <BthwaniChip key={city.id} label={city.displayNameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, serviceCityId: city.id })); }} selected={input.serviceCityId === city.id} />)}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && !optionsError && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id })); }} selected={input.firstStoreVerticalId === vertical.id} />)}</View>
        <Text style={styles.label}>نوع المتجر التجاري</Text>
        {commercialTypesLoading ? <Text style={styles.muted}>جارٍ قراءة أنواع المتاجر لهذه الفئة…</Text> : null}
        {commercialTypesError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{commercialTypesError}</Text><BthwaniButton label="إعادة قراءة أنواع المتاجر" onPress={() => { const verticalId = input.firstStoreVerticalId; if (verticalId) { setCommercialTypesError(""); setCommercialTypesLoading(true); void fieldClient().listCommercialStoreTypes(verticalId).then((items) => setCommercialTypes(items.filter((item) => item.active))).catch(() => setCommercialTypesError("تعذر قراءة أنواع المتاجر لهذه الفئة.")).finally(() => setCommercialTypesLoading(false)); } }} variant="secondary" /></View> : null}
        {!commercialTypesLoading && !commercialTypesError && input.firstStoreVerticalId && commercialTypes.length === 0 ? <Text style={styles.muted}>لا توجد أنواع متاجر مفعّلة لهذه الفئة. اطلب من المشغّل إعداد النوع التجاري أولًا.</Text> : null}
        <View style={styles.optionList}>{commercialTypes.map((item) => <BthwaniChip key={item.id} disabled={formLocked} label={item.nameAr} onPress={() => setInput((current) => ({ ...current, firstStoreCommercialTypeId: item.id }))} selected={input.firstStoreCommercialTypeId === item.id} />)}</View>
        <Text style={styles.label}>نوع الإثبات</Text>
        <View style={styles.optionList}>{proofTypeOptions.map((option) => <BthwaniChip key={option.value} disabled={formLocked} label={option.label} onPress={() => setInput((current) => ({ ...current, firstStoreProofType: option.value }))} selected={input.firstStoreProofType === option.value} />)}</View>
        <Text style={styles.label}>رقم الإثبات</Text>
        <TextInput accessibilityLabel="رقم الإثبات" editable={!formLocked} autoCapitalize="characters" placeholder="أدخل رقم السجل أو الوثيقة" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreProofNumber} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreProofNumber: value }))} />
        <View style={styles.card}>
          <Text style={styles.label}>صورة الإثبات الخاصة · مطلوبة قبل الإرسال</Text>
          <Text style={styles.muted}>تُخزّن مشفّرة في السجل الخاص ولا تظهر كصورة واجهة للمتجر. يُسمح بحفظ المسودة قبل الرفع، لكن الإرسال للمراجعة يتطلب تأكيد ربط الصورة.</Text>
          {proofImage ? <Image accessibilityLabel="معاينة صورة الإثبات الخاصة" source={{ uri: proofImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="contain" /> : null}
          <BthwaniButton disabled={formLocked} label={proofImage ? "تغيير صورة الإثبات" : "اختيار صورة الإثبات"} onPress={() => void pickProofImage()} variant="secondary" />
        </View>
        <Text style={styles.label}>أوضاع الطلب التي اختارها الشريك عند الانضمام</Text>
        <Text style={styles.muted}>سجّل الأوضاع المتاحة في المتجر لأول مرة. بعد إنشاء المتجر لا يغيّرها الشريك من التطبيق؛ يديرها المشغّل من لوحة التحكم.</Text>
        <View style={styles.optionList}>
          <BthwaniChip label="توصيل بثواني · مسؤولية المنصة" onPress={() => { if (!formLocked) toggleFulfillmentMode("BTHWANI_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("BTHWANI_CAPTAIN")} />
          <BthwaniChip label="توصيل المتجر · كابتن المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("PARTNER_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("PARTNER_CAPTAIN")} />
          <BthwaniChip label="استلم بنفسك من المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("CUSTOMER_PICKUP"); }} selected={input.firstStoreFulfillmentModes.includes("CUSTOMER_PICKUP")} />
        </View>
        <Text style={styles.label}>موقع المتجر الثابت</Text>
        <Text style={styles.muted}>حدد موقع المتجر على الخريطة أو استخدم موقعك الحالي كنقطة بداية، ثم اضبط المؤشر على المتجر.</Text>
        <BthwaniButton busy={locationBusy} disabled={formLocked} label="استخدام موقعي الحالي" onPress={() => void useCurrentLocation()} variant="secondary" />
        {locationMessage ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{locationMessage}</Text> : null}
        {locationError ? <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text> : null}
        <BthwaniMap accessibilityLabel="تحديد موقع المتجر على الخريطة" selection={selectedStoreOrigin} selectionTitle="موقع المتجر" onSelectCoordinate={(coordinate) => { if (!formLocked) { setSelectedStoreOrigin(coordinate); setLocationMessage(""); setLocationError(""); setError(""); } }} />
        <Text style={styles.label}>ساعات العمل الأسبوعية</Text>
        <Text style={styles.muted}>أيام الأسبوع التي تتركها مغلقة لا تُضاف إلى الجدول. افتح اليوم لإضافة فترة، ويمكن إضافة فترات متعددة أو تحديد أن الإغلاق في اليوم التالي.</Text>
        {weekdays.map(({ day, label }) => {
          const intervals = workingHoursByDay[day] ?? [];
          const totalIntervals = toWorkingHoursIntervals(workingHoursByDay).length;
          return <View key={day} style={styles.card}>
            <View style={styles.orderHeader}>
              <Text style={styles.label}>{label}</Text>
              <BthwaniChip disabled={formLocked} label={intervals.length ? `مفتوح (${intervals.length}) · إغلاق اليوم` : "مغلق · فتح اليوم"} onPress={() => setWorkingHoursByDay((current) => ({ ...current, [day]: current[day]?.length ? [] : [{ id: Crypto.randomUUID(), opensAt: "09:00", closesAt: "17:00", closesNextDay: false }] }))} selected={intervals.length > 0} />
            </View>
            {intervals.map((interval, index) => <View key={interval.id} style={{ gap: 8 }}>
              <Text style={styles.muted}>الفترة {index + 1} · الوقت المحلي للمدينة</Text>
              <View style={styles.optionList}>
                <TextInput accessibilityLabel={`${label} بداية الفترة ${index + 1}`} editable={!formLocked} keyboardType="numbers-and-punctuation" placeholder="من 09:00" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput, { flex: 1 }]} value={interval.opensAt} onChangeText={(opensAt) => setWorkingHoursByDay((current) => ({ ...current, [day]: (current[day] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, opensAt } : item) }))} />
                <TextInput accessibilityLabel={`${label} نهاية الفترة ${index + 1}`} editable={!formLocked} keyboardType="numbers-and-punctuation" placeholder="إلى 17:00" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput, { flex: 1 }]} value={interval.closesAt} onChangeText={(closesAt) => setWorkingHoursByDay((current) => ({ ...current, [day]: (current[day] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, closesAt } : item) }))} />
              </View>
              <View style={styles.optionList}>
                <Switch disabled={formLocked} value={interval.closesNextDay} onValueChange={(closesNextDay) => setWorkingHoursByDay((current) => ({ ...current, [day]: (current[day] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, closesNextDay } : item) }))} />
                <Text style={styles.muted}>ينتهي في اليوم التالي</Text>
                {intervals.length > 1 ? <BthwaniButton disabled={formLocked} label="حذف الفترة" onPress={() => setWorkingHoursByDay((current) => ({ ...current, [day]: (current[day] ?? []).filter((_, itemIndex) => itemIndex !== index) }))} variant="secondary" /> : null}
              </View>
            </View>)}
            {intervals.length > 0 ? <BthwaniButton disabled={formLocked || totalIntervals >= 28} label="إضافة فترة أخرى لهذا اليوم" onPress={() => setWorkingHoursByDay((current) => ({ ...current, [day]: [...(current[day] ?? []), { id: Crypto.randomUUID(), opensAt: "13:00", closesAt: "17:00", closesNextDay: false }] }))} variant="secondary" /> : null}
          </View>;
        })}
        {Object.values(workingHoursByDay).some((intervals) => intervals.some((interval) => !isValidLocalTime(interval.opensAt) || !isValidLocalTime(interval.closesAt) || (!interval.closesNextDay && interval.opensAt === interval.closesAt))) ? <Text accessibilityRole="alert" style={styles.error}>أدخل الوقت بصيغة 24 ساعة مثل 09:00، واجعل وقت الفتح والإغلاق مختلفين أو فعّل خيار الإغلاق في اليوم التالي.</Text> : null}
        <Text style={styles.label}>ملاحظات · اختياري</Text>
        <TextInput accessibilityLabel="ملاحظات اختيارية" editable={!formLocked} multiline maxLength={1000} placeholder="أي تفاصيل إضافية للمراجعة" placeholderTextColor={theme.colorMuted} style={[styles.input, { minHeight: 88, paddingTop: 12, textAlignVertical: "top" }]} value={input.firstStoreNotes ?? ""} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreNotes: value }))} />
        <Text style={styles.label}>صورة واجهة المتجر · مطلوبة قبل الإرسال</Text>
        <Text style={styles.muted}>اختر صورة واضحة للواجهة. تُرفع مركزيًا وتظهر بعد اعتماد المتجر؛ حفظ المسودة ممكن قبل رفعها، لكن لا تُرسل للمراجعة حتى تكتمل.</Text>
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="cover" /> : null}
        {storeImage ? <View style={styles.card}>
          <Text style={styles.label}>مصدر الصورة وحق استخدامها</Text>
          <Text style={styles.muted}>دوّن منشئ الصورة ومصدرها وبيان الحق أو الترخيص قبل رفعها.</Text>
          <TextInput accessibilityLabel="منشئ الصورة" editable={!formLocked} placeholder="منشئ الصورة أو المصور" placeholderTextColor={theme.colorMuted} style={styles.input} value={storeImage.provenance.creator} onChangeText={(creator) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, creator } } : null)} />
          <TextInput accessibilityLabel="مصدر الصورة" editable={!formLocked} placeholder="كيف حصلت على الصورة؟" placeholderTextColor={theme.colorMuted} style={styles.input} value={storeImage.provenance.sourceDescription} onChangeText={(sourceDescription) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, sourceDescription } } : null)} />
          <TextInput accessibilityLabel="رابط مصدر الصورة اختياري" editable={!formLocked} autoCapitalize="none" keyboardType="url" placeholder="رابط المصدر، اختياري" placeholderTextColor={theme.colorMuted} style={styles.input} value={storeImage.provenance.sourceUri} onChangeText={(sourceUri) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, sourceUri } } : null)} />
          <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!formLocked} multiline placeholder="بيان الحق أو الترخيص الذي يسمح بعرض الصورة" placeholderTextColor={theme.colorMuted} style={styles.input} value={storeImage.provenance.rightsStatement} onChangeText={(rightsStatement) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsStatement } } : null)} />
          <TextInput accessibilityLabel="رابط شروط الترخيص اختياري" editable={!formLocked} autoCapitalize="none" keyboardType="url" placeholder="رابط شروط الترخيص، اختياري" placeholderTextColor={theme.colorMuted} style={styles.input} value={storeImage.provenance.rightsUri} onChangeText={(rightsUri) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsUri } } : null)} />
          <View style={styles.optionList}><Switch disabled={formLocked} value={storeImage.provenance.rightsAttested} onValueChange={(rightsAttested) => setStoreImage((current) => current ? { ...current, provenance: { ...current.provenance, rightsAttested } } : null)} /><Text style={styles.muted}>أؤكد أن بيانات المصدر وحق الاستخدام المدخلة صحيحة.</Text></View>
        </View> : null}
        <BthwaniButton disabled={formLocked} label={storeImage ? "تغيير صورة المتجر" : "اختيار صورة المتجر"} onPress={() => void pickStoreImage()} variant="secondary" />
        <Text style={styles.muted}>حفظ المسودة لا يرسلها للمراجعة. أكمِل صورتي الواجهة والإثبات أولًا.</Text>
        <BthwaniButton busy={busy} disabled={busy || (!pendingCreateAttempt && (formLocked || optionsLoading || Boolean(optionsError)))} label={pendingCreateAttempt ? "التحقق من حفظ المسودة" : "حفظ المسودة"} onPress={() => void createCase()} />
      </View> : null}
      {createdCase ? <View accessibilityLiveRegion="polite" style={styles.successCard}>
        <Text style={styles.cardTitle}>حُفظت مسودة الشريك</Text>
        <Text style={styles.muted}>{createdCase.case.businessName} · {createdCase.case.firstStoreName}</Text>
        <Text style={styles.successText}>الحالة: {joiningCaseStateLabel(createdCase.case.state)} · لم يُرسل للمراجعة</Text>
        <Text style={createdCase.case.storeProfileImage ? styles.successText : styles.error}>{createdCase.case.storeProfileImage ? "صورة واجهة المتجر مرفوعة." : "مطلوب قبل الإرسال: اختيار صورة واجهة المتجر ورفعها."}</Text>
        <Text style={createdCase.case.firstStoreProofImageUploaded ? styles.successText : styles.error}>{createdCase.case.firstStoreProofImageUploaded ? "صورة الإثبات الخاصة مسجلة." : "مطلوب قبل الإرسال: رفع صورة الإثبات الخاصة عبر المسار الآمن."}</Text>
        {!createdCase.case.firstStoreProofImageUploaded ? <>
          {proofImage ? <Image accessibilityLabel="معاينة صورة الإثبات المختارة" source={{ uri: proofImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="contain" /> : null}
          <BthwaniButton disabled={busy || Boolean(pendingProofImageAttempt)} label={proofImage ? "تغيير صورة الإثبات" : "اختيار صورة الإثبات"} onPress={() => void pickProofImage()} variant="secondary" />
          {proofImage ? <BthwaniButton busy={busy} disabled={busy} label={pendingProofImageAttempt ? "إعادة التحقق من رفع صورة الإثبات" : "رفع صورة الإثبات المشفّرة"} onPress={() => void retryProofImage()} variant="primary" /> : null}
        </> : null}
        {storeImage ? <>
          <Image accessibilityLabel="معاينة صورة المتجر التي لم يكتمل رفعها" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" />
          <BthwaniButton disabled={busy || Boolean(pendingImageAttempt)} label="اختيار صورة أخرى" onPress={() => void pickStoreImage()} variant="secondary" />
          <BthwaniButton busy={busy} disabled={busy} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "إعادة رفع صورة المتجر"} onPress={() => void retryStoreImage()} variant="secondary" />
        </> : null}
        <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح قائمة الشركاء" variant="secondary" /></Link>
      </View> : null}
      {error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{pendingCreateAttempt || error.startsWith("يوجد طلب نشط") ? <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح قائمة الشركاء" variant="secondary" /></Link> : null}</View> : null}
      <BthwaniButton busy={busy} disabled={busy || admissionState.kind === "loading"} label="تحديث حالة التفعيل" onPress={() => void loadAdmission()} variant="secondary" />
    </View>
  );
}
