import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useAppearanceTheme } from "@bthwani/design-system/native";

import { captainOfferStateLabel, type CaptainOffer } from "@bthwani/dsh";

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
      <Text style={styles.muted}>العروض الحالية تُقرأ من DSH ويمكن حسمها مرة واحدة بالنسخة الحالية.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>العروض ({offers.length})</Text> : null}
      {!loading && !offers.length ? <Text style={styles.muted}>لا توجد عروض حالية.</Text> : null}
      {!loading ? offers.map((offer) => <View key={offer.id} style={styles.card}><Text style={styles.cardTitle}>عرض توصيل</Text><Text style={styles.muted}>الحالة: {captainOfferStateLabel(offer.state)} · ينتهي: {new Date(offer.expiresAt).toLocaleString("ar-YE")}</Text>{offer.state === "offered" ? <View style={styles.row}><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void respond(offer, "accept")} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === offer.id ? "جارٍ الحفظ…" : "قبول العرض"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void respond(offer, "reject")} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>رفض العرض</Text></Pressable></View> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث العروض</Text></Pressable>
    </View>
  );
}
