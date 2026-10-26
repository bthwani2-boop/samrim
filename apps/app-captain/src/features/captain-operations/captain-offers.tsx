import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainOffer, captainOfferStateLabel, formatMoney, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import { type Href, Link, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { claimCaptainOfferResponse } from "./captain-offer-response-guard";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { isCurrentCaptainActor } from "./captain-session-scope";

export function CaptainOffers({ compact = false, popup = false, suppressed = false }: { compact?: boolean; popup?: boolean; suppressed?: boolean } = {}) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const isFocused = useIsFocused();
  const { q: rawQuery } = useLocalSearchParams<{ q?: string | string[] }>();
  const searchQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? "" : rawQuery ?? "";
  const [offers, setOffers] = useState<ReadonlyArray<CaptainOffer>>([]);
  const [loadedActorID, setLoadedActorID] = useState("");
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const readSequence = useRef(0);
  const responseInFlight = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dismissedOfferId, setDismissedOfferId] = useState("");

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
    if (!suppressed) void load();
  }, [activeActorID, load, suppressed]);
  // Losing offers disappear from the active screen after the server's
  // atomic supersession, without requiring the other captain to tap Refresh.
  useEffect(() => {
    if (!isFocused || suppressed || !activeActorID || loadedActorID !== activeActorID || loading) return;
    let cancelled = false;
    const refresh = async () => {
      if (busy) return;
      try {
        const token = await getUsableIdentityAccessToken();
        const response = await captainClient().listOwnCaptainOffers(token);
        const session = currentIdentityState();
        if (!cancelled && session.kind === "authenticated" && isCurrentCaptainActor(activeActorID, session.identity.subject.trim())) {
          setOffers(response.offers);
        }
      } catch {
        // An interrupted background read preserves the previous visible state.
      }
    };
    const timer = setInterval(() => void refresh(), popup ? 2500 : 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isFocused, suppressed, activeActorID, loadedActorID, busy, loading, popup]);

  const scopedOffers = isCurrentCaptainActor(loadedActorID, activeActorID) ? offers : [];
  const filteredOffers = useMemo(() => { const query = searchQuery.trim().toLocaleLowerCase(); if (!query) return scopedOffers; return scopedOffers.filter((offer) => [offer.id, offer.orderId, offer.storeName, offer.deliveryAreaText].join(" ").toLocaleLowerCase().includes(query)); }, [scopedOffers, searchQuery]);

  const orderedOffers = [...filteredOffers].filter((offer) => !compact || (offer.state === "offered" && Date.parse(offer.expiresAt) > Date.now()))
    .sort((left, right) => Number(right.state === "offered") - Number(left.state === "offered"));

  async function respond(offer: CaptainOffer, decision: "accept" | "reject") {
    if (busy || loading || !isCurrentCaptainActor(loadedActorID, activeActorID) || !offers.some((current) => current.id === offer.id && current.version === offer.version && current.state === "offered")) return;
    if (!claimCaptainOfferResponse(responseInFlight.current, offer.id)) return;
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
      const insufficientFunds = typeof cause === "object" && cause !== null && "code" in cause && cause.code === "INSUFFICIENT_FUNDS";
      if (!insufficientFunds) console.error("DSH Captain offer response failed", cause);
      const current = currentIdentityState();
      if (current.kind !== "authenticated" || !isCurrentCaptainActor(actorID, current.identity.subject.trim())) return;
      const verified = await load();
      setError(insufficientFunds && verified
        ? "رصيد محفظتك المتاح لا يكفي لضمان التحصيل النقدي لهذا الطلب. لم يُقبل العرض؛ يلزم توفير الرصيد عبر قناة شحن معتمدة."
        : verified
          ? "لم نتأكد من نتيجة الرد. راجع حالة العرض بعد إعادة القراءة، ثم تحقق من التوصيلات قبل أي محاولة جديدة."
          : "لم نتأكد من نتيجة الرد وتعذرت إعادة قراءة العروض. لا تعِد إرسال القرار حتى تظهر النتيجة المؤكدة تلقائيًا.");
    } finally {
      responseInFlight.current.delete(offer.id);
      setBusy("");
    }
  }

  if (popup) {
    // Non-modal: never cover the map or steal navigation. The Captain may
    // wait until safely stopped; unaccepted offers expire on the server.
    const offer = orderedOffers.find((item) => item.state === "offered"
      && Date.parse(item.expiresAt) > Date.now() && item.id !== dismissedOfferId);
    if (!isFocused || suppressed || (!offer && !error)) return null;
    return <View pointerEvents="box-none" style={{ position: "absolute", bottom: 12, left: 12, right: 12 }}
      accessibilityLabel="تنبيه عرض توصيل">
      <View style={{ padding: 12, borderRadius: 16, backgroundColor: theme.surface, gap: 8 }}>
        {offer ? <>
          <Text style={styles.cardTitle} numberOfLines={1}>عرض جديد · {offer.storeName}</Text>
          <Text style={styles.muted} numberOfLines={1}>{offer.deliveryAreaText} · {formatMoney(offer.amountDueMinor, offer.currency)}</Text>
          <Text style={styles.muted}>تعامل مع العرض بعد التوقف بأمان.</Text>
          <View style={styles.row}>
            <BthwaniButton busy={busy === offer.id} disabled={Boolean(busy)}
              label="قبول" onPress={() => void respond(offer, "accept")} style={styles.actionButton} />
            <BthwaniButton disabled={Boolean(busy)} label="رفض"
              onPress={() => void respond(offer, "reject")} style={styles.actionButton} variant="secondary" />
            <BthwaniButton disabled={Boolean(busy)} label="لاحقًا"
              onPress={() => setDismissedOfferId(offer.id)} style={styles.actionButton} variant="secondary" />
          </View>
        </> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
    </View>;
  }

  return (
    <View style={styles.container} accessibilityLabel="عروض التوصيل">
      <Text style={styles.readinessTitle}>{compact ? "العروض المتاحة" : "عروض التوصيل"}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ جلب العروض…</Text></View> : null}
      {!loading && !error && !orderedOffers.length ? <View style={compact ? styles.readinessActions : styles.card}>
        <Text style={styles.cardTitle}>{compact ? "لا توجد عروض متاحة الآن" : scopedOffers.length ? "لا توجد نتائج للبحث" : "لا توجد عروض جديدة الآن"}</Text>
        <Text style={styles.muted}>{compact ? "ستظهر العروض الجديدة هنا تلقائيًا عند توفرها." : scopedOffers.length ? "غيّر عبارة البحث أو امسحها لعرض جميع العروض." : "ستظهر العروض الجديدة تلقائيًا عند توفرها."}</Text>
        {!compact && !scopedOffers.length ? <Link href={"/deliveries" as Href} asChild><BthwaniButton label="عرض التوصيلات الحالية" variant="secondary" /></Link> : null}
      </View> : null}
      {!loading ? orderedOffers.map((offer) => <View key={offer.id} style={compact ? styles.compactOfferCard : styles.card}>
        <View style={styles.orderHeader}>
          <View style={styles.offerIdentity}>
            {offer.storeProfileImage?.uri ? <Image accessibilityLabel={"شعار متجر " + offer.storeName} source={{ uri: offer.storeProfileImage.uri }} style={styles.offerThumbnail} resizeMode="cover" /> : null}
            <View style={styles.offerIdentityCopy}>
              <Text style={styles.cardTitle}>{offer.storeName}</Text>
              <Text style={styles.muted}>{offer.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني"}</Text>
            </View>
          </View>
          <BthwaniStatusBadge icon={offer.state === "offered" ? "deliveries" : "orders"} label={captainOfferStateLabel(offer.state)} tone={offer.state === "offered" ? "info" : "neutral"} />
        </View>
        <View style={styles.offerDetail}>
          <Text style={styles.offerAddress}>منطقة التوصيل: {offer.deliveryAreaText}</Text>
        </View>
        <View style={styles.offerDetail}>
          <Text style={styles.offerLabel}>التحصيل النقدي</Text>
          <Text style={styles.offerAmount}>{formatMoney(offer.amountDueMinor, offer.currency)}</Text>
          <Text style={styles.muted}>{paymentMethodLabel(offer.paymentMethod, offer.fulfillmentMode, offer.amountDueMinor)} · {paymentStateLabel(offer.paymentState, offer.paymentMethod, offer.fulfillmentMode, offer.amountDueMinor)}</Text>
          {offer.amountDueMinor === 0 ? <Text style={styles.muted}>لا يوجد نقد لتحصيله؛ الطلب مدفوع من رصيد العميل.</Text> : null}
        </View>
        {offer.state === "offered" ? <Text style={styles.muted}>آخر موعد للرد: {new Date(offer.expiresAt).toLocaleString("ar-YE")}</Text> : null}
        {offer.state === "offered" ? <View style={styles.row}>
          <BthwaniButton busy={busy === offer.id} disabled={Boolean(busy) || loading || !isCurrentCaptainActor(loadedActorID, activeActorID)} label="قبول" onPress={() => void respond(offer, "accept")} style={styles.actionButton} />
          <BthwaniButton disabled={Boolean(busy) || loading || !isCurrentCaptainActor(loadedActorID, activeActorID)} label="رفض" onPress={() => void respond(offer, "reject")} style={styles.actionButton} variant="secondary" />
        </View> : null}
      </View>) : null}
      {error && !compact ? <BthwaniButton busy={loading} disabled={Boolean(busy) || loading} label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
    </View>
  );
}
