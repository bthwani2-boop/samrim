import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";

import { direction, resolveRowDirection, resolveTextAlign, resolveTheme } from "@bthwani/design-system";
import { createDshMobileClient, type CreateJoiningCaseRequest, type FieldAdmission, type JoiningCaseSummary } from "@bthwani/dsh";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function client() {
  const raw = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!raw) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(raw, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

export function FieldOperations() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [admission, setAdmission] = useState<FieldAdmission | null>(null);
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [input, setInput] = useState<CreateJoiningCaseRequest>({ contactPhoneE164: "+967700000000", businessName: "", firstStoreName: "", serviceCityId: "", firstStoreVerticalId: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const api = client();
      const [admissionResponse, caseResponse] = await Promise.all([api.readOwnFieldAdmission(token), api.listOwnFieldJoiningCases(token)]);
      setAdmission(admissionResponse.admission);
      setCases(caseResponse.cases);
    } catch (cause) {
      console.error("DSH Field readback failed", cause);
      setError("تعذر قراءة قبول الميدان وملفاته. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCase() {
    if (busy) return;
    setBusy("create");
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().createFieldJoiningCase(token, input);
      await load();
    } catch (cause) {
      console.error("DSH Field joining-case creation failed", cause);
      setError("تعذر حفظ الملف. تحقق من الهاتف والأسماء ومعرفي المدينة والنشاط.");
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
    <ScrollView contentContainerStyle={styles.container} accessibilityLabel="عمليات الميدان">
      <Text style={styles.title}>عمليات الميدان</Text>
      <Text style={styles.muted}>القبول وملفات الانضمام مملوكة لـ DSH، ولا يملك الميدان نشر المتجر أو مراجعته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && admission ? <View style={styles.card}><Text style={styles.cardTitle}>قبول الميدان</Text><Text style={styles.muted}>الحالة: {admission.state} · النسخة: {admission.version}</Text></View> : null}
      {!loading && admission?.state === "eligible" ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ملف انضمام جديد</Text>
          <TextInput accessibilityLabel="هاتف صاحب النشاط" autoCapitalize="none" keyboardType="phone-pad" placeholder="هاتف صاحب النشاط (+967...)" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.contactPhoneE164} onChangeText={(value) => setInput((current) => ({ ...current, contactPhoneE164: value }))} />
          <TextInput accessibilityLabel="اسم النشاط" placeholder="اسم النشاط" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.businessName} onChangeText={(value) => setInput((current) => ({ ...current, businessName: value }))} />
          <TextInput accessibilityLabel="اسم أول متجر" placeholder="اسم أول متجر" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreName} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreName: value }))} />
          <TextInput accessibilityLabel="معرف مدينة الخدمة" autoCapitalize="none" placeholder="معرف مدينة الخدمة" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.serviceCityId} onChangeText={(value) => setInput((current) => ({ ...current, serviceCityId: value }))} />
          <TextInput accessibilityLabel="معرف النشاط التجاري" autoCapitalize="none" placeholder="معرف النشاط التجاري" placeholderTextColor={theme.colorMuted} style={styles.input} value={input.firstStoreVerticalId} onChangeText={(value) => setInput((current) => ({ ...current, firstStoreVerticalId: value }))} />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void createCase()} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === "create" ? "جارٍ الحفظ…" : "حفظ الملف"}</Text></Pressable>
        </View>
      ) : null}
      {!loading ? <Text style={styles.sectionTitle}>ملفات الانضمام ({cases.length})</Text> : null}
      {!loading && cases.length === 0 ? <Text style={styles.muted}>لا توجد ملفات من هذا الميدان.</Text> : null}
      {cases.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><Text style={styles.muted}>الحالة: {item.state} · النسخة: {item.version}</Text>{item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}{item.state === "draft" ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void submitCase(item)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === item.id ? "جارٍ الإرسال…" : "إرسال للمراجعة"}</Text></Pressable> : null}</View>)}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث الحالة</Text></Pressable>
    </ScrollView>
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
    cardTitle: { color: theme.color, fontSize: 14, fontWeight: "800", textAlign: startTextAlign },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.color, minHeight: 44, paddingHorizontal: 12, textAlign: startTextAlign },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, flexDirection: rowDirection, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    buttonText: { color: theme.onAction, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: 12 },
    secondaryButtonText: { color: theme.color, fontWeight: "700" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    error: { color: theme.danger, fontSize: 13, textAlign: startTextAlign },
  });
}
