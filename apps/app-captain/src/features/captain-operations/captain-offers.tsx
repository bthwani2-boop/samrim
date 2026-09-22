import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainOffer, captainOfferStateLabel, formatMoney, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";

export function CaptainOffers() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [offers, setOffers] = useState<ReadonlyArray<CaptainOffer>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().listOwnCaptainOffers(token);
      setOffers(response.offers);
    } catch (cause) {
      console.error("DSH Captain offers readback failed", cause);
      setError("تعذر قراءة عروض التوصيل. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function respond(offer: CaptainOffer, decision: "accept" | "reject") {
    if (busy) return;
    setBusy(offer.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().respondToCaptainOffer(token, offer.id, { decision }, offer.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain offer response failed", cause);
      setError("تعذر الرد على العرض. أعد القراءة فقد يكون منتهيًا أو سبق حسمه.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="عروض التوصيل">
      <Text style={styles.title}>عروض التوصيل</Text>
      <Text style={styles.muted}>راجع العرض، ثم احسمه مرة واحدة قبل انتهاء صلاحيته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>العروض ({offers.length})</Text> : null}
      {!loading && !offers.length ? <Text style={styles.muted}>لا توجد عروض حالية.</Text> : null}
      {!loading ? offers.map((offer) => <View key={offer.id} style={styles.card}><View style={styles.orderHeader}><Text style={styles.cardTitle}>عرض توصيل</Text><BthwaniStatusBadge icon={offer.state === "offered" ? "deliveries" : "orders"} label={captainOfferStateLabel(offer.state)} tone={offer.state === "offered" ? "info" : "neutral"} /></View><Text style={styles.muted}>الطلب: <Text style={styles.orderReference}>{offer.orderId}</Text></Text><Text style={styles.muted}>المتجر: {offer.storeName}</Text><Text style={styles.muted}>عنوان العميل: {offer.customerAddressText}</Text><Text style={styles.payment}>{formatMoney(offer.amountDueMinor, offer.currency)} · {paymentMethodLabel(offer.paymentMethod)} · {paymentStateLabel(offer.paymentState)}</Text><Text style={styles.muted}>ينتهي في {new Date(offer.expiresAt).toLocaleString("ar-YE")}</Text>{offer.state === "offered" ? <View style={styles.row}><BthwaniButton busy={busy === offer.id} disabled={Boolean(busy)} label="قبول العرض" onPress={() => void respond(offer, "accept")} style={styles.actionButton} /><BthwaniButton disabled={Boolean(busy)} label="رفض العرض" onPress={() => void respond(offer, "reject")} style={styles.actionButton} variant="danger" /></View> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث العروض" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
