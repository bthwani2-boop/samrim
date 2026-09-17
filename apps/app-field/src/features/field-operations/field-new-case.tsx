import { Link, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";

import { resolveTextInputAlign, resolveTheme } from "@bthwani/design-system";
import { joiningCaseStateLabel, type CommerceVertical, type CreateJoiningCaseRequest, type FieldAdmission, type JoiningCaseResponse, type ServiceCity } from "@bthwani/dsh";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldNewCase() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "" });
  const [createdCase, setCreatedCase] = useState<JoiningCaseResponse | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    if (!input.contactPhoneE164.trim() || !input.businessName.trim() || !input.firstStoreName.trim() || !input.serviceCityId || !input.firstStoreVerticalId) {
      setError("أكمل الهاتف والأسماء واختر مدينة الخدمة والنشاط التجاري.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().createFieldJoiningCase(token, input);
      setCreatedCase(response);
      setInput({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "" });
      await loadAdmission();
    } catch (cause) {
      console.error("DSH Field joining-case creation failed", cause);
      setError("تعذر حفظ الملف. تحقق من الهاتف والأسماء والاختيارات ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="ملف انضمام جديد">
      <Text style={styles.title}>ملف انضمام جديد</Text>
      <Text style={styles.muted}>يُنشئ الميدان الملف في DSH فقط؛ المراجعة والنشر مسؤولية المسارات المختصة.</Text>
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
        {optionsError ? <View style={styles.optionsError}><Text accessibilityRole="alert" style={styles.error}>{optionsError}</Text><Pressable accessibilityRole="button" onPress={() => void loadOptions()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة قراءة الخيارات</Text></Pressable></View> : null}
        {!optionsLoading && !optionsError && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => { const selected = input.serviceCityId === city.id; return <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => setInput((current) => ({ ...current, serviceCityId: city.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{city.displayNameAr}</Text></Pressable>; })}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && !optionsError && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => { const selected = input.firstStoreVerticalId === vertical.id; return <Pressable key={vertical.id} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{vertical.nameAr}</Text></Pressable>; })}</View>
        <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || optionsLoading || Boolean(optionsError) }} disabled={busy || optionsLoading || Boolean(optionsError)} onPress={() => void createCase()} style={[styles.button, (busy || optionsLoading || Boolean(optionsError)) && styles.disabledButton]}><Text style={styles.buttonText}>{busy ? "جارٍ الحفظ…" : "حفظ الملف"}</Text></Pressable>
      </View> : null}
      {createdCase ? <View accessibilityLiveRegion="polite" style={styles.successCard}>
        <Text style={styles.cardTitle}>تم حفظ ملف الانضمام</Text>
        <Text style={styles.muted}>{createdCase.case.businessName} · {createdCase.case.firstStoreName}</Text>
        <Text style={styles.successText}>الحالة: {joiningCaseStateLabel(createdCase.case.state)}</Text>
        <Link href={"/cases" as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح ملفات الانضمام</Text></Pressable></Link>
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void loadAdmission()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الأهلية</Text></Pressable>
    </View>
  );
}
