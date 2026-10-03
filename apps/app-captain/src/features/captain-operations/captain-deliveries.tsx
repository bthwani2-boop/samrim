import { toAsciiDigits } from "@bthwani/design-system";
import { BthwaniButton, BthwaniMap, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainCompletionRequest, type CaptainDeliveryTask, type CashLiabilityItem, captainAssignmentStateLabel, captainHandoffStateLabel, captainTaskProgressLabel, formatMoney, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { OrderConversation } from "./order-conversation";

type PendingCaptainCompletionAttempt = Readonly<{
  version: 1;
  actorID: string;
  assignmentID: string;
  expectedVersion: number;
  request: CaptainCompletionRequest;
  idempotencyKey: string;
  correlationID: string;
}>;

function pendingCaptainCompletionKey(actorID: string): string {
  return `bthwani.captain.delivery-completion.pending.v1.${encodeURIComponent(actorID)}`;
}

function parsePendingCaptainCompletion(raw: string | null, actorID: string): PendingCaptainCompletionAttempt | null {
  if (!raw) return null;
  let value: Partial<PendingCaptainCompletionAttempt>;
  try {
    value = JSON.parse(raw) as Partial<PendingCaptainCompletionAttempt>;
  } catch {
    throw new Error("CAPTAIN_COMPLETION_ATTEMPT_INVALID");
  }
  const request = value.request;
  if (value.version !== 1 || value.actorID !== actorID || typeof value.assignmentID !== "string" || !value.assignmentID || !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1 || !request || (request.result !== "delivered" && request.result !== "delivery_failed") || (request.collectedAmountMinor !== undefined && (!Number.isSafeInteger(request.collectedAmountMinor) || request.collectedAmountMinor < 0)) || (request.result === "delivered" && !/^[0-9]{6}$/.test(request.deliveryProofCode?.trim() ?? "")) || (request.result === "delivery_failed" && request.deliveryProofCode?.trim()) || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationID !== "string" || value.correlationID.length < 8 || value.correlationID.length > 128) {
    throw new Error("CAPTAIN_COMPLETION_ATTEMPT_INVALID");
  }
  return value as PendingCaptainCompletionAttempt;
}

function captainCompletionHttpRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" && value.status >= 400 && value.status < 500;
}

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
  const [captainPosition, setCaptainPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cashLiability, setCashLiability] = useState<{ items: ReadonlyArray<CashLiabilityItem>; totalAmountMinor: number } | null>(null);
  const [cashRemittanceReferences, setCashRemittanceReferences] = useState<Record<string, string>>({});
  const [cashBusy, setCashBusy] = useState("");
  const [pendingCompletion, setPendingCompletion] = useState<PendingCaptainCompletionAttempt | null>(null);
  const [completionStorageReady, setCompletionStorageReady] = useState(false);
  const [completionStorageIssue, setCompletionStorageIssue] = useState(false);
  const [completionRejected, setCompletionRejected] = useState(false);
  const activeAssignmentID = useMemo(() => assignments.find((assignment) => assignment.state === "in_custody")?.id ?? "", [assignments]);

  const load = useCallback(async () => {
    setLoading(true);
    setCompletionStorageReady(false);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const rawAttempt = await SecureStore.getItemAsync(pendingCaptainCompletionKey(actorID));
      let attempt: PendingCaptainCompletionAttempt | null;
      try {
        attempt = parsePendingCaptainCompletion(rawAttempt, actorID);
      } catch (cause) {
        setCompletionStorageIssue(true);
        throw cause;
      }
      setPendingCompletion(attempt);
      setCompletionRejected(false);
      setCompletionStorageIssue(false);
      setCompletionStorageReady(true);
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
      setCaptainPosition(null);
      return;
    }
    let disposed = false;
    let publishing = false;
    let subscription: Location.LocationSubscription | undefined;
    const publish = async (latitude: number, longitude: number) => {
      if (publishing || disposed) return;
      publishing = true;
      if (!disposed) setCaptainPosition({ latitude, longitude });
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
    if (busy || !completionStorageReady || completionStorageIssue || pendingCompletion || assignment.state !== "assigned") return;
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
    if (busy || !completionStorageReady || completionStorageIssue || pendingCompletion || assignment.state !== "in_custody") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const deliveryProofCode = deliveryProofCodes[assignment.id]?.trim() ?? "";
      const request: CaptainCompletionRequest = { result, ...(collectedAmountMinor === undefined ? {} : { collectedAmountMinor }), ...(result === "delivered" ? { deliveryProofCode } : {}) };
      const attempt: PendingCaptainCompletionAttempt = {
        version: 1,
        actorID: identity.identity.subject.trim(),
        assignmentID: assignment.id,
        expectedVersion: assignment.version,
        request,
        idempotencyKey: `captain_complete_${Crypto.randomUUID()}`,
        correlationID: `captain_complete_corr_${Crypto.randomUUID()}`,
      };
      await SecureStore.setItemAsync(pendingCaptainCompletionKey(attempt.actorID), JSON.stringify(attempt));
      setPendingCompletion(attempt);
      setCompletionRejected(false);
      await captainClient().completeCaptainAssignment(token, attempt.assignmentID, attempt.request, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      setPendingCompletion(null);
      setDeliveryProofCodes((current) => ({ ...current, [assignment.id]: "" }));
      await load();
    } catch (cause) {
      console.error("DSH Captain completion failed", cause);
      setCompletionRejected(captainCompletionHttpRejected(cause));
      setError(captainCompletionHttpRejected(cause) ? "رفض الخادم المحاولة ولم نعدّل بياناتها. أعد إرسالها بالمفتاح نفسه أو تحقق من المهمة لفتح تعديل آمن." : "تعذر تأكيد النتيجة. بقيت المحاولة ومفتاحها محفوظين؛ أعد إرسالها بالمفتاح نفسه.");
    } finally {
      setBusy("");
    }
  }

  async function retryPendingCompletion() {
    const attempt = pendingCompletion;
    if (!attempt || busy) return;
    setBusy(attempt.assignmentID);
    setError("");
    setCompletionRejected(false);
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().completeCaptainAssignment(token, attempt.assignmentID, attempt.request, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      setPendingCompletion(null);
      setDeliveryProofCodes((current) => ({ ...current, [attempt.assignmentID]: "" }));
      await load();
    } catch (cause) {
      console.error("DSH Captain completion recovery failed", cause);
      setCompletionRejected(captainCompletionHttpRejected(cause));
      setError(captainCompletionHttpRejected(cause) ? "رفض الخادم المحاولة ولم نعدّل بياناتها. تحقق من المهمة قبل تصحيحها." : "لم نتأكد من النتيجة. بقيت المحاولة محفوظة؛ أعد إرسالها بالمفتاح نفسه.");
    } finally {
      setBusy("");
    }
  }

  async function replaceRejectedCompletionAfterReadback() {
    const attempt = pendingCompletion;
    if (!attempt || !completionRejected || busy) return;
    setBusy(attempt.assignmentID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const response = await captainClient().listOwnCaptainAssignments(token);
      const current = response.assignments.find((item) => item.id === attempt.assignmentID);
      if (!current || current.state !== "in_custody" || current.version !== attempt.expectedVersion) {
        setCompletionRejected(false);
        setError("تغيرت المهمة أو تعذر إثبات بقائها دون تنفيذ؛ احتفظنا بالمحاولة الأصلية وأعد قراءتها.");
        return;
      }
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      setPendingCompletion(null);
      setCompletionRejected(false);
      await load();
      setError("ثبت أن المحاولة لم تُنفذ وأن المهمة ما زالت في عهدتك؛ حدّث التوصيلات ثم صحح الرمز أو المبلغ.");
    } catch (cause) {
      console.error("DSH Captain completion rejection reconciliation failed", cause);
      setError("تعذر تأكيد حالة المهمة. بقيت المحاولة الأصلية محفوظة كما هي.");
    } finally {
      setBusy("");
    }
  }

  async function remitCash(item: CashLiabilityItem) {
    const reference = cashRemittanceReferences[item.paymentIntentId]?.trim() ?? "";
    if (cashBusy || !reference) {
      setError("أدخل مرجع توريد العهدة لإرساله إلى المالية.");
      return;
    }
    setCashBusy(item.paymentIntentId);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().remitOwnCaptainCash(token, item.paymentIntentId, { amountMinor: item.amountMinor, remittanceReference: reference }, item.paymentVersion);
      await load();
    } catch (cause) {
      console.error("WLT Captain cash remittance submission failed", cause);
      setError("تعذر إرسال مرجع التوريد. أعد القراءة قبل المحاولة.");
    } finally {
      setCashBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="التوصيلات الحالية">
      <Text style={styles.title}>التوصيلات الحالية</Text>
      <Text style={styles.muted}>رتّب عملك من الاستلام إلى التسليم، وتعرّف على العائق قبل بدء الإجراء.</Text>
      {pendingCompletion ? <View style={styles.warningBox}><Text style={styles.warning}>توجد محاولة تسليم محفوظة للمهمة. أعد إرسال الحقائق والمفتاح نفسيهما حتى نثبت النتيجة.</Text><BthwaniButton busy={busy === pendingCompletion.assignmentID} disabled={Boolean(busy) || !completionStorageReady} label="التحقق من نتيجة التسليم" onPress={() => void retryPendingCompletion()} />{completionRejected ? <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحقق من المهمة لفتح تصحيح آمن" onPress={() => void replaceRejectedCompletionAfterReadback()} variant="secondary" /> : null}</View> : null}
      {completionStorageIssue ? <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة المحاولة الآمنة السابقة. لا تؤكد تسليمًا جديدًا؛ أعد قراءة الحالة أو اطلب مراجعة المشغل.</Text> : null}
      {!completionStorageReady && !completionStorageIssue && !loading ? <Text accessibilityRole="alert" style={styles.warning}>تعذر التحقق من المحاولات المحفوظة؛ لن نرسل تأكيدًا حتى تنجح إعادة القراءة.</Text> : null}
      {cashLiability ? <View style={styles.summaryCard} accessibilityLabel="العهدة النقدية">
        <Text style={styles.sectionTitle}>العهدة النقدية غير المسوّاة</Text>
        <Text style={styles.warning}>الإجمالي المفتوح: {formatMoney(cashLiability.totalAmountMinor, "YER")}</Text>
        {cashLiability.items.length === 0 ? <Text style={styles.muted}>لا توجد مبالغ معلّقة.</Text> : cashLiability.items.map((item) => {
          const reference = cashRemittanceReferences[item.paymentIntentId] ?? item.remittanceReference ?? "";
          return <View key={item.paymentIntentId} style={styles.task}>
            <Text style={styles.cardTitle}>طلب {item.externalReference}</Text>
            <Text style={styles.muted}>المبلغ: {formatMoney(item.amountMinor, item.currency)}</Text>
            {item.remittanceState === "SUBMITTED" ? <Text style={styles.warning}>أُرسل المرجع إلى المالية؛ تبقى العهدة مفتوحة حتى مطابقة الإيصال.</Text> : null}
            <TextInput accessibilityLabel={`مرجع توريد العهدة ${item.externalReference}`} onChangeText={(value) => setCashRemittanceReferences((current) => ({ ...current, [item.paymentIntentId]: value }))} value={reference} style={styles.input} placeholder="مرجع التوريد" />
            <BthwaniButton busy={cashBusy === item.paymentIntentId} disabled={Boolean(cashBusy) || !reference.trim()} label={item.remittanceState === "SUBMITTED" ? "تحديث مرجع التوريد" : "إرسال المرجع إلى المالية"} onPress={() => void remitCash(item)} />
          </View>;
        })}
      </View> : null}
      {activeAssignmentID ? <Text accessibilityLiveRegion="polite" style={locationError ? styles.warning : styles.progress}>{locationError || (lastLocationUpdatedAt ? "الموقع المباشر مفعّل أثناء العهدة." : "جارٍ تفعيل الموقع المباشر أثناء العهدة…")}</Text> : null}
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <Text style={styles.muted}>لا توجد تكليفات.</Text> : null}
      {!loading ? assignments.map((assignment) => {
        const task = tasks[assignment.id];
        const assignmentLabel = task ? captainAssignmentStateLabel(task.deliveryState) : captainAssignmentStateLabel(assignment.state);
        const handoffLabel = task ? captainHandoffStateLabel(task.handoffState) : captainHandoffStateLabel(assignment.handoff.state);
        const requiresCollection = task?.paymentState === "REQUIRES_COLLECTION";
        const requiresCashCollection = requiresCollection && task.amountDueMinor > 0;
        const collectionAmountText = collectionAmounts[assignment.id] ?? (requiresCollection ? String(task.amountDueMinor) : "");
        const parsedCollectionAmount = Number(collectionAmountText);
        const collectionAmountInvalid = requiresCashCollection && (!Number.isSafeInteger(parsedCollectionAmount) || parsedCollectionAmount !== task.amountDueMinor);
        const deliveryProofCode = deliveryProofCodes[assignment.id] ?? "";
        const deliveryProofInvalid = assignment.state === "in_custody" && !/^[0-9]{6}$/.test(deliveryProofCode);
        let assignmentStatusIcon: "warning" | "deliveries" = "deliveries";
        let assignmentStatusTone: "danger" | "success" | "info" = "info";
        if (assignment.state === "delivery_failed") {
          assignmentStatusIcon = "warning";
          assignmentStatusTone = "danger";
        } else if (assignment.state === "in_custody") {
          assignmentStatusTone = "success";
        }
        let collectedAmountMinor: number | undefined;
        if (requiresCollection) {
          collectedAmountMinor = 0;
          if (requiresCashCollection) collectedAmountMinor = parsedCollectionAmount;
        }
        const completionLabel = captainCompletionActionLabel(requiresCashCollection, requiresCollection);
        return (
          <View key={assignment.id} style={styles.card}>
            <View style={styles.orderHeader}>
              <Text style={styles.cardTitle}>{task?.orderReference ? `مهمة التوصيل ${task.orderReference}` : "مهمة توصيل"}</Text>
              <BthwaniStatusBadge icon={assignmentStatusIcon} label={assignmentLabel} tone={assignmentStatusTone} />
            </View>
            <BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "store"} label={`التسليم من المتجر: ${handoffLabel}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />
            {task ? (
              <View style={styles.task}>
                {task.storeProfileImage?.uri ? <Image accessibilityLabel={`صورة متجر ${task.storeName}`} source={{ uri: task.storeProfileImage.uri }} style={{ borderRadius: 10, height: 100, width: "100%" }} resizeMode="cover" /> : null}
                <Text style={styles.muted}>نوع التوصيل: {task.fulfillmentMode === "PARTNER_CAPTAIN" ? "توصيل المتجر" : "توصيل بثواني"}</Text>
                {task.fulfillmentMode === "PARTNER_CAPTAIN" && task.amountDueMinor > 0 ? <Text style={styles.warning}>بعد استلام النقد من العميل، سلّمه إلى المتجر. سيؤكد الشريك الاستلام في التطبيق؛ هذا المبلغ لا يدخل في عهدة محفظة الكابتن لدى المنصة.</Text> : null}
                <Text style={styles.muted}>المتجر: {task.storeName}</Text>
                <Text style={styles.muted}>عنوان العميل: {task.customerAddressText}</Text>
                {task.recipient.mode === "OTHER" ? <View style={styles.recipient}>
                  <Text style={styles.sectionTitle}>المستلم</Text>
                  <Text selectable style={styles.muted}>{task.recipient.name}</Text>
                  <Text selectable style={styles.muted}>رقم التواصل: {task.recipient.phoneE164}</Text>
                  {task.recipient.instructions ? <Text style={styles.muted}>تعليمات التوصيل: {task.recipient.instructions}</Text> : null}
                </View> : <Text style={styles.muted}>المستلم: صاحب الطلب</Text>}
                <Text style={styles.sectionTitle}>خريطة مهمة التوصيل</Text>
                <BthwaniMap
                  accessibilityLabel={`خريطة مهمة التوصيل ${task.orderReference}`}
                  markers={[
                    { id: "pickup", coordinate: task.pickupOrigin, title: `استلام من ${task.storeName}` },
                    { id: "destination", coordinate: task.customerDestination, title: "عنوان العميل" },
                  ]}
                  selection={assignment.id === activeAssignmentID ? captainPosition : null}
                  selectionTitle="موقعك الحالي"
                />
                <Text style={styles.muted}>حالة الطلب: {orderStateLabel(task.orderState)}</Text>
                <Text style={styles.payment}>{paymentMethodLabel(task.paymentMethod, task.fulfillmentMode, task.amountDueMinor)} · {paymentStateLabel(task.paymentState, task.paymentMethod, task.fulfillmentMode, task.amountDueMinor)}</Text>
                {requiresCashCollection ? (
                  <>
                    <Text style={styles.warning}>{task.fulfillmentMode === "PARTNER_CAPTAIN" ? "المبلغ الذي ستستلمه من العميل ثم تسلّمه للمتجر:" : "المطلوب تحصيله عند التسليم:"} {formatMoney(task.amountDueMinor, task.currency)}</Text>
                    <TextInput accessibilityLabel={`المبلغ المحصل للمهمة ${task.orderReference}`} keyboardType="number-pad" onChangeText={(value) => setCollectionAmounts((current) => ({ ...current, [assignment.id]: toAsciiDigits(value).replace(/[^0-9]/g, "") }))} value={collectionAmountText} style={styles.input} />
                    <Text style={collectionAmountInvalid ? styles.error : styles.muted}>{collectionAmountInvalid ? "يجب أن يساوي المبلغ المحصل النقد المتبقي في الطلب." : "أكّد المبلغ الذي استلمه الكابتن نقدًا."}</Text>
                  </>
                ) : null}
                {requiresCollection && task.amountDueMinor === 0 ? <Text style={styles.muted}>غطّى رصيد العميل كامل الطلب؛ لا تستلم نقدًا. ستتم التسوية المالية عند تأكيد التسليم.</Text> : null}
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
            {assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy) || !completionStorageReady || Boolean(pendingCompletion)} label="تأكيد استلام الطلب" onPress={() => void pickup(assignment)} /> : null}
            {assignment.state === "assigned" && assignment.handoff.state === "pending" ? <Text style={styles.muted}>بانتظار تأكيد المتجر قبل الاستلام.</Text> : null}
            {assignment.state === "in_custody" && pendingCompletion?.assignmentID === assignment.id ? <Text style={styles.warning}>يُحسم هذا الإجراء من المحاولة المحفوظة أعلاه.</Text> : null}
            {assignment.state === "in_custody" && !pendingCompletion ? (
              <View style={styles.row}>
                <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy) || !completionStorageReady || completionStorageIssue || collectionAmountInvalid || deliveryProofInvalid} label={completionLabel} onPress={() => void complete(assignment, "delivered", collectedAmountMinor)} style={styles.actionButton} />
                <BthwaniButton disabled={Boolean(busy) || !completionStorageReady || completionStorageIssue} label="تعذر التسليم" onPress={() => void complete(assignment, "delivery_failed")} style={styles.actionButton} variant="danger" />
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

function captainCompletionActionLabel(requiresCashCollection: boolean, requiresCollection: boolean): string {
  if (requiresCashCollection) return "تحصيل النقد وتأكيد التسليم";
  if (requiresCollection) return "تأكيد التسليم وتسوية الرصيد";
  return "تأكيد التسليم";
}
