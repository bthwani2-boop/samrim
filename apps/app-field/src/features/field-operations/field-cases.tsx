import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type JoiningCaseSummary, joiningCaseStateLabel } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

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

  return (
    <View style={styles.container} accessibilityLabel="ملفات الانضمام">
      <Text style={styles.title}>ملفات الانضمام</Text>
      <Text style={styles.muted}>الملفات الحالية مملوكة لـ DSH ولا تُعدّل إلا بالنسخة المقروءة.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>الملفات ({cases.length})</Text> : null}
      {!loading && cases.length === 0 ? <Text style={styles.muted}>لا توجد ملفات من هذا الميدان.</Text> : null}
      {!loading ? cases.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.businessName} · {item.firstStoreName}</Text><Text style={styles.muted}>الحالة: {joiningCaseStateLabel(item.state)}</Text>{item.correctionReason ? <Text style={styles.error}>التصحيح المطلوب: {item.correctionReason}</Text> : null}{item.state === "draft" ? <BthwaniButton busy={busy === item.id} disabled={Boolean(busy)} label="إرسال للمراجعة" onPress={() => void submitCase(item)} /> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث الملفات" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
