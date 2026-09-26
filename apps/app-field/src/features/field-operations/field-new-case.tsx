import { BthwaniButton, BthwaniChip, BthwaniMap, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CommerceVertical, type CreateJoiningCaseRequest, type DshImageUploadInput, type FieldAdmission, type JoiningCaseResponse, joiningCaseStateLabel, type ServiceCity } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient, isMissingFieldAdmission } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

type PendingCreateAttempt = Readonly<{ request: CreateJoiningCaseRequest; idempotencyKey: string; correlationID: string }>;
type PendingImageAttempt = Readonly<{ caseID: string; expectedVersion: number; image: DshImageUploadInput; idempotencyKey: string; correlationID: string }>;

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
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "", firstStoreLatitude: 0, firstStoreLongitude: 0, firstStoreFulfillmentModes: [] });
  const [storeLatitude, setStoreLatitude] = useState("");
  const [storeLongitude, setStoreLongitude] = useState("");
  const parsedStoreLatitude = Number(storeLatitude);
  const parsedStoreLongitude = Number(storeLongitude);
  const selectedStoreOrigin = Number.isFinite(parsedStoreLatitude) && Number.isFinite(parsedStoreLongitude) && storeLatitude.trim() !== "" && storeLongitude.trim() !== "" && parsedStoreLatitude >= -90 && parsedStoreLatitude <= 90 && parsedStoreLongitude >= -180 && parsedStoreLongitude <= 180 ? { latitude: parsedStoreLatitude, longitude: parsedStoreLongitude } : null;
  const [createdCase, setCreatedCase] = useState<JoiningCaseResponse | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeImage, setStoreImage] = useState<DshImageUploadInput | null>(null);
  const [pendingCreateAttempt, setPendingCreateAttempt] = useState<PendingCreateAttempt | null>(null);
  const [pendingImageAttempt, setPendingImageAttempt] = useState<PendingImageAttempt | null>(null);
  const formLocked = busy || Boolean(pendingCreateAttempt) || Boolean(pendingImageAttempt) || Boolean(createdCase && storeImage);

  const loadAdmission = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().readOwnFieldAdmission(token);
      setAdmission(response.admission);
    } catch (cause) {
      if (isMissingFieldAdmission(cause)) {
        setAdmission(null);
        return;
      }
      console.error("DSH Field admission readback failed", cause);
      setError("تعذر قراءة قبول الميدان. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAdmission(); }, [loadAdmission]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const [nextCities, nextVerticals] = await Promise.all([fieldClient().listActiveServiceCities(), fieldClient().listCatalogVerticals()]);
      setCities(nextCities);
      setVerticals(nextVerticals);
    } catch (cause) {
      console.error("DSH Field canonical options read failed", cause);
      setOptionsError("تعذر قراءة المدن والأنشطة المتاحة. أعد المحاولة.");
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  async function createCase() {
    if (busy || (createdCase && storeImage)) return;
    let attempt: PendingCreateAttempt;
    if (pendingCreateAttempt) {
      attempt = pendingCreateAttempt;
    } else {
      const latitude = Number(storeLatitude.trim());
      const longitude = Number(storeLongitude.trim());
      if (!input.contactPhoneE164.trim() || !input.businessName.trim() || !input.firstStoreName.trim() || !input.serviceCityId || !input.firstStoreVerticalId || input.firstStoreFulfillmentModes.length === 0 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
	        setError("أكمل بيانات المتجر واختر وضعًا واحدًا على الأقل.");
        return;
      }
      const request: CreateJoiningCaseRequest = {
        ...input,
        contactPhoneE164: input.contactPhoneE164.trim(),
        businessName: input.businessName.trim(),
        firstStoreName: input.firstStoreName.trim(),
        serviceCityId: input.serviceCityId.trim(),
        firstStoreVerticalId: input.firstStoreVerticalId.trim(),
        firstStoreLatitude: latitude,
        firstStoreLongitude: longitude,
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
      setStoreLatitude("");
      setStoreLongitude("");
      setInput({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "", firstStoreLatitude: 0, firstStoreLongitude: 0, firstStoreFulfillmentModes: [] });
      await loadAdmission();
    } catch (cause) {
      console.error("DSH Field joining-case creation failed", cause);
      if (isOutcomeUncertain(cause)) {
        setError("تعذر تأكيد نتيجة الحفظ. أعد المحاولة لإعادة قراءة النتيجة من DSH بالمفتاح نفسه.");
      } else {
        setPendingCreateAttempt(null);
        setError(dshErrorCode(cause) === "JOINING_CASE_EXISTS" ? "يوجد ملف نشط لهذا الهاتف. افتح ملفات الانضمام للتحقق من السجل قبل إنشاء ملف آخر." : "تعذر حفظ الملف. تحقق من الهاتف والأسماء والاختيارات ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
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
      setStoreImage({ uri: asset.uri, name: asset.fileName ?? "store-image.jpg", type: asset.mimeType ?? "image/jpeg", blob });
      setError("");
    } catch (cause) {
      console.error("Field store image preparation failed", cause);
      setError("تعذر تجهيز صورة المتجر. اختر الصورة مرة أخرى.");
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

  async function uploadStoreImage(current: JoiningCaseResponse, image: DshImageUploadInput, existingAttempt?: PendingImageAttempt) {
    const attempt = existingAttempt ?? { caseID: current.case.id, expectedVersion: current.case.version, image, idempotencyKey: `field_store_image_${Crypto.randomUUID()}`, correlationID: `field_store_image_corr_${Crypto.randomUUID()}` };
    setPendingImageAttempt(attempt);
    try {
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadJoiningCaseStoreImage(token, attempt.caseID, attempt.image, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      setCreatedCase(uploaded);
      setStoreImage(null);
      setPendingImageAttempt(null);
    } catch (cause) {
      console.error("DSH Field store image upload failed", cause);
      if (dshErrorCode(cause) === "MEDIA_STORAGE_UNAVAILABLE") {
        setPendingImageAttempt(null);
        setError("تعذر تخزين الصورة. أعد رفع الملف المختار أو اختر صورة أخرى.");
        return;
      }
      if (isOutcomeUncertain(cause)) {
        setError("تم حفظ الملف، لكن لم تتأكد نتيجة رفع الصورة. أعد المحاولة بالمفتاح نفسه.");
        return;
      }
      setPendingImageAttempt(null);
      try {
        const token = await getUsableIdentityAccessToken();
        const latest = await fieldClient().readOwnFieldJoiningCase(token, attempt.caseID);
        setCreatedCase(latest);
      } catch (readError) {
        console.error("DSH Field case reconciliation after image upload failed", readError);
      }
      setError("تم حفظ الملف، لكن تعذر تأكيد رفع الصورة. تمت إعادة قراءة الحالة الكانونية؛ تحقق منها قبل المحاولة مجددًا.");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="ملف انضمام جديد">
      <Text style={styles.title}>ملف انضمام جديد</Text>
      <Text style={styles.muted}>اجمع بيانات النشاط والمتجر في ملف واحد، ثم أرسله للمراجعة عند اكتماله.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ التحقق من الأهلية…</Text></View> : null}
      {!loading && admission?.state !== "eligible" ? <View style={styles.card}><Text style={styles.cardTitle}>لا يمكن إنشاء ملف الآن</Text><Text style={styles.muted}>أهلية الميدان الحالية لا تسمح بإنشاء ملف جديد.</Text></View> : null}
      {!loading && admission?.state === "eligible" ? <View style={styles.card}>
        <Text style={styles.label}>هاتف صاحب النشاط</Text>
        <TextInput accessibilityLabel="هاتف صاحب النشاط" editable={!formLocked} autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: ‎+967…" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
        <Text style={styles.label}>اسم النشاط</Text>
        <TextInput accessibilityLabel="اسم النشاط" editable={!formLocked} placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
        <Text style={styles.label}>اسم أول متجر</Text>
        <TextInput accessibilityLabel="اسم أول متجر" editable={!formLocked} placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
        <Text style={styles.label}>مدينة الخدمة</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
        {optionsError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text><BthwaniButton label="إعادة قراءة الخيارات" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
        {!optionsLoading && !optionsError && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => <BthwaniChip key={city.id} label={city.displayNameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, serviceCityId: city.id })); }} selected={input.serviceCityId === city.id} />)}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && !optionsError && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => { if (!formLocked) setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id })); }} selected={input.firstStoreVerticalId === vertical.id} />)}</View>
        <Text style={styles.label}>أوضاع الطلب التي اختارها الشريك عند الانضمام</Text>
        <Text style={styles.muted}>سجّل الأوضاع المتاحة في المتجر لأول مرة. بعد إنشاء المتجر لا يغيّرها الشريك من التطبيق؛ يديرها المشغّل من لوحة التحكم.</Text>
        <View style={styles.optionList}>
          <BthwaniChip label="توصيل بثواني · مسؤولية المنصة" onPress={() => { if (!formLocked) toggleFulfillmentMode("BTHWANI_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("BTHWANI_CAPTAIN")} />
          <BthwaniChip label="توصيل المتجر · كابتن المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("PARTNER_CAPTAIN"); }} selected={input.firstStoreFulfillmentModes.includes("PARTNER_CAPTAIN")} />
          <BthwaniChip label="استلم بنفسك من المتجر" onPress={() => { if (!formLocked) toggleFulfillmentMode("CUSTOMER_PICKUP"); }} selected={input.firstStoreFulfillmentModes.includes("CUSTOMER_PICKUP")} />
        </View>
        <Text style={styles.label}>موقع المتجر الثابت</Text>
        <Text style={styles.muted}>حدد نقطة المتجر على الخريطة أو أدخل الإحداثيات. تنتقل النقطة إلى المتجر عند الاعتماد ولا تُعدّل من شاشة إدارة المتجر.</Text>
        <BthwaniMap accessibilityLabel="تحديد موقع المتجر الثابت" selection={selectedStoreOrigin} selectionTitle="موقع المتجر" onSelectCoordinate={(coordinate) => { if (!formLocked) { setStoreLatitude(coordinate.latitude.toFixed(6)); setStoreLongitude(coordinate.longitude.toFixed(6)); setError(""); } }} />
        <TextInput accessibilityLabel="خط عرض موقع المتجر" editable={!formLocked} keyboardType="numbers-and-punctuation" placeholder="خط العرض، مثال: 15.369445" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={storeLatitude} onChangeText={setStoreLatitude} />
        <TextInput accessibilityLabel="خط طول موقع المتجر" editable={!formLocked} keyboardType="numbers-and-punctuation" placeholder="خط الطول، مثال: 44.191006" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={storeLongitude} onChangeText={setStoreLongitude} />
        <Text style={styles.label}>صورة المتجر · اختياري</Text>
        <Text style={styles.muted}>يمكنك إضافة صورة واضحة للواجهة أو الهوية البصرية؛ تحفظ مركزيًا وتظهر بعد اعتماد المتجر.</Text>
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="cover" /> : null}
        <BthwaniButton disabled={formLocked} label={storeImage ? "تغيير صورة المتجر" : "اختيار صورة المتجر"} onPress={() => void pickStoreImage()} variant="secondary" />
        <BthwaniButton busy={busy} disabled={busy || (!pendingCreateAttempt && (formLocked || optionsLoading || Boolean(optionsError)))} label={pendingCreateAttempt ? "إعادة التحقق من حفظ الملف" : "حفظ الملف"} onPress={() => void createCase()} />
      </View> : null}
      {createdCase ? <View accessibilityLiveRegion="polite" style={styles.successCard}>
        <Text style={styles.cardTitle}>تم حفظ ملف الانضمام</Text>
        <Text style={styles.muted}>{createdCase.case.businessName} · {createdCase.case.firstStoreName}</Text>
        <Text style={styles.successText}>الحالة: {joiningCaseStateLabel(createdCase.case.state)}</Text>
        {storeImage ? <>
          <Image accessibilityLabel="معاينة صورة المتجر التي لم يكتمل رفعها" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 120, width: "100%" }} resizeMode="cover" />
          <BthwaniButton disabled={busy || Boolean(pendingImageAttempt)} label="اختيار صورة أخرى" onPress={() => void pickStoreImage()} variant="secondary" />
          <BthwaniButton busy={busy} disabled={busy} label={pendingImageAttempt ? "إعادة التحقق من رفع الصورة" : "إعادة رفع صورة المتجر"} onPress={() => void retryStoreImage()} variant="secondary" />
        </> : null}
        <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح ملفات الانضمام" variant="secondary" /></Link>
      </View> : null}
      {error ? <View><Text accessibilityRole="alert" style={styles.error}>{error}</Text>{pendingCreateAttempt || error.startsWith("يوجد ملف نشط") ? <Link href={"/cases" as Href} asChild><BthwaniButton label="قراءة ملفات الانضمام المحفوظة" variant="secondary" /></Link> : null}</View> : null}
      <BthwaniButton busy={busy} disabled={busy} label="تحديث الأهلية" onPress={() => void loadAdmission()} variant="secondary" />
    </View>
  );
}
