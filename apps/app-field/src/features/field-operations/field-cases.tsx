import { BthwaniButton, BthwaniSearchField, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseSummary, joiningCaseStateLabel } from "@bthwani/dsh";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, type TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { fieldClient } from "./field-client";
import { createFieldOperationStyles } from "./field-operation-styles";

export function FieldCases() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createFieldOperationStyles(theme), [theme]);
  const { focus } = useLocalSearchParams<{ focus?: string | string[] }>();
  const searchInputRef = useRef<TextInput>(null);
  const [cases, setCases] = useState<ReadonlyArray<JoiningCaseSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

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
  useEffect(() => { if (focus !== "search") return; const timer = setTimeout(() => searchInputRef.current?.focus(), 80); return () => clearTimeout(timer); }, [focus]);

  const filteredCases = useMemo(() => { const query = searchQuery.trim().toLocaleLowerCase(); if (!query) return cases; return cases.filter((item) => [item.id, item.businessName, item.firstStoreName, item.contactPhoneE164].join(" ").toLocaleLowerCase().includes(query)); }, [cases, searchQuery]);

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

  return (
    <View style={styles.container} accessibilityLabel="ملفات الانضمام">
      <Text style={styles.title}>ملفات الانضمام</Text>
      <Text style={styles.muted}>تابع حالة ملفات الانضمام وأرسل الملف للمراجعة عندما تكتمل بياناته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      <BthwaniSearchField accessibilityLabel="البحث في ملفات الانضمام" editable={!loading && !busy} inputRef={searchInputRef} onChangeText={setSearchQuery} onClear={() => setSearchQuery("")} placeholder="ابحث باسم النشاط أو المتجر أو الهاتف" value={searchQuery} />
      {!loading ? <Text style={styles.sectionTitle}>الملفات ({filteredCases.length})</Text> : null}
      {!loading && !filteredCases.length ? <Text style={styles.muted}>{cases.length ? "لا توجد ملفات مطابقة للبحث." : "لا توجد ملفات من هذا الميدان."}</Text> : null}
      {!loading ? filteredCases.map((item) => <View key={item.id} style={styles.card}><View style={styles.orderHeader}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><BthwaniStatusBadge icon={item.state === "draft" ? "edit" : item.state === "needs_correction" ? "warning" : "cases"} label={joiningCaseStateLabel(item.state)} tone={item.state === "draft" ? "info" : item.state === "needs_correction" ? "warning" : "neutral"} /></View>{item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}<Text style={styles.muted}>{item.state === "draft" ? "الخطوة التالية: راجع البيانات ثم أرسل الملف." : item.state === "needs_correction" ? "الخطوة التالية: افتح تطبيق الشريك المرتبط لتصحيح البيانات وإعادة الإرسال." : "تم اعتماد الشريك؛ انتهى دور تطبيق الميداني بعد اعتماد المتجر، ويظهر المتجر في تطبيق العميل عند نشره."}</Text>{item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label="إرسال للمراجعة" onPress={() => void submitCase(item)} /> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث الملفات" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
