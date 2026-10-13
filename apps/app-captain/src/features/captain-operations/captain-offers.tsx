import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainOffer, captainOfferStateLabel, formatMoney, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { isCurrentCaptainActor } from "./captain-session-scope";

export function CaptainOffers() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const { q: rawQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const [offers, setOffers] = useState<ReadonlyArray<CaptainOffer>>([]);
  const [loadedActorID, setLoadedActorID] = useState("");
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const readSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const session = currentIdentityState();
    const actorID = session.kind === "authenticated" ? session.identity.subject.trim() : "";
    setLoading(true);
    setOffers([]);
    setLoadedActorID("");
    setError("");
    if (!actorID) {
      setLoading(false);
      setError("سجّل الدخول لقراءة عروض الكابتن.");
      return false;
    }
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().listOwnCaptainOffers(token);
      const current = currentIdentityState();
      if (sequence !== readSequence.current || current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return false;
      setOffers(response.offers);
      setLoadedActorID(actorID);
      return true;
    } catch (cause) {
      console.error("DSH Captain offers readback failed", cause);
      const current = currentIdentityState();
      if (sequence === readSequence.current && current.kind === "authenticated" && isCurrentCaptainActor(actorID, current.identity.subject.trim())) setError("تعذر قراءة عروض التوصيل. أعد المحاولة.");
      return false;
    } finally {
      if (sequence === readSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    if (!activeActorID) {
      readSequence.current += 1;
      setOffers([]);
      setLoadedActorID("");
      setLoading(false);
      return;
    }
    void load();
  }, [activeActorID, load]);
  const scopedOffers = isCurrentCaptainActor(loadedActorID, activeActorID) ? offers : [];
  const filteredOffers = useMemo(() => { const query = searchQuery.trim().toLocaleLowerCase(); if (!query) return scopedOffers; return scopedOffers.filter((offer) => [offer.id, offer.orderId, offer.storeName, offer.customerAddressText].join(" ").toLocaleLowerCase().includes(query)); }, [scopedOffers, searchQuery]);

  async function respond(offer: CaptainOffer, decision: "accept" | "reject") {
    if (busy || loading || !isCurrentCaptainActor(loadedActorID, activeActorID) || !offers.some((current) => current.id === offer.id && current.version === offer.version && current.state === "offered")) return;
    const actorID = loadedActorID;
    setBusy(offer.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const current = currentIdentityState();
      if (current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return;
      await captainClient().respondToCaptainOffer(token, offer.id, { decision }, offer.version);
      const after = currentIdentityState();
      if (after.kind !== "authenticated" || !isCurrentCaptainActor(actorID, after.identity.subject.trim())) return;
      await load();
    } catch (cause) {
      console.error("DSH Captain offer response failed", cause);
      const current = currentIdentityState();
      if (current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return;
      const verified = await load();
      setError(verified
        ? "لم نتأكد من نتيجة الرد. راجع حالة العرض بعد إعادة القراءة، ثم تحقق من التوصيلات قبل أي محاولة جديدة."
        : "لم نتأكد من نتيجة الرد وتعذرت إعادة قراءة العروض. لا تعِد إرسال القرار قبل نجاح تحديث العروض والتوصيلات.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="عروض التوصيل">
      <Text style={styles.title}>عروض التوصيل</Text>
      <Text style={styles.muted}>راجع العرض، ثم احسمه مرة واحدة قبل انتهاء صلاحيته.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>العروض ({filteredOffers.length})</Text> : null}
      {!loading && !error && !filteredOffers.length ? <Text style={styles.muted}>{scopedOffers.length ? "لا توجد عروض مطابقة للبحث." : "لا توجد عروض حالية."}</Text> : null}
      {!loading ? filteredOffers.map((offer) => <View key={offer.id} style={styles.card}><View style={styles.orderHeader}><Text style={styles.cardTitle}>{offer.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني"}</Text><BthwaniStatusBadge icon={offer.state === "offered" ? "deliveries" : "orders"} label={captainOfferStateLabel(offer.state)} tone={offer.state === "offered" ? "info" : "neutral"} /></View>{offer.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${offer.storeName}`} source={{ uri: offer.storeProfileImage.uri }} style={{ borderRadius: 10, height: 100, width: "100%" }} resizeMode="cover" /> : null}<Text style={styles.muted}>تفاصيل الطلب</Text><Text style={styles.muted}>المتجر: {offer.storeName}</Text><Text style={styles.muted}>عنوان العميل: {offer.customerAddressText}</Text><Text style={styles.payment}>المطلوب نقدًا: {formatMoney(offer.amountDueMinor, offer.currency)} · {paymentMethodLabel(offer.paymentMethod, offer.fulfillmentMode, offer.amountDueMinor)} · {paymentStateLabel(offer.paymentState, offer.paymentMethod, offer.fulfillmentMode, offer.amountDueMinor)}</Text>{offer.amountDueMinor === 0 ? <Text style={styles.muted}>الطلب مغطى برصيد العميل؛ لا يوجد نقد لتحصيله.</Text> : null}<Text style={styles.muted}>ينتهي في {new Date(offer.expiresAt).toLocaleString("ar-YE")}</Text>{offer.state === "offered" ? <View style={styles.row}><BthwaniButton busy={busy === offer.id} disabled={Boolean(busy) || loading || !isCurrentCaptainActor(loadedActorID, activeActorID)} label="قبول العرض" onPress={() => void respond(offer, "accept")} style={styles.actionButton} /><BthwaniButton disabled={Boolean(busy) || loading || !isCurrentCaptainActor(loadedActorID, activeActorID)} label="رفض العرض" onPress={() => void respond(offer, "reject")} style={styles.actionButton} variant="danger" /></View> : null}</View>) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy) || loading} disabled={Boolean(busy) || loading} label="تحديث العروض" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
