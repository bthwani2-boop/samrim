import { BthwaniButton, BthwaniChip, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CommerceVertical, type CorrectJoiningCaseRequest, type JoiningCaseSummary, joiningCaseStateLabel, type ServiceCity } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldCases() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editingCase, setEditingCase] = useState<JoiningCaseSummary | null>(null);
  const [correctionInput, setCorrectionInput] = useState<CorrectJoiningCaseRequest | null>(null);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await fieldClient().listOwnFieldJoiningCases(token);
      setCases(response.cases);
    } catch (cause) {
      console.error("DSH Field cases readback failed", cause);
      setError("تعذر قراءة ملفات الانضمام. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitCase(item: JoiningCaseSummary) {
    if (busy || item.state !== "draft") return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await fieldClient().submitFieldJoiningCase(token, item.id, item.version);
      await load();
    } catch (cause) {
      console.error("DSH Field joining-case submission failed", cause);
      setError("تعذر إرسال الملف للمراجعة. أعد القراءة فقد تكون النسخة تغيّرت.");
    } finally {
      setBusy("");
    }
  }

  async function beginCorrection(item: JoiningCaseSummary) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const [detail, nextCities, nextVerticals] = await Promise.all([
        fieldClient().readOwnFieldJoiningCase(token, item.id),
        fieldClient().listActiveServiceCities(),
        fieldClient().listCatalogVerticals(),
      ]);
      if (!detail.case.serviceCityId || !detail.case.firstStoreVerticalId || detail.case.firstStoreLatitude === null || detail.case.firstStoreLongitude === null) throw new Error("FIELD_JOINING_CASE_ORIGIN_INCOMPLETE");
      setCities(nextCities);
      setVerticals(nextVerticals);
      setEditingCase(item);
      setCorrectionInput({ businessName: detail.case.businessName, firstStoreName: detail.case.firstStoreName, serviceCityId: detail.case.serviceCityId, firstStoreVerticalId: detail.case.firstStoreVerticalId, firstStoreLatitude: detail.case.firstStoreLatitude, firstStoreLongitude: detail.case.firstStoreLongitude });
    } catch (cause) {
      console.error("DSH Field joining-case correction read failed", cause);
      setError("تعذر فتح ملف التصحيح. أعد القراءة ثم حاول مرة أخرى.");
    } finally {
      setBusy("");
    }
  }

  async function correctAndResubmit() {
    if (!editingCase || !correctionInput || busy) return;
    setBusy(editingCase.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await fieldClient().correctAndResubmitFieldJoiningCase(token, editingCase.id, correctionInput, editingCase.version);
      setEditingCase(null);
      setCorrectionInput(null);
      await load();
    } catch (cause) {
      console.error("DSH Field joining-case correction failed", cause);
      setError("تعذر تصحيح الملف وإعادة إرساله. أعد القراءة فقد تكون النسخة تغيّرت.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="ملفات الانضمام">
      <Text style={styles.title}>ملفات الانضمام</Text>
      <Text style={styles.muted}>تابع حالة كل ملف، وعالج التصحيح المطلوب، ثم أرسله للمراجعة عندما يكتمل.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>الملفات ({cases.length})</Text> : null}
      {!loading && cases.length === 0 ? <Text style={styles.muted}>لا توجد ملفات من هذا الميدان.</Text> : null}
      {!loading ? cases.map((item) => <View key={item.id} style={styles.card}><View style={styles.orderHeader}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><BthwaniStatusBadge icon={item.state === "draft" ? "edit" : item.state === "needs_correction" ? "warning" : "cases"} label={joiningCaseStateLabel(item.state)} tone={item.state === "draft" ? "info" : item.state === "needs_correction" ? "warning" : "neutral"} /></View>{item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}<Text style={styles.muted}>{item.state === "draft" ? "الخطوة التالية: راجع البيانات ثم أرسل الملف." : item.state === "needs_correction" ? "الخطوة التالية: صحّح البيانات المطلوبة ثم أعد الإرسال." : "تم اعتماد الشريك؛ انتهى دور تطبيق الميداني بعد اعتماد المتجر، ويظهر المتجر في تطبيق العميل عند نشره."}</Text>{item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label="إرسال للمراجعة" onPress={() => void submitCase(item)} /> : null}{item.state === "needs_correction" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label="فتح التصحيح" onPress={() => void beginCorrection(item)} variant="secondary" /> : null}</View>) : null}
      {editingCase && correctionInput ? <View style={styles.card} accessibilityLabel="تصحيح ملف الانضمام"><Text style={styles.cardTitle}>تصحيح ملف {editingCase.firstStoreName}</Text><Text style={styles.label}>اسم النشاط</Text><TextInput accessibilityLabel="اسم النشاط للتصحيح" placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={correctionInput.businessName} onChangeText={(value) => setCorrectionInput((current) => current ? { ...current, businessName: value } : current)} /><Text style={styles.label}>اسم المتجر</Text><TextInput accessibilityLabel="اسم المتجر للتصحيح" placeholder="اسم المتجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={correctionInput.firstStoreName} onChangeText={(value) => setCorrectionInput((current) => current ? { ...current, firstStoreName: value } : current)} /><Text style={styles.label}>مدينة الخدمة</Text><View style={styles.optionList}>{cities.map((city) => <BthwaniChip key={city.id} label={city.displayNameAr} onPress={() => setCorrectionInput((current) => current ? { ...current, serviceCityId: city.id } : current)} selected={correctionInput.serviceCityId === city.id} />)}</View><Text style={styles.label}>النشاط التجاري</Text><View style={styles.optionList}>{verticals.map((vertical) => <BthwaniChip key={vertical.id} label={vertical.nameAr} onPress={() => setCorrectionInput((current) => current ? { ...current, firstStoreVerticalId: vertical.id } : current)} selected={correctionInput.firstStoreVerticalId === vertical.id} />)}</View><Text style={styles.label}>إحداثيات المتجر الثابتة</Text><TextInput accessibilityLabel="خط عرض التصحيح" keyboardType="numbers-and-punctuation" placeholder="خط العرض" placeholderTextColor={theme.colorMuted} style={styles.input} value={String(correctionInput.firstStoreLatitude)} onChangeText={(value) => setCorrectionInput((current) => current ? { ...current, firstStoreLatitude: Number(value) } : current)} /><TextInput accessibilityLabel="خط طول التصحيح" keyboardType="numbers-and-punctuation" placeholder="خط الطول" placeholderTextColor={theme.colorMuted} style={styles.input} value={String(correctionInput.firstStoreLongitude)} onChangeText={(value) => setCorrectionInput((current) => current ? { ...current, firstStoreLongitude: Number(value) } : current)} /><BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="حفظ التصحيح وإعادة الإرسال" onPress={() => void correctAndResubmit()} /><BthwaniButton disabled={Boolean(busy)} label="إلغاء" onPress={() => { setEditingCase(null); setCorrectionInput(null); }} variant="secondary" /></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث الملفات" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
