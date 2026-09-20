import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CaptainAssignment, type CaptainDeliveryTask, captainAssignmentStateLabel, captainHandoffStateLabel, captainTaskProgressLabel, formatMoney, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";

export function CaptainDeliveries() {
const theme = useAppearanceTheme();
  const styles = useMemo(() => createCaptainOperationStyles(theme), [theme]);
  const [assignments, setAssignments] = useState<ReadonlyArray<CaptainAssignment>>([]);
  const [tasks, setTasks] = useState<Readonly<Record<string, CaptainDeliveryTask>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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
    } catch (cause) {
      console.error("DSH Captain deliveries readback failed", cause);
      setError("تعذر قراءة التوصيلات. أعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  async function complete(assignment: CaptainAssignment, result: "delivered" | "delivery_failed") {
    if (busy || assignment.state !== "in_custody") return;
    setBusy(assignment.id);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await captainClient().completeCaptainAssignment(token, assignment.id, { result }, assignment.version);
      await load();
    } catch (cause) {
      console.error("DSH Captain completion failed", cause);
      setError("تعذر تسجيل النتيجة النهائية. أعد القراءة قبل المحاولة.");
    } finally {
      setBusy("");
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="التوصيلات الحالية">
      <Text style={styles.title}>التوصيلات الحالية</Text>
      <Text style={styles.muted}>رتّب عملك من الاستلام إلى التسليم، وتعرّف على العائق قبل بدء الإجراء.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <Text style={styles.muted}>لا توجد تكليفات.</Text> : null}
      {!loading ? assignments.map((assignment) => { const task = tasks[assignment.id]; const assignmentLabel = task ? captainAssignmentStateLabel(task.deliveryState) : captainAssignmentStateLabel(assignment.state); const handoffLabel = task ? captainHandoffStateLabel(task.handoffState) : captainHandoffStateLabel(assignment.handoff.state); const requiresCollection = task?.paymentState === "REQUIRES_COLLECTION"; return <View key={assignment.id} style={styles.card}><View style={styles.orderHeader}><Text style={styles.cardTitle}>{task?.orderReference ? `مهمة التوصيل ${task.orderReference}` : "مهمة توصيل"}</Text><BthwaniStatusBadge icon={assignment.state === "delivery_failed" ? "warning" : "deliveries"} label={assignmentLabel} tone={assignment.state === "delivery_failed" ? "danger" : assignment.state === "in_custody" ? "success" : "info"} /></View><BthwaniStatusBadge icon={assignment.handoff.state === "completed" ? "success" : "store"} label={`التسليم من المتجر: ${handoffLabel}`} tone={assignment.handoff.state === "completed" ? "success" : "warning"} />{task ? <View style={styles.task}><Text style={styles.muted}>المتجر: {task.storeName}</Text><Text style={styles.muted}>عنوان العميل: {task.customerAddressText}</Text><Text style={styles.muted}>حالة الطلب: {orderStateLabel(task.orderState)}</Text><Text style={styles.payment}>{paymentMethodLabel(task.paymentMethod)} · {paymentStateLabel(task.paymentState)}</Text>{requiresCollection ? <Text style={styles.warning}>المطلوب تحصيله عند التسليم: {formatMoney(task.amountDueMinor, task.currency)}</Text> : null}<Text style={task.deliveryState === "delivery_failed" ? styles.warning : styles.progress}>{captainTaskProgressLabel(task)}</Text></View> : <Text style={styles.muted}>جارٍ تجهيز تفاصيل المهمة.</Text>}{assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy)} label="تأكيد استلام الطلب" onPress={() => void pickup(assignment)} /> : null}{assignment.state === "assigned" && assignment.handoff.state === "pending" ? <Text style={styles.muted}>بانتظار تأكيد المتجر قبل الاستلام.</Text> : null}{assignment.state === "in_custody" ? <View style={styles.row}><BthwaniButton busy={busy === assignment.id} disabled={Boolean(busy)} label={requiresCollection ? "تحصيل المبلغ وتأكيد التسليم" : "تأكيد التسليم"} onPress={() => void complete(assignment, "delivered")} style={styles.actionButton} /><BthwaniButton disabled={Boolean(busy)} label="تعذر التسليم" onPress={() => void complete(assignment, "delivery_failed")} style={styles.actionButton} variant="danger" /></View> : null}{assignment.state === "delivery_failed" ? <View style={styles.warningBox}><Text style={styles.warning}>يبقى الطلب في عهدتك حتى يعالج المشغل التعذر؛ لن تُفتح لك مهمة جديدة قبل الاسترداد.</Text></View> : null}</View>; }) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton busy={Boolean(busy)} disabled={Boolean(busy)} label="تحديث التوصيلات" onPress={() => void load()} variant="secondary" />
    </View>
  );
}
