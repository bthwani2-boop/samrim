import { toAsciiDigits } from "@bthwani/design-system";
import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainDeliveryTask, type CashLiabilityItem, captainAssignmentStateLabel, captainHandoffStateLabel, captainTaskProgressLabel, formatMoney, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { OrderConversation } from "./order-conversation";

export function CaptainDeliveries() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [assignments, setAssignments] = useState<ReadonlyArray<CaptainAssignment>>([]);
  const [tasks, setTasks] = useState<Readonly<Record<string, CaptainDeliveryTask>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [collectionAmounts, setCollectionAmounts] = useState<Record<string, string>>({});
  const [deliveryProofCodes, setDeliveryProofCodes] = useState<Record<string, string>>({});
  const [locationError, setLocationError] = useState("");
  const [lastLocationUpdatedAt, setLastLocationUpdatedAt] = useState("");
  const [cashLiability, setCashLiability] = useState<{ items: ReadonlyArray<CashLiabilityItem>; totalAmountMinor: number } | null>(null);
  const [cashRemittanceReferences, setCashRemittanceReferences] = useState<Record<string, string>>({});
  const [cashBusy, setCashBusy] = useState("");
  const activeAssignmentID = useMemo(() => assignments.find((assignment) => assignment.state === "in_custody")?.id ?? "", [assignments]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const api = captainClient();
      const response = await api.listOwnCaptainAssignments(token);
      setAssignments(response.assignments);
      const taskEntries = await Promise.all(response.assignments.map(async (assignment) => {
        try {
          const taskResponse = await api.readOwnCaptainDeliveryTask(token, assignment.id);
          return [assignment.id, taskResponse.task] as const;
        } catch (cause) {
          console.warn("DSH Captain delivery task unavailable", assignment.id, cause);
          return null;
        }
      }));
      setTasks(Object.fromEntries(taskEntries.filter((entry): entry is readonly [string, CaptainDeliveryTask] => entry !== null)));
      setCashLiability(await api.readOwnCaptainCashLiability(token));
    } catch (cause) {
      console.error("DSH Captain deliveries readback failed", cause);
      setError("تعذر قراءة التوصيلات. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeAssignmentID) {
      setLocationError("");
      setLastLocationUpdatedAt("");
      return;
    }
    let disposed = false;
    let publishing = false;
    let subscription: Location.LocationSubscription | undefined;
    const publish = async (latitude: number, longitude: number) => {
      if (publishing || disposed) return;
      publishing = true;
      try {
        const token = await getUsableIdentityAccessToken();
        const result = await captainClient().updateCaptainLocation(token, activeAssignmentID, latitude, longitude);
        if (!disposed) {
          setLastLocationUpdatedAt(result.location.updatedAt);
          setLocationError("");
        }
      } catch (cause) {
        console.warn("DSH Captain live location update failed", cause);
        if (!disposed) setLocationError("تعذر تحديث الموقع. فعّل إذن الموقع وأعد المحاولة.");
      } finally {
        publishing = false;
      }
    };
    const start = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (disposed) return;
      if (permission.status !== "granted") {
        setLocationError("اسمح بالوصول إلى الموقع أثناء استخدام التطبيق لتحديث رحلة التوصيل.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (disposed) return;
      await publish(current.coords.latitude, current.coords.longitude);
      if (disposed) return;
      subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 30_000, distanceInterval: 100 }, (position) => {
        void publish(position.coords.latitude, position.coords.longitude);
      });
    };
    void start().catch((cause) => {
      console.warn("DSH Captain live location setup failed", cause);
      if (!disposed) setLocationError("تعذر تشغيل تحديث الموقع لهذه الرحلة.");
    });
    return () => {
      disposed = true;
      subscription?.remove();
    };
  }, [activeAssignmentID]);

  async function pickup(assignment: CaptainAssignment) {
    if (busy || assignment.state !== "assigned") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().completeCaptainPickup(token, assignment.id, assignment.handoff.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain pickup failed", cause);
      setError("لا يمكن تأكيد الاستلام قبل تأكيد المتجر أو عند تعارض النسخة.");
    } finally {
      setBusy("");
    }
  }

  async function complete(assignment: CaptainAssignment, result: "delivered" | "delivery_failed", collectedAmountMinor?: number) {
    if (busy || assignment.state !== "in_custody") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const deliveryProofCode = deliveryProofCodes[assignment.id]?.trim() ?? "";
      await captainClient().completeCaptainAssignment(token, assignment.id, { result, ...(collectedAmountMinor === undefined ? {} : { collectedAmountMinor }), ...(result === "delivered" ? { deliveryProofCode } : {}) }, assignment.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain completion failed", cause);
      setError("تعذر تسجيل النتيجة النهائية. أعد القراءة قبل المحاولة.");
    } finally {
      setBusy("");
    }
  }

  async function remitCash(item: CashLiabilityItem) {
    const reference = cashRemittanceReferences[item.paymentIntentId]?.trim() ?? "";
    if (cashBusy || !reference) {
      setError("أدخل مرجع توريد العهدة قبل التأكيد.");
      return;
    }
    setCashBusy(item.paymentIntentId);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().remitOwnCaptainCash(token, item.paymentIntentId, { amountMinor: item.amountMinor, remittanceReference: reference }, item.paymentVersion);
      await load();
    } catch (cause) {
      console.error("WLT Captain cash remittance failed", cause);
      setError("تعذر تسجيل توريد العهدة. أعد القراءة قبل المحاولة.");
    } finally {
      setCashBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="التوصيلات الحالية">
      <Text style={styles.title}>التوصيلات الحالية</Text>
      <Text style={styles.muted}>رتّب عملك من الاستلام إلى التسليم، وتعرّف على العائق قبل بدء الإجراء.</Text>
      {cashLiability ? <View style={styles.summaryCard} accessibilityLabel="العهدة النقدية"><Text style={styles.sectionTitle}>العهدة النقدية غير المورّدة</Text><Text style={styles.warning}>الإجمالي: {formatMoney(cashLiability.totalAmountMinor, "YER")}</Text>{cashLiability.items.length === 0 ? <Text style={styles.muted}>لا توجد مبالغ معلّقة.</Text> : cashLiability.items.map((item) => { const reference = cashRemittanceReferences[item.paymentIntentId] ?? ""; return <View key={item.paymentIntentId} style={styles.task}><Text style={styles.cardTitle}>طلب {item.externalReference}</Text><Text style={styles.muted}>المبلغ: {formatMoney(item.amountMinor, item.currency)}</Text><TextInput accessibilityLabel={`مرجع توريد العهدة ${item.externalReference}`} onChangeText={(value) => setCashRemittanceReferences((current) => ({ ...current, [item.paymentIntentId]: value }))} value={reference} style={styles.input} placeholder="مرجع الإيصال أو التوريد" /><BthwaniButton busy={cashBusy === item.paymentIntentId} disabled={Boolean(cashBusy) || !reference.trim()} label="تأكيد توريد العهدة" onPress={() => void remitCash(item)} /></View>; })}</View> : null}
      {activeAssignmentID ? <Text accessibilityLiveRegion="polite" style={locationError ? styles.warning : styles.progress}>{locationError || (lastLocationUpdatedAt ? "الموقع المباشر مفعّل أثناء العهدة." : "جارٍ تفعيل الموقع المباشر أثناء العهدة…")}</Text> : null}
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <Text style={styles.muted}>لا توجد تكليفات.</Text> : null}
      {!loading ? assignments.map((assignment) => {
        const task = tasks[assignment.id];
        const assignmentLabel = task ? captainAssignmentStateLabel(task.deliveryState) : captainAssignmentStateLabel(assignment.state);
        const handoffLabel = task ? captainHandoffStateLabel(task.handoffState) : captainHandoffStateLabel(assignment.handoff.state);
        const requiresCollection = task?.paymentState === "REQUIRES_COLLECTION";
        const collectionAmountText = collectionAmounts[assignment.id] ?? (requiresCollection ? String(task.amountDueMinor) : "");
        const parsedCollectionAmount = Number(collectionAmountText);
        const collectionAmountInvalid = requiresCollection && (!Number.isSafeInteger(parsedCollectionAmount) || parsedCollectionAmount !== task.amountDueMinor);
        const deliveryProofCode = deliveryProofCodes[assignment.id] ?? "";
        const deliveryProofInvalid = assignment.state === "in_custody" && !/^[0-9]{6}$/.test(deliveryProofCode);
        return (
          <View key={assignment.id} style={styles.card}>
            <View style={styles.orderHeader}>
              <Text style={styles.cardTitle}>{task?.orderReference ? `مهمة التوصيل ${task.orderReference}` : "مهمة توصيل"}</Text>
              <BthwaniStatusBadge icon={assignment.state === "delivery_failed" ? "warning" : "deliveries"} label={assignmentLabel} tone={assignment.state === "delivery_failed" ? "danger" : assignment.state === "in_custody" ? "success" : "info"} />
            </View>
            <BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "store"} label={`التسليم من المتجر: ${handoffLabel}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />
            {task ? (
              <View style={styles.task}>
                {task.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${task.storeName}`} source={{ uri: task.storeProfileImage.uri }} style={{ borderRadius: 10, height: 100, width: "100%" }} resizeMode="cover" /> : null}
                <Text style={styles.muted}>نوع التوصيل: {task.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني"}</Text>
                {task.fulfillmentMode === "PARTNER_CAPTAIN" ? <Text style={styles.warning}>بعد استلام النقد من العميل، سلّمه إلى المتجر. سيؤكد الشريك الاستلام في التطبيق؛ هذا المبلغ لا يدخل في عهدة محفظة الكابتن لدى المنصة.</Text> : null}
                <Text style={styles.muted}>المتجر: {task.storeName}</Text>
                <Text style={styles.muted}>عنوان العميل: {task.customerAddressText}</Text>
                <Text style={styles.muted}>حالة الطلب: {orderStateLabel(task.orderState)}</Text>
                <Text style={styles.payment}>{paymentMethodLabel(task.paymentMethod)} · {paymentStateLabel(task.paymentState)}</Text>
                {requiresCollection ? (
                  <>
                    <Text style={styles.warning}>{task.fulfillmentMode === "PARTNER_CAPTAIN" ? "المبلغ الذي ستستلمه من العميل ثم تسلّمه للمتجر:" : "المطلوب تحصيله عند التسليم:"} {formatMoney(task.amountDueMinor, task.currency)}</Text>
                    <TextInput accessibilityLabel={`المبلغ المحصل للمهمة ${task.orderReference}`} keyboardType="number-pad" onChangeText={(value) => setCollectionAmounts((current) => ({ ...current, [assignment.id]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={collectionAmountText} style={styles.input} />
                    <Text style={collectionAmountInvalid ? styles.error : styles.muted}>{collectionAmountInvalid ? "يجب أن يساوي المبلغ المحصل إجمالي الطلب قبل تأكيد التسليم." : "أكّد المبلغ الذي استلمه الكابتن نقدًا."}</Text>
                  </>
                ) : null}
                {assignment.state === "in_custody" ? (
                  <>
                    <Text style={styles.warning}>اطلب رمز التسليم الظاهر لدى العميل وأدخله قبل إتمام الرحلة.</Text>
                    <TextInput accessibilityLabel={`رمز التسليم للمهمة ${task.orderReference}`} keyboardType="number-pad" maxLength={6} onChangeText={(value) => setDeliveryProofCodes((current) => ({ ...current, [assignment.id]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={deliveryProofCode} style={styles.input} />
                    <Text style={deliveryProofInvalid ? styles.error : styles.muted}>{deliveryProofInvalid ? "أدخل رمز التسليم المكوّن من ستة أرقام." : "سيتم التحقق من الرمز قبل إعلان التسليم."}</Text>
                  </>
                ) : null}
                <Text style={task.deliveryState === "delivery_failed" ? styles.warning : styles.progress}>{captainTaskProgressLabel(task)}</Text>
              </View>
            ) : <Text style={styles.muted}>جارٍ تجهيز تفاصيل المهمة.</Text>}
            {assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy)} label="تأكيد استلام الطلب" onPress={() => void pickup(assignment)} /> : null}
            {assignment.state === "assigned" && assignment.handoff.state === "pending" ? <Text style={styles.muted}>بانتظار تأكيد المتجر قبل الاستلام.</Text> : null}
            {assignment.state === "in_custody" ? (
              <View style={styles.row}>
                <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy) || collectionAmountInvalid || deliveryProofInvalid} label={requiresCollection ? "تحصيل المبلغ وتأكيد التسليم" : "تأكيد التسليم"} onPress={() => void complete(assignment, "delivered", requiresCollection ? parsedCollectionAmount : undefined)} style={styles.actionButton} />
                <BthwaniButton disabled={Boolean(busy)} label="تعذر التسليم" onPress={() => void complete(assignment, "delivery_failed")} style={styles.actionButton} variant="danger" />
              </View>
            ) : null}
            {assignment.state === "delivery_failed" ? <View style={styles.warningBox}><Text style={styles.warning}>يبقى الطلب في عهدتك حتى يعالج المشغل التعذر؛ لن تُفتح لك مهمة جديدة قبل الاسترداد.</Text></View> : null}
          </View>
        );
      }) : null}
       {!loading ? assignments.map((assignment) => <OrderConversation key={`conversation-${assignment.id}`} orderId={assignment.orderId} />) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث التوصيلات" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
