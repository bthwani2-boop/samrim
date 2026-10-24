import { BthwaniButton, BthwaniOrderChatSheet, BthwaniMap, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainCompletionRequest, type CaptainDeliveryTask, captainAssignmentStateLabel, captainHandoffStateLabel, captainTaskProgressLabel, formatMoney, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Linking, Pressable, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";
import { canActOnCaptainTask } from "./captain-task-eligibility";
import { isCurrentCaptainActor } from "./captain-session-scope";
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

function openCaptainDirections(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    Alert.alert("موقع غير متاح", "تعذر تحديد وجهة صحيحة لفتح الاتجاهات.");
    return;
  }
  const destination = `${latitude},${longitude}`;
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`)
    .catch(() => Alert.alert("تعذر فتح الخريطة", "تحقق من توفر تطبيق خرائط أو اتصال بالإنترنت."));
}

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
  if (value.version !== 1 || value.actorID !== actorID || typeof value.assignmentID !== "string" || !value.assignmentID || !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1 || !request || (request.result !== "delivered" && request.result !== "delivery_failed") || (request.collectedAmountMinor !== undefined && (!Number.isSafeInteger(request.collectedAmountMinor) || request.collectedAmountMinor < 0)) || (request.result === "delivered" && request.deliveryProofCode?.trim() && !/^[0-9]{6}$/.test(request.deliveryProofCode.trim())) || (request.result === "delivery_failed" && request.deliveryProofCode?.trim()) || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationID !== "string" || value.correlationID.length < 8 || value.correlationID.length > 128) {
    throw new Error("CAPTAIN_COMPLETION_ATTEMPT_INVALID");
  }
  return value as PendingCaptainCompletionAttempt;
}

function captainCompletionHttpRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" && value.status >= 400 && value.status < 500;
}

function hasCurrentDeliveryActor(actorID: string): boolean {
  const session = currentIdentityState();
  return session.kind === "authenticated" && isCurrentCaptainActor(actorID, session.identity.subject.trim());
}

export function CaptainDeliveries() {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const isFocused = useIsFocused();
  const [assignments, setAssignments] = useState<ReadonlyArray<CaptainAssignment>>([]);
  const [chatOrderId,setChatOrderId]=useState("");
  const [loadedActorID, setLoadedActorID] = useState("");
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const readSequence = useRef(0);
  const mutationInFlight = useRef(false);
  const [tasks, setTasks] = useState<Readonly<Record<string, CaptainDeliveryTask>>>({});
  const [arrivalStatus, setArrivalStatus] = useState<Readonly<Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pendingCompletion, setPendingCompletion] = useState<PendingCaptainCompletionAttempt | null>(null);
  const [completionStorageReady, setCompletionStorageReady] = useState(false);
  const [completionStorageIssue, setCompletionStorageIssue] = useState(false);
  const [completionRejected, setCompletionRejected] = useState(false);
  const currentActorReadback = isCurrentCaptainActor(loadedActorID, activeActorID);

  const load = useCallback(async (quiet = false) => {
    const sequence = ++readSequence.current;
    const identity = currentIdentityState();
    const actorID = identity.kind === "authenticated" ? identity.identity.subject.trim() : "";
    const stillCurrent = () => sequence === readSequence.current && hasCurrentDeliveryActor(actorID) && (!quiet || !mutationInFlight.current);
    if (!quiet) {
      setLoading(true);
      setLoadedActorID("");
      setAssignments([]);
      setPendingCompletion(null);
      setTasks({});
      setArrivalStatus({});
      setCompletionStorageReady(false);
    }
    setError("");
    try {
      if (!actorID) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const token = await getUsableIdentityAccessToken();
      if (!stillCurrent()) return;
      const rawAttempt = await SecureStore.getItemAsync(pendingCaptainCompletionKey(actorID));
      if (!stillCurrent()) return;
      let attempt: PendingCaptainCompletionAttempt | null;
      try {
        attempt = parsePendingCaptainCompletion(rawAttempt, actorID);
      } catch (cause) {
        if (stillCurrent()) setCompletionStorageIssue(true);
        throw cause;
      }
      if (!stillCurrent()) return;
      setLoadedActorID(actorID);
      setPendingCompletion(attempt);
      setCompletionRejected(false);
      setCompletionStorageIssue(false);
      setCompletionStorageReady(true);
      const api = captainClient();
      const response = await api.listOwnCaptainAssignments(token);
      if (!stillCurrent()) return;
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
      if (!stillCurrent()) return;
      setTasks(Object.fromEntries(taskEntries.filter((entry): entry is readonly [string, CaptainDeliveryTask] => entry !== null)));
      const arrivalEntries = await Promise.all(response.assignments
        .filter(assignment => assignment.state === "in_custody")
        .map(async assignment => {
          try {
            const result = await api.readOwnCaptainArrival(token, assignment.id);
            return [assignment.id, Boolean(result.arrivedAt)] as const;
          } catch { return null; }
        }));
      if (stillCurrent()) setArrivalStatus(Object.fromEntries(arrivalEntries.filter((entry): entry is readonly [string, boolean] => entry !== null)));
    } catch (cause) {
      console.error("DSH Captain deliveries readback failed", cause);
      if (sequence === readSequence.current && (!quiet || !mutationInFlight.current) && (!actorID || hasCurrentDeliveryActor(actorID))) {
        setAssignments([]);
        setTasks({});
        setError("تعذر قراءة التوصيلات. أعد المحاولة.");
      }
    } finally {
      if (sequence === readSequence.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    if (!activeActorID) {
      readSequence.current += 1;
      setLoadedActorID("");
      setAssignments([]);
      setTasks({});
      setArrivalStatus({});
      setPendingCompletion(null);
      setCompletionStorageReady(false);
      setLoading(false);
      return;
    }
    void load();
  }, [activeActorID, load]);
  useEffect(() => {
    if (!isFocused || !activeActorID || loading || busy || mutationInFlight.current) return;
    const update = () => { if (AppState.currentState === "active" && !mutationInFlight.current) void load(true); };
    const timer = setInterval(update, 20_000);
    const resume = AppState.addEventListener("change", (state) => { if (state === "active") update(); });
    return () => { clearInterval(timer); resume.remove(); };
  }, [isFocused, activeActorID, loading, busy, load]);

  async function confirmArrival(assignment: CaptainAssignment) {
    if (!hasCurrentDeliveryActor(loadedActorID) || busy || mutationInFlight.current || assignment.state !== "in_custody" || arrivalStatus[assignment.id] !== false) return;
    mutationInFlight.current = true;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!hasCurrentDeliveryActor(loadedActorID)) return;
      const response = await captainClient().confirmOwnCaptainArrival(token, assignment.id);
      if (!hasCurrentDeliveryActor(loadedActorID)) return;
      if (!response.arrivedAt) throw new Error("ARRIVAL_CONFIRMATION_MISSING");
      setArrivalStatus(previous => ({ ...previous, [assignment.id]: true }));
    } catch (cause) {
      console.error("DSH captain arrival failed", cause);
      setError("تعذر تأكيد الوصول؛ تحقّق من الاتصال وحالة المهمة ثم أعد المحاولة.");
    } finally {
      mutationInFlight.current = false;
      setBusy("");
    }
  }

  async function pickup(assignment: CaptainAssignment) {
    if (!currentActorReadback || !hasCurrentDeliveryActor(loadedActorID) || busy || mutationInFlight.current || !completionStorageReady || completionStorageIssue || pendingCompletion || assignment.state !== "assigned" || !canActOnCaptainTask(assignment, tasks[assignment.id])) return;
    mutationInFlight.current = true;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!hasCurrentDeliveryActor(loadedActorID)) return;
      await captainClient().completeCaptainPickup(token, assignment.id, assignment.handoff.version);
      if (hasCurrentDeliveryActor(loadedActorID)) await load();
    } catch (cause) {
      console.error("DSH Captain pickup failed", cause);
      setError("لا يمكن تأكيد الاستلام قبل تأكيد المتجر أو عند تعارض النسخة.");
    } finally {
      mutationInFlight.current = false;
      setBusy("");
    }
  }

  async function complete(assignment: CaptainAssignment, result: "delivered" | "delivery_failed") {
    if (!currentActorReadback || !hasCurrentDeliveryActor(loadedActorID) || busy || mutationInFlight.current || !completionStorageReady || completionStorageIssue || pendingCompletion || assignment.state !== "in_custody" || !canActOnCaptainTask(assignment, tasks[assignment.id])) return;
    mutationInFlight.current = true;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !isCurrentCaptainActor(loadedActorID, identity.identity.subject.trim())) throw new Error("CAPTAIN_SESSION_REQUIRED");
      // Collection amount is canonical in DSH/WLT; the Captain only confirms the outcome.
      const request: CaptainCompletionRequest = { result };
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
      if (!hasCurrentDeliveryActor(attempt.actorID)) return;
      setPendingCompletion(attempt);
      setCompletionRejected(false);
      await captainClient().completeCaptainAssignment(token, attempt.assignmentID, attempt.request, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      if (!hasCurrentDeliveryActor(attempt.actorID)) return;
      setPendingCompletion(null);
      await load();
    } catch (cause) {
      console.error("DSH Captain completion failed", cause);
      setCompletionRejected(captainCompletionHttpRejected(cause));
      setError(captainCompletionHttpRejected(cause) ? "لم تُحدّث المهمة. تحقق منها قبل إعادة المحاولة." : "تعذر تأكيد النتيجة. بقيت المحاولة محفوظة؛ أعد المحاولة من الزر نفسه.");
    } finally {
      mutationInFlight.current = false;
      setBusy("");
    }
  }

  async function retryPendingCompletion() {
    const attempt = pendingCompletion;
    if (!currentActorReadback || !hasCurrentDeliveryActor(loadedActorID) || !attempt || !isCurrentCaptainActor(attempt.actorID, loadedActorID) || busy || mutationInFlight.current || !completionStorageReady) return;
    mutationInFlight.current = true;
    setBusy(attempt.assignmentID);
    setError("");
    setCompletionRejected(false);
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || identity.identity.subject.trim() !== attempt.actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
      await captainClient().completeCaptainAssignment(token, attempt.assignmentID, attempt.request, attempt.expectedVersion, attempt.idempotencyKey, attempt.correlationID);
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      if (!hasCurrentDeliveryActor(attempt.actorID)) return;
      setPendingCompletion(null);
      await load();
    } catch (cause) {
      console.error("DSH Captain completion recovery failed", cause);
      setCompletionRejected(captainCompletionHttpRejected(cause));
      setError(captainCompletionHttpRejected(cause) ? "لم تُحدّث المهمة. تحقق منها قبل إعادة المحاولة." : "لم نتأكد من النتيجة. بقيت المحاولة محفوظة؛ أعد المحاولة من الزر نفسه.");
    } finally {
      mutationInFlight.current = false;
      setBusy("");
    }
  }

  async function replaceRejectedCompletionAfterReadback() {
    const attempt = pendingCompletion;
    if (!currentActorReadback || !hasCurrentDeliveryActor(loadedActorID) || !attempt || !isCurrentCaptainActor(attempt.actorID, loadedActorID) || !completionRejected || busy || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(attempt.assignmentID);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || identity.identity.subject.trim() !== attempt.actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
      const response = await captainClient().listOwnCaptainAssignments(token);
      if (!hasCurrentDeliveryActor(attempt.actorID)) return;
      const current = response.assignments.find((item) => item.id === attempt.assignmentID);
      if (!current || current.state !== "in_custody" || current.version !== attempt.expectedVersion) {
        setCompletionRejected(false);
        setError("تغيرت المهمة أو تعذر إثبات بقائها دون تنفيذ؛ احتفظنا بالمحاولة الأصلية وأعد قراءتها.");
        return;
      }
      await SecureStore.deleteItemAsync(pendingCaptainCompletionKey(attempt.actorID));
      if (!hasCurrentDeliveryActor(attempt.actorID)) return;
      setPendingCompletion(null);
      setCompletionRejected(false);
      await load();
      setError("ثبت أن المحاولة لم تُنفذ وأن المهمة ما زالت في عهدتك؛ يمكنك إعادة تأكيد النتيجة.");
    } catch (cause) {
      console.error("DSH Captain completion rejection reconciliation failed", cause);
      setError("تعذر تأكيد حالة المهمة. بقيت المحاولة الأصلية محفوظة كما هي.");
    } finally {
      mutationInFlight.current = false;
      setBusy("");
    }
  }

  if (!currentActorReadback) return (
    <View style={styles.container} accessibilityLabel="التحقق من تكليفات الكابتن">
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ التحقق من تكليفات الجلسة الحالية…</Text></View> : <Text style={styles.warning}>{completionStorageIssue ? "تعذر التحقق من محاولة التسليم المحفوظة. لا ترسل تأكيدًا جديدًا؛ راجع المحاولة مع المشغل." : activeActorID ? "تعذرت قراءة تكليفات هذه الجلسة. أعد القراءة." : "سجّل الدخول لعرض التوصيلات الخاصة بك."}</Text>}
      {activeActorID && !loading ? <BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" /> : null}
    </View>
  );

  return (
    <View style={styles.container} accessibilityLabel="التوصيلات الحالية">
      <Text style={styles.readinessTitle}>التوصيلات الحالية</Text>
      {pendingCompletion ? <View style={styles.warningBox}><Text style={styles.warning}>توجد محاولة تسليم محفوظة للمهمة؛ تحقق من نتيجتها قبل إنشاء محاولة جديدة.</Text><BthwaniButton busy={busy === pendingCompletion.assignmentID} disabled={Boolean(busy) || !completionStorageReady} label="التحقق من نتيجة التسليم" onPress={() => void retryPendingCompletion()} />{completionRejected ? <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحقق من المهمة لفتح تصحيح آمن" onPress={() => void replaceRejectedCompletionAfterReadback()} variant="secondary" /> : null}</View> : null}
      {completionStorageIssue ? <Text accessibilityRole="alert" style={styles.error}>تعذر قراءة المحاولة الآمنة السابقة. لا تؤكد تسليمًا جديدًا حتى يتم التحقق تلقائيًا أو يراجع المشغل المحاولة.</Text> : null}
      {!completionStorageReady && !completionStorageIssue && !loading ? <Text accessibilityRole="alert" style={styles.warning}>تعذر التحقق من المحاولات المحفوظة؛ لن نرسل تأكيدًا حتى تنجح إعادة القراءة.</Text> : null}
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading && assignments.some((assignment) => assignment.state === "assigned" || assignment.state === "in_custody") ? <Text style={styles.muted}>يُشارك موقع المهمة مع العمليات عند فتح تطبيق الكابتن والسماح بالموقع. إذا تعذر الاتصال أو أُغلق التطبيق فقد تنقطع الإشارة.</Text> : null}
      {!loading && assignments.length > 0 ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <View style={styles.card}>
        <Text style={styles.muted}>لا توجد توصيلات حالية.</Text>
      </View> : null}
      {!loading ? assignments.map((assignment) => {
        const task = tasks[assignment.id];
        const taskReady = canActOnCaptainTask(assignment, task);
        const assignmentLabel = task ? captainAssignmentStateLabel(task.deliveryState) : captainAssignmentStateLabel(assignment.state);
        const handoffLabel = task ? captainHandoffStateLabel(task.handoffState) : captainHandoffStateLabel(assignment.handoff.state);
        const requiresCollection = task?.paymentState === "REQUIRES_COLLECTION";
        const requiresCashCollection = requiresCollection && task.amountDueMinor > 0;
        let assignmentStatusIcon: "warning" | "deliveries" = "deliveries";
        let assignmentStatusTone: "danger" | "success" | "info" = "info";
        if (assignment.state === "delivery_failed") {
          assignmentStatusIcon = "warning";
          assignmentStatusTone = "danger";
        } else if (assignment.state === "in_custody") {
          assignmentStatusTone = "success";
        }
        const completionLabel = captainCompletionActionLabel(requiresCashCollection, requiresCollection);
        return (
          <View key={assignment.id} style={styles.card}>
            <View style={styles.orderHeader}>
              <Text style={styles.cardTitle}>{task?.orderReference ? `مهمة التوصيل ${task.orderReference}` : "مهمة توصيل"}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={"محادثة الطلب "+assignment.orderId.slice(-8)}
                onPress={()=>setChatOrderId(assignment.orderId)} style={{padding:8,borderRadius:10,backgroundColor:theme.surfaceRaised}}>
                <Text style={{fontSize:19}}>💬</Text>
              </Pressable>
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
                />
                <View style={styles.row}>
                  <BthwaniButton label="الاتجاهات إلى المتجر" variant="secondary" style={styles.actionButton} onPress={() => openCaptainDirections(task.pickupOrigin.latitude, task.pickupOrigin.longitude)} />
                  <BthwaniButton label="الاتجاهات إلى العميل" variant="secondary" style={styles.actionButton} onPress={() => openCaptainDirections(task.customerDestination.latitude, task.customerDestination.longitude)} />
                </View>
                <Text style={styles.muted}>الملاحة تستخدم موقع جهازك ولا تشارك مسارك المباشر مع العميل.</Text>
                <Text style={styles.muted}>حالة الطلب: {orderStateLabel(task.orderState)}</Text>
                <Text style={styles.payment}>{paymentMethodLabel(task.paymentMethod, task.fulfillmentMode, task.amountDueMinor)} · {paymentStateLabel(task.paymentState, task.paymentMethod, task.fulfillmentMode, task.amountDueMinor)}</Text>
                {task.fulfillmentMode === "BTHWANI_CAPTAIN" ? <Text style={task.deliveryFeeMinor === 0 ? styles.warning : styles.payment}>أجرة التوصيل المستحقة: {task.deliveryFeeMinor === undefined ? "جارٍ التحقق من WLT" : formatMoney(task.deliveryFeeMinor, task.currency)}. تُضاف لمحفظتك بعد إغلاق التسوية.</Text> : <Text style={styles.muted}>أجرة كابتن المتجر تُحدَّد وفق اتفاقه المباشر مع المتجر.</Text>}
                {requiresCashCollection ? (
                  <>
                    <Text style={styles.warning}>{task.fulfillmentMode === "PARTNER_CAPTAIN" ? "المبلغ الذي ستستلمه من العميل ثم تسلّمه للمتجر:" : "المطلوب تحصيله عند التسليم:"} {formatMoney(task.amountDueMinor, task.currency)}</Text>
                    <Text style={styles.muted}>هذا المبلغ مثبت في الطلب ولا يمكن تغييره هنا. تأكد من استلامه نقدًا قبل تأكيد التسليم.</Text>
                  </>
                ) : null}
                {requiresCollection && task.amountDueMinor === 0 ? <Text style={styles.muted}>غطّى رصيد العميل كامل الطلب؛ لا تستلم نقدًا. ستتم التسوية المالية عند تأكيد التسليم.</Text> : null}
                {assignment.state === "in_custody" ? <Text style={styles.muted}>أكد التسليم بعد تسليم الطلب للمستلم. سيحفظ النظام هويتك ووقت التأكيد ويمكن للعميل الإبلاغ عن عدم الاستلام.</Text> : null}
                <Text style={task.deliveryState === "delivery_failed" ? styles.warning : styles.progress}>{captainTaskProgressLabel(task)}</Text>
              </View>
            ) : <Text style={styles.warning}>تعذر قراءة تفاصيل المهمة. ستُعاد القراءة تلقائيًا قبل إتاحة إجراء جديد.</Text>}
            {!taskReady && task ? <Text style={styles.warning}>تغيرت حالة المهمة؛ يجري التحقق منها تلقائيًا قبل إتاحة إجراء جديد.</Text> : null}
            {assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy) || !completionStorageReady || Boolean(pendingCompletion) || !taskReady} label="تأكيد استلام الطلب" onPress={() => void pickup(assignment)} /> : null}
            {assignment.state === "assigned" && assignment.handoff.state === "pending" ? <Text style={styles.muted}>بانتظار تأكيد المتجر قبل الاستلام.</Text> : null}
            {assignment.state === "in_custody" && arrivalStatus[assignment.id] === false && !pendingCompletion
              ? <BthwaniButton label="وصلت إلى موقع التسليم" variant="secondary" disabled={Boolean(busy) || !taskReady} busy={busy === assignment.id} onPress={() => void confirmArrival(assignment)} />
              : null}
            {assignment.state === "in_custody" && arrivalStatus[assignment.id] === true
              ? <Text style={styles.progress}>تم إبلاغ العميل بوصولك</Text> : null}
            {assignment.state === "in_custody" && pendingCompletion?.assignmentID === assignment.id ? <Text style={styles.warning}>يُحسم هذا الإجراء من المحاولة المحفوظة أعلاه.</Text> : null}
            {assignment.state === "in_custody" && !pendingCompletion ? (
              <View style={styles.row}>
                <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy) || !completionStorageReady || completionStorageIssue || !taskReady} label={completionLabel} onPress={() => void complete(assignment, "delivered")} style={styles.actionButton} />
                <BthwaniButton disabled={Boolean(busy) || !completionStorageReady || completionStorageIssue || !taskReady} label="تعذر التسليم" onPress={() => void complete(assignment, "delivery_failed")} style={styles.actionButton} variant="danger" />
              </View>
            ) : null}
            {assignment.state === "delivery_failed" ? <View style={styles.warningBox}><Text style={styles.warning}>يبقى الطلب في عهدتك حتى يعالج المشغل التعذر؛ لن تُفتح لك مهمة جديدة قبل الاسترداد.</Text></View> : null}
            <BthwaniOrderChatSheet visible={chatOrderId===assignment.orderId} onClose={()=>setChatOrderId("")}
              orderReference={task?.orderReference ?? assignment.orderId.slice(-8)} status={assignmentLabel}
              summary={task?.storeName ?? "طلب توصيل"}>
              {chatOrderId===assignment.orderId?<OrderConversation orderId={assignment.orderId}/>:null}
            </BthwaniOrderChatSheet>
          </View>
        );
      }) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function captainCompletionActionLabel(requiresCashCollection: boolean, requiresCollection: boolean): string {
  if (requiresCashCollection) return "تحصيل النقد وتأكيد التسليم";
  if (requiresCollection) return "تأكيد التسليم وتسوية الرصيد";
  return "تأكيد التسليم";
}
