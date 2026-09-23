import { BthwaniButton, BthwaniChip, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CommerceVertical, type CreateJoiningCaseRequest, type DshImageUploadInput, type FieldAdmission, type JoiningCaseResponse, joiningCaseStateLabel, type ServiceCity } from "@bthwani/dsh";
import * as ImagePicker from "expo-image-picker";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldNewCase() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "", firstStoreLatitude: 0, firstStoreLongitude: 0, firstStoreFulfillmentModes: [] });
  const [storeLatitude, setStoreLatitude] = useState("");
  const [storeLongitude, setStoreLongitude] = useState("");
  const [createdCase, setCreatedCase] = useState<JoiningCaseResponse | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeImage, setStoreImage] = useState<DshImageUploadInput | null>(null);

  const loadAdmission = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().readOwnFieldAdmission(token);
      setAdmission(response.admission);
    } catch (cause) {
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
    if (busy) return;
    const latitude = Number(storeLatitude.trim());
    const longitude = Number(storeLongitude.trim());
    if (!input.contactPhoneE164.trim() || !input.businessName.trim() || !input.firstStoreName.trim() || !input.serviceCityId || !input.firstStoreVerticalId || input.firstStoreFulfillmentModes.length === 0 || !storeImage || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
		setError("أكمل بيانات المتجر واختر وضعًا واحدًا على الأقل، ثم اختر صورة المتجر.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().createFieldJoiningCase(token, { ...input, firstStoreLatitude: latitude, firstStoreLongitude: longitude });
      setCreatedCase(response);
      if (storeImage) {
        try {
          const uploaded = await fieldClient().uploadFieldJoiningCaseStoreImage(token, response.case.id, storeImage, response.case.version);
          setCreatedCase(uploaded);
          setStoreImage(null);
        } catch (uploadError) {
          console.error("DSH Field store image upload failed", uploadError);
          setError("تم حفظ الملف، لكن تعذر رفع صورة المتجر. أعد المحاولة من بطاقة الملف.");
        }
      }
      setStoreLatitude("");
      setStoreLongitude("");
      setInput({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "", firstStoreLatitude: 0, firstStoreLongitude: 0, firstStoreFulfillmentModes: [] });
      await loadAdmission();
    } catch (cause) {
      console.error("DSH Field joining-case creation failed", cause);
      setError("تعذر حفظ الملف. تحقق من الهاتف والأسماء والاختيارات ثم أعد المحاولة.");
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
    if (busy) return;
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
      const token = await getUsableIdentityAccessToken();
      const uploaded = await fieldClient().uploadFieldJoiningCaseStoreImage(token, createdCase.case.id, storeImage, createdCase.case.version);
      setCreatedCase(uploaded);
      setStoreImage(null);
    } catch (cause) {
      console.error("DSH Field store image retry failed", cause);
      setError("تعذر رفع صورة المتجر. أعد المحاولة بعد التحقق من الاتصال.");
    } finally {
      setBusy(false);
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
        <TextInput accessibilityLabel="هاتف صاحب النشاط" autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: ‎+967…" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
        <Text style={styles.label}>اسم النشاط</Text>
        <TextInput accessibilityLabel="اسم النشاط" placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
        <Text style={styles.label}>اسم أول متجر</Text>
        <TextInput accessibilityLabel="اسم أول متجر" placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
        <Text style={styles.label}>مدينة الخدمة</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
        {optionsError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text><BthwaniButton label="إعادة قراءة الخيارات" onPress={() => void loadOptions()} variant="secondary" /></View> : null}
        {!optionsLoading && !optionsError && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => <BthwaniChip key={city.id} label={city.displayNameAr} onPress={() => setInput((current) => ({ ...current, serviceCityId: city.id }))} selected={input.serviceCityId === city.id} />)}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && !optionsError && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id }))} selected={input.firstStoreVerticalId === vertical.id} />)}</View>
        <Text style={styles.label}>أوضاع الطلب التي اختارها الشريك عند الانضمام</Text>
        <Text style={styles.muted}>سجّل الأوضاع المتاحة في المتجر لأول مرة. بعد إنشاء المتجر لا يغيّرها الشريك من التطبيق؛ يديرها المشغّل من لوحة التحكم.</Text>
        <View style={styles.optionList}>
          <BthwaniChip label="توصيل بثواني · مسؤولية المنصة" onPress={() => toggleFulfillmentMode("BTHWANI_CAPTAIN")} selected={input.firstStoreFulfillmentModes.includes("BTHWANI_CAPTAIN")} />
          <BthwaniChip label="توصيل المتجر · كابتن المتجر" onPress={() => toggleFulfillmentMode("PARTNER_CAPTAIN")} selected={input.firstStoreFulfillmentModes.includes("PARTNER_CAPTAIN")} />
          <BthwaniChip label="استلم بنفسك من المتجر" onPress={() => toggleFulfillmentMode("CUSTOMER_PICKUP")} selected={input.firstStoreFulfillmentModes.includes("CUSTOMER_PICKUP")} />
        </View>
        <Text style={styles.label}>موقع المتجر الثابت</Text>
        <Text style={styles.muted}>أدخل إحداثيات موقع المتجر مع ملف الانضمام؛ تنتقل إلى المتجر عند الاعتماد ولا تُعدّل من شاشة إدارة المتجر.</Text>
        <TextInput accessibilityLabel="خط عرض موقع المتجر" keyboardType="numbers-and-punctuation" placeholder="خط العرض، مثال: 15.369445" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={storeLatitude} onChangeText={setStoreLatitude} />
        <TextInput accessibilityLabel="خط طول موقع المتجر" keyboardType="numbers-and-punctuation" placeholder="خط الطول، مثال: 44.191006" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.phoneInput]} value={storeLongitude} onChangeText={setStoreLongitude} />
        <Text style={styles.label}>صورة المتجر</Text>
        <Text style={styles.muted}>أضف صورة واضحة للواجهة أو الهوية البصرية؛ تحفظ مركزيًا وتظهر بعد اعتماد المتجر.</Text>
        {storeImage ? <Image accessibilityLabel="معاينة صورة المتجر" source={{ uri: storeImage.uri }} style={{ borderRadius: 12, height: 160, width: "100%" }} resizeMode="cover" /> : null}
        <BthwaniButton disabled={busy} label={storeImage ? "تغيير صورة المتجر" : "اختيار صورة المتجر"} onPress={() => void pickStoreImage()} variant="secondary" />
        <BthwaniButton busy={busy} disabled={optionsLoading || Boolean(optionsError)} label="حفظ الملف" onPress={() => void createCase()} />
      </View> : null}
      {createdCase ? <View accessibilityLiveRegion="polite" style={styles.successCard}>
        <Text style={styles.cardTitle}>تم حفظ ملف الانضمام</Text>
        <Text style={styles.muted}>{createdCase.case.businessName} · {createdCase.case.firstStoreName}</Text>
        <Text style={styles.successText}>الحالة: {joiningCaseStateLabel(createdCase.case.state)}</Text>
        {storeImage ? <BthwaniButton busy={busy} disabled={busy} label="إعادة رفع صورة المتجر" onPress={() => void retryStoreImage()} variant="secondary" /> : null}
        <Link href={"/cases" as Href} asChild><BthwaniButton label="فتح ملفات الانضمام" variant="secondary" /></Link>
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={busy} disabled={busy} label="تحديث الأهلية" onPress={() => void loadAdmission()} variant="secondary" />
    </View>
  );
}
