import * as Crypto from "expo-crypto";
import { Link, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, fieldAdmissionStateLabel, joiningCaseStateLabel, type CommerceVertical, type CreateJoiningCaseRequest, type FieldAdmission, type JoiningCaseSummary, type ServiceCity } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const raw = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!raw) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(raw, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export type FieldSurface = "overview" | "cases" | "new-case";

export function FieldOperations({ surface = "overview" }: { surface?: FieldSurface }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "" });
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [verticals, setVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const api = client();
      if (surface === "overview" || surface === "new-case") {
        const admissionResponse = await api.readOwnFieldAdmission(token);
        setAdmission(admissionResponse.admission);
      } else {
        const caseResponse = await api.listOwnFieldJoiningCases(token);
        setCases(caseResponse.cases);
      }
    } catch (cause) {
      console.error("DSH Field readback failed", cause);
      setError("تعذر قراءة قبول الميدان وملفاته. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, [surface]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (surface !== "new-case") {
      setOptionsLoading(false);
      return;
    }
    let active = true;
    setOptionsLoading(true);
    void Promise.all([client().listActiveServiceCities(), client().listCatalogVerticals()]).then(
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
  }, [surface]);

  async function createCase() {
    if (busy || !input.contactPhoneE164.trim() || !input.businessName.trim() || !input.firstStoreName.trim() || !input.serviceCityId || !input.firstStoreVerticalId) {
      setError("أكمل الهاتف والأسماء واختر مدينة الخدمة والنشاط التجاري.");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().createFieldJoiningCase(token, input);
      await load();
    } catch (cause) {
      console.error("DSH Field joining-case creation failed", cause);
      setError("تعذر حفظ الملف. تحقق من الهاتف والأسماء والاختيارات ثم أعد المحاولة.");
    } finally {
      setBusy("");
    }
  }

  async function submitCase(item: JoiningCaseSummary) {
    if (busy || item.state !== "draft") return;
    setBusy(item.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().submitFieldJoiningCase(token, item.id, item.version);
      await load();
    } catch (cause) {
      console.error("DSH Field joining-case submission failed", cause);
      setError("تعذر إرسال الملف للمراجعة. أعد القراءة فقد تكون النسخة تغيّرت.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="عمليات الميدان">
      <Text style={styles.title}>عمليات الميدان</Text>
      <Text style={styles.muted}>القبول وملفات الانضمام مملوكة لـ DSH، ولا يملك الميدان نشر المتجر أو مراجعته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {surface === "overview" && !loading && admission ? <View style={styles.card}><Text style={styles.cardTitle}>قبول الميدان</Text><Text style={styles.muted}>الحالة: {fieldAdmissionStateLabel(admission.state)}</Text></View> : null}
      {surface === "overview" && !loading && !admission ? <View style={styles.card} accessibilityLiveRegion="polite"><Text style={styles.cardTitle}>لا توجد أهلية تشغيلية</Text><Text style={styles.muted}>لم تصل أهلية الميدان من DSH. أعد المحاولة أو تواصل مع المشغل.</Text></View> : null}
      {surface === "overview" && !loading && admission?.state === "eligible" ? <View style={styles.summaryCard}><Text style={styles.muted}>يمكنك فتح ملف انضمام جديد من المسار المخصص.</Text><Link href={"/new-case" as Href} asChild><Pressable accessibilityRole="button" style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>فتح ملف جديد</Text></Pressable></Link></View> : null}
      {surface === "new-case" && !loading && admission?.state === "eligible" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ملف انضمام جديد</Text>
          <Text style={styles.label}>هاتف صاحب النشاط</Text>
          <TextInput accessibilityLabel="هاتف صاحب النشاط" autoCapitalize="none" keyboardType="phone-pad" placeholder="مثال: ‎+967…" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
          <Text style={styles.label}>اسم النشاط</Text>
          <TextInput accessibilityLabel="اسم النشاط" placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
          <Text style={styles.label}>اسم أول متجر</Text>
          <TextInput accessibilityLabel="اسم أول متجر" placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
          <Text style={styles.label}>مدينة الخدمة</Text>
          {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة المدن المتاحة…</Text> : null}
          {!optionsLoading && cities.length === 0 ? <Text style={styles.error}>لا توجد مدينة خدمة متاحة حاليًا.</Text> : null}
          <View style={styles.optionList}>{cities.map((city) => { const selected = input.serviceCityId === city.id; return <Pressable key={city.id} accessibilityRole="button" accessibilityState={{ selected, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => setInput((current) => ({ ...current, serviceCityId: city.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{city.displayNameAr}</Text></Pressable>; })}</View>
          <Text style={styles.label}>النشاط التجاري</Text>
          {optionsLoading ? <Text style={styles.muted}>جارٍ قراءة الأنشطة المتاحة…</Text> : null}
          {!optionsLoading && verticals.length === 0 ? <Text style={styles.error}>لا يوجد نشاط تجاري متاح حاليًا.</Text> : null}
          <View style={styles.optionList}>{verticals.map((vertical) => { const selected = input.firstStoreVerticalId === vertical.id; return <Pressable key={vertical.id} accessibilityRole="button" accessibilityState={{ selected, disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => setInput((current) => ({ ...current, firstStoreVerticalId: vertical.id }))} style={[styles.optionButton, selected && styles.optionButtonSelected]}><Text style={styles.optionText}>{vertical.nameAr}</Text></Pressable>; })}</View>
          <Pressable accessibilityRole="button" accessibilityState={{ busy: busy === "create", disabled: Boolean(busy) || optionsLoading }} disabled={Boolean(busy) || optionsLoading} onPress={() => void createCase()} style={[styles.button, (busy || optionsLoading) && styles.disabledButton]}><Text style={styles.buttonText}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ الملف"}</Text></Pressable>
        </View>
      ) : null}
      {surface === "cases" && !loading ? <Text style={styles.sectionTitle}>ملفات الانضمام ({cases.length})</Text> : null}
      {surface === "cases" && !loading && cases.length === 0 ? <Text style={styles.muted}>لا توجد ملفات من هذا الميدان.</Text> : null}
      {surface === "cases" ? cases.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><Text style={styles.muted}>الحالة: {joiningCaseStateLabel(item.state)}</Text>{item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}{item.state === "draft" ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void submitCase(item)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === item.id ? "جارٍ الإرسال…" : "إرسال للمراجعة"}</Text></Pressable> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الحالة</Text></Pressable>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const rowDirection = resolveRowDirection(activeDirection);
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 14, borderWidth: 1, gap: 10, marginTop: 16, padding: 14, width: "100%", direction: activeDirection },
    title: { color: theme.color, fontSize: 18, fontWeight: "800", textAlign: startTextAlign },
    sectionTitle: { color: theme.color, fontSize: 15, fontWeight: "800", marginTop: 6, textAlign: startTextAlign },
    muted: { color: theme.colorMuted, fontSize: 13, lineHeight: 19, textAlign: startTextAlign },
    state: { alignItems: "center", gap: 8, paddingVertical: 8 },
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 7, padding: 10 },
    summaryCard: { backgroundColor: theme.actionSoft, borderRadius: 8, gap: 7, padding: 10 },
    cardTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    label: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 12, textAlign: startTextAlign },
    optionList: { flexDirection: rowDirection, flexWrap: "wrap", gap: 8 },
    optionButton: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    optionButtonSelected: { backgroundColor: theme.actionSoft, borderColor: theme.actionBackground },
    optionText: { color: theme.color, fontSize: 13, fontWeight: "700", textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, flexDirection: rowDirection, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
