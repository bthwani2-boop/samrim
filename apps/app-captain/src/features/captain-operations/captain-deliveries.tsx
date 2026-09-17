import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, useColorScheme, View } from "react-native";

import { resolveTheme } from "@bthwani/design-system";
import { captainAssignmentStateLabel, captainHandoffStateLabel, captainTaskProgressLabel, orderStateLabel, type CaptainAssignment, type CaptainDeliveryTask } from "@bthwani/dsh";

import { getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { captainClient } from "./captain-client";
import { createCaptainOperationStyles } from "./captain-operation-styles";

export function CaptainDeliveries() {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
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
      <Text style={styles.muted}>تفاصيل المهمة تُقرأ عند فتح هذا المسار فقط.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ القراءة…</Text></View> : null}
      {!loading ? <Text style={styles.sectionTitle}>التكليفات ({assignments.length})</Text> : null}
      {!loading && !assignments.length ? <Text style={styles.muted}>لا توجد تكليفات.</Text> : null}
      {!loading ? assignments.map((assignment) => { const task = tasks[assignment.id]; const assignmentLabel = task ? captainAssignmentStateLabel(task.deliveryState) : captainAssignmentStateLabel(assignment.state); const handoffLabel = task ? captainHandoffStateLabel(task.handoffState) : captainHandoffStateLabel(assignment.handoff.state); return <View key={assignment.id} style={styles.card}><Text style={styles.cardTitle}>{task?.orderReference ? `مهمة التوصيل ${task.orderReference}` : "مهمة توصيل"}</Text><Text style={styles.muted}>الحالة: {assignmentLabel} · تسليم المتجر: {handoffLabel}</Text>{task ? <View style={styles.task}><Text style={styles.muted}>المتجر: {task.storeName}</Text><Text style={styles.muted}>عنوان العميل: {task.customerAddressText}</Text><Text style={styles.muted}>حالة الطلب: {orderStateLabel(task.orderState)}</Text><Text style={task.deliveryState === "delivery_failed" ? styles.warning : styles.progress}>{captainTaskProgressLabel(task)}</Text></View> : <Text style={styles.muted}>جارٍ قراءة تفاصيل المهمة من المنصة.</Text>}{assignment.state === "assigned" && assignment.handoff.state === "store_confirmed" ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void pickup(assignment)} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === assignment.id ? "جارٍ الحفظ…" : "تأكيد استلام الطلب"}</Text></Pressable> : null}{assignment.state === "assigned" && assignment.handoff.state === "pending" ? <Text style={styles.muted}>لا يمكن الاستلام قبل تأكيد المتجر.</Text> : null}{assignment.state === "in_custody" ? <View style={styles.row}><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void complete(assignment, "delivered")} style={[styles.button, busy && styles.disabledButton]}><Text style={styles.buttonText}>{busy === assignment.id ? "جارٍ الحفظ…" : "تأكيد التسليم"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void complete(assignment, "delivery_failed")} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تعذر التسليم</Text></Pressable></View> : null}{assignment.state === "delivery_failed" ? <View style={styles.warningBox}><Text style={styles.warning}>هذا الطلب ما زال في عهدتك. لا يمكنك استقبال مهمة جديدة حتى يعالج المشغل حالة التعذر.</Text></View> : null}</View>; }) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => void load()} style={[styles.secondaryButton, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>تحديث التوصيلات</Text></Pressable>
    </View>
  );
}
