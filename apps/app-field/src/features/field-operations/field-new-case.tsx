import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { type CommerceVertical, type CreateJoiningCaseRequest, type FieldAdmission, type ServiceCity } from "@bthwani/dsh";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldNewCase() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "" });
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
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

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    void Promise.all([fieldClient().listActiveServiceCities(), fieldClient().listCatalogVerticals()]).then(
      ([nextCities, nextVerticals]) => {
        if (!active) return;
        setCities(nextCities);
        setVerticals(nextVerticals);
      },
      (cause) => {
        console.error("DSH Field canonical options read failed", cause);
        if (active) setError("تعذر قراءة المدن والأنشطة المتاحة. أعد المحاولة.");
      },
    ).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => { active = false; };
  }, []);

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
      await fieldClient().createFieldJoiningCase(token, input);
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
        <TextInput accessibilityLabel="هاتف صاحب النشاط" autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: ‎+967…" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
        <Text style={styles.label}>اسم النشاط</Text>
        <TextInput accessibilityLabel="اسم النشاط" placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
        <Text style={styles.label}>اسم أول متجر</Text>
        <TextInput accessibilityLabel="اسم أول متجر" placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
        <Text style={styles.label}>مدينة الخدمة</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
        {!optionsLoading && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
        <View style={styles.optionList}>{cities.map((city) => { const selected = input.serviceCityId === city.id; return <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => setInput((current) => ({ ...current, serviceCityId: city.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{city.displayNameAr}</Text></Pressable>; })}</View>
        <Text style={styles.label}>النشاط التجاري</Text>
        {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
        {!optionsLoading && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
        <View style={styles.optionList}>{verticals.map((vertical) => { const selected = input.firstStoreVerticalId === vertical.id; return <Pressable key={vertical.id} accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy} onPress={() => setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{vertical.nameAr}</Text></Pressable>; })}</View>
        <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || optionsLoading }} disabled={busy || optionsLoading} onPress={() => void createCase()} style={[styles.button, (busy || optionsLoading) && styles.disabledButton]}><Text style={styles.buttonText}>{busy ? "جارٍ الحفظ…" : "حفظ الملف"}</Text></Pressable>
      </View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void loadAdmission()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الأهلية</Text></Pressable>
    </View>
  );
}
