import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CashLiabilityItem, formatMoney } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "../captain-operations/captain-client";
import { createCaptainOperationStyles } from "../captain-operations/captain-operation-styles";
import { isCurrentCaptainActor } from "../captain-operations/captain-session-scope";

// Cash custody belongs to Finance after delivery, never to a customer map/chat.
export function CaptainCashLiabilityPanel() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [liability, setLiability] = useState<{ items: ReadonlyArray<CashLiabilityItem>; totalAmountMinor: number } | null>(null);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const before = currentIdentityState();
    if (before.kind !== "authenticated") { setLiability(null); return; }
    const actorID = before.identity.subject.trim();
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await captainClient().readOwnCaptainCashLiability(token);
      const after = currentIdentityState();
      if (after.kind === "authenticated" && isCurrentCaptainActor(actorID, after.identity.subject.trim())) {
        setLiability(result);
        setError("");
      }
    } catch {
      setError("تعذرت قراءة العهدة النقدية من المالية.");
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
    return () => setLiability(null);
  }, [load]));

  async function remit(item: CashLiabilityItem) {
    const before = currentIdentityState();
    const reference = (references[item.paymentIntentId] ?? item.remittanceReference ?? "").trim();
    if (before.kind !== "authenticated" || busy || !reference ||
      !liability?.items.some((row) => row.paymentIntentId === item.paymentIntentId && row.paymentVersion === item.paymentVersion)) return;
    const actorID = before.identity.subject.trim();
    setBusy(item.paymentIntentId);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const after = currentIdentityState();
      if (after.kind !== "authenticated" || !isCurrentCaptainActor(actorID, after.identity.subject.trim())) return;
      await captainClient().remitOwnCaptainCash(token, item.paymentIntentId, {
        amountMinor: item.amountMinor, remittanceReference: reference,
      }, item.paymentVersion);
      await load();
    } catch {
      setError("لم يتأكد توريد النقد. أعد قراءة العهدة قبل إعادة الإرسال.");
    } finally {
      setBusy("");
    }
  }

  if (!liability?.items.length && !error) return null;

  return <View style={styles.summaryCard} accessibilityLabel="عهدة الكابتن المالية">
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={styles.cardTitle}>العهدة النقدية</Text>
      {liability ? <Text style={styles.warning}>{formatMoney(liability.totalAmountMinor, "YER")}</Text> : null}
    </View>
    {liability?.items.length ? <Pressable accessibilityRole="button"
      accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
      <Text style={styles.muted}>{expanded ? "إخفاء التفاصيل −" : "تفاصيل التوريد +"}</Text>
    </Pressable> : null}
    {expanded ? liability?.items.map((item) => {
      const reference = references[item.paymentIntentId] ?? item.remittanceReference ?? "";
      return <View key={item.paymentIntentId} style={styles.task}>
        <Text style={styles.muted}>مستحق توريد: {formatMoney(item.amountMinor, item.currency)}</Text>
        {item.remittanceState === "SUBMITTED" ? <Text style={styles.muted}>بانتظار مطابقة الإيصال.</Text> : null}
        <TextInput accessibilityLabel="مرجع توريد العهدة" value={reference}
          onChangeText={(value) => setReferences((current) => ({ ...current, [item.paymentIntentId]: value }))}
          placeholder="مرجع التوريد" style={styles.input} />
        <BthwaniButton label="إرسال المرجع للمالية" busy={busy === item.paymentIntentId}
          disabled={Boolean(busy) || !reference.trim()} onPress={() => void remit(item)} />
      </View>;
    }) : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {expanded || error ? <BthwaniButton label="تحديث العهدة" disabled={Boolean(busy)}
      variant="secondary" onPress={() => void load()} /> : null}
  </View>;
}
