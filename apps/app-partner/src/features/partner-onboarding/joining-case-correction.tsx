import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import type { CommerceVertical, DshImageUploadInput, JoiningCaseResponse, ServiceCity, StoreFulfillmentMode } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, TextInput, View } from "react-native";
import { correctAndResubmitOwnJoiningCase, listCatalogVerticals, readOwnJoiningCase, uploadOwnJoiningCaseStoreImage } from "./store-readback-client";

type StoreImageDraft = Readonly<{ image: DshImageUploadInput; contentSha256: string }>;

export function JoiningCaseCorrection({ value, cities, onUpdated }: { value: JoiningCaseResponse; cities: ReadonlyArray<ServiceCity>; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [businessName, setBusinessName] = useState(current.businessName);
  const [firstStoreName, setFirstStoreName] = useState(current.firstStoreName);
  const [serviceCityId, setServiceCityId] = useState(current.serviceCityId || "");
  const [verticalId, setVerticalId] = useState(current.firstStoreVerticalId || "");
  const [latitude, setLatitude] = useState<number | null>(current.firstStoreLatitude);
  const [longitude, setLongitude] = useState<number | null>(current.firstStoreLongitude);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);

  useEffect(() => {
    setBusinessName(current.businessName);
    setFirstStoreName(current.firstStoreName);
    setServiceCityId(current.serviceCityId || "");
    setVerticalId(current.firstStoreVerticalId || "");
    setLatitude(current.firstStoreLatitude);
    setLongitude(current.firstStoreLongitude);
  }, [current.businessName, current.firstStoreName, current.serviceCityId, current.firstStoreVerticalId, current.firstStoreLatitude, current.firstStoreLongitude]);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsError(false);
    try {
      setVerticals(await listCatalogVerticals());
    } catch (cause) {
      console.error("DSH Partner correction options read failed", cause);
      setVerticals([]);
      setOptionsError(true);
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current.state === "needs_correction") void loadOptions();
  }, [current.state, loadOptions]);

  if (current.state !== "needs_correction") return null;

  async function correctAndResubmit() {
    const nextBusinessName = businessName.trim();
    const nextStoreName = firstStoreName.trim();
	    if (nextBusinessName.length < 2 || nextBusinessName.length > 160 || nextStoreName.length < 2 || nextStoreName.length > 160 || !serviceCityId || !verticalId || latitude === null || longitude === null) {
		setError("أدخل الأسماء واختر المدينة والنشاط، وتأكد من وجود موقع المتجر الثابت.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const resubmitted = await correctAndResubmitOwnJoiningCase(current.id, nextBusinessName, nextStoreName, serviceCityId, verticalId, latitude, longitude, current.version);
      onUpdated(resubmitted);
    } catch (nextError) {
      try {
        const latest = await readOwnJoiningCase();
        onUpdated(latest);
        if (latest.case.state === "submitted" && latest.case.businessName === nextBusinessName && latest.case.firstStoreName === nextStoreName && latest.case.serviceCityId === serviceCityId && latest.case.firstStoreVerticalId === verticalId && latest.case.firstStoreLatitude === latitude && latest.case.firstStoreLongitude === longitude) {
          setError("");
          return;
        }
      } catch (readError) {
        console.error("DSH Partner correction recovery read failed", readError);
      }
      if (nextError && typeof nextError === "object" && "status" in nextError && (nextError as { status?: unknown }).status === 409) {
        setError("تغيّرت الحالة أثناء التصحيح. أعد قراءة حالة الانضمام ثم حاول مجددًا.");
      } else {
        setError("تعذر حفظ التصحيح وإعادة الإرسال. تحقق من الاتصال ثم أعد المحاولة.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function chooseStoreImage() {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المتجر."); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (picked.canceled || !picked.assets[0]?.uri) return;
    try {
      const response = await fetch(picked.assets[0].uri);
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer()));
      const contentSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      setStoreImage({ contentSha256, image: { uri: picked.assets[0].uri, name: picked.assets[0].fileName ?? "store-image.jpg", type: picked.assets[0].mimeType ?? "image/jpeg", blob } });
      setError("");
    } catch (cause) {
      console.error("DSH Partner joining-case image preparation failed", cause);
      setError("تعذر تجهيز الصورة أو تجاوزت 10 ميغابايت. اختر صورة أخرى.");
    }
  }

  async function uploadStoreImage() {
    if (!storeImage || busy || current.state !== "needs_correction") return;
    if (current.storeProfileImage?.contentSha256 === storeImage.contentSha256) {
      setStoreImage(null);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${current.id}:${current.version}:${storeImage.contentSha256}`);
      const updated = await uploadOwnJoiningCaseStoreImage(current.id, storeImage.image, current.version, `partner_store_image_${identity}`, `partner_store_image_corr_${identity}`);
      onUpdated(updated);
      setStoreImage(null);
    } catch (cause) {
      console.error("DSH Partner joining-case image upload failed", cause);
      try {
        const latest = await readOwnJoiningCase();
        onUpdated(latest);
        if (latest.case.storeProfileImage?.contentSha256 === storeImage.contentSha256) {
          setStoreImage(null);
          setError("");
          return;
        }
      } catch (readError) {
        console.error("DSH Partner joining-case image readback failed", readError);
      }
      setError("تعذر تأكيد حفظ الصورة. أُعيدت قراءة الحالة؛ أعد المحاولة بالصورة نفسها لإتمام التسوية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="تصحيح حالة الانضمام">
      <Text style={styles.title}>التصحيح مطلوب قبل إعادة الإرسال</Text>
      <Text style={styles.reason}>{current.correctionReason || "طلب المشغّل تصحيح البيانات."}</Text>
      <Text style={styles.phone}>رقم الهاتف المعتمد: <Text style={styles.phoneValue}>{current.contactPhoneE164}</Text></Text>
      <View style={styles.imageBox}>
        <Text style={styles.label}>صورة المتجر</Text>
        {current.storeProfileImage ? <Image accessibilityLabel="صورة المتجر الحالية" source={{ uri: current.storeProfileImage.uri }} resizeMode="cover" style={styles.storeImage} /> : <Text style={styles.muted}>لا توجد صورة محفوظة لهذا الملف.</Text>}
        {storeImage ? <Image accessibilityLabel="معاينة الصورة الجديدة" source={{ uri: storeImage.image.uri }} resizeMode="cover" style={styles.storeImage} /> : null}
        <BthwaniButton disabled={busy} label={storeImage ? "اختيار صورة أخرى" : "اختيار صورة المتجر"} onPress={() => void chooseStoreImage()} variant="secondary" />
        {storeImage ? <BthwaniButton busy={busy} disabled={busy} label="حفظ صورة المتجر" onPress={() => void uploadStoreImage()} variant="secondary" /> : null}
      </View>
      <View style={styles.locationBox}><Text style={styles.label}>موقع المتجر الثابت</Text><Text selectable style={styles.muted}>{latitude !== null && longitude !== null ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "لم يُسجل الموقع ضمن ملف الانضمام"}</Text><Text style={styles.muted}>يُجمع الموقع مع ملف الانضمام ولا يُعدّل من شاشة إدارة المتجر.</Text></View>
      <TextInput accessibilityLabel="تصحيح اسم النشاط" editable={!busy} onChangeText={setBusinessName} value={businessName} style={styles.input} />
      <TextInput accessibilityLabel="تصحيح اسم المتجر الأول" editable={!busy} onChangeText={setFirstStoreName} value={firstStoreName} style={styles.input} />
      <Text style={styles.label}>مدينة المتجر الأول</Text>
      {cities.length === 0 ? <Text style={styles.muted}>لا توجد مدن خدمة مقروءة حاليًا. أعد قراءة بيانات الشريك.</Text> : null}
      <View style={styles.cityList}>{cities.map((city) => <BthwaniChip key={city.id} disabled={busy} label={city.displayNameAr} onPress={() => setServiceCityId(city.id)} selected={serviceCityId === city.id} />)}</View>
      <Text style={styles.label}>النشاط التجاري</Text>
      {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
      {optionsError ? <View style={styles.optionError}><Text accessibilityRole="alert" style={styles.error}>تعذر قراءة الأنشطة التجارية.</Text><BthwaniButton label="إعادة قراءة الأنشطة" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
      <View style={styles.cityList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} disabled={busy} label={vertical.nameAr} onPress={() => setVerticalId(vertical.id)} selected={verticalId === vertical.id} />)}</View>
      <View style={styles.locationBox}><Text style={styles.label}>أوضاع الطلب المثبتة عند الانضمام</Text><Text style={styles.muted}>{current.firstStoreFulfillmentModes.map(fulfillmentModeLabel).join(" · ")}</Text><Text style={styles.muted}>لا يتغير اختيار الأوضاع أثناء التصحيح أو إعادة الإرسال. بعد إنشاء المتجر يديره المشغّل من لوحة التحكم.</Text></View>
      <BthwaniButton busy={busy} disabled={optionsLoading} label="حفظ التصحيح وإعادة الإرسال" onPress={() => void correctAndResubmit()} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function fulfillmentModeLabel(mode: StoreFulfillmentMode): string {
  if (mode === "BTHWANI_CAPTAIN") return "توصيل بثواني";
  if (mode === "CUSTOMER_PICKUP") return "استلم بنفسك من المتجر";
  return "توصيل المتجر";
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.warningSoft, borderColor: theme.warning, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], marginTop: spacing[3], padding: spacing[3] },
    title: { ...typography.bodyStrong, color: theme.warning },
    reason: { ...typography.bodySm, color: theme.color },
    phone: { ...typography.label, color: theme.colorSecondary },
    phoneValue: { writingDirection: "ltr" },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    label: { ...typography.label, color: theme.color },
    cityList: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    error: { ...typography.label, color: theme.danger },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    optionError: { gap: spacing[2] },
    locationBox: { backgroundColor: theme.structureSoft, borderRadius: radius.sm, gap: spacing[1], padding: spacing[2] },
    imageBox: { backgroundColor: theme.surface, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    storeImage: { borderRadius: radius.sm, height: 180, width: "100%" },
  });
}
