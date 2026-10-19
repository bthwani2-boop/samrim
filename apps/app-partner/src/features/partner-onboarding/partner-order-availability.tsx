import { BthwaniButton, BthwaniStatusBadge, useAppearanceTheme } from "@bthwani/design-system/native";
import { type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

type UpdateAttempt = Readonly<{ input: StoreOperationalAvailabilityRequest; idempotencyKey: string; correlationID: string }>;

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" ? value.status : null;
}

export function PartnerOrderAvailability({ storeID }: { storeID: string }) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [status, setStatus] = useState<"loading" | "error" | PartnerStoreOperationalAvailabilityResponse>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<UpdateAttempt | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setStatus("loading");
    void readOwnStoreOperationalAvailability(storeID).then((value) => {
      if (active) setStatus(value);
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [storeID]));

  const ready = typeof status === "object";
  const paused = ready && status.availability.paused;
  const accepting = ready && status.orderabilityByMode.some((item) => item.state === "OPEN_FOR_ORDERS");
  const label = status === "loading" ? "جارٍ قراءة الحالة"
    : status === "error" ? "تعذر قراءة التوفر"
    : paused ? "متوقف مؤقتًا"
    : accepting ? "يستقبل الطلبات"
    : status.orderabilityByMode.some((item) => item.state === "CLOSED_BY_SCHEDULE") ? "مغلق حسب ساعات العمل"
    : "غير متاح حاليًا";

  async function updatePause(nextPaused: boolean) {
    if (!ready || busy) return;
    const availability = status.availability;
    const attempt = pending ?? {
      input: {
        scheduleMode: availability.scheduleMode,
        weeklySchedule: availability.weeklySchedule,
        paused: nextPaused,
        pauseReason: nextPaused ? "إيقاف استقبال الطلبات بطلب الشريك" : null,
        pauseUntil: null,
        preparationMinutes: availability.preparationMinutes ?? null,
        unavailableFulfillmentModes: availability.unavailableFulfillmentModes,
        expectedVersion: availability.version,
      },
      idempotencyKey: "partner_quick_pause_" + Crypto.randomUUID(),
      correlationID: "partner_quick_pause_corr_" + Crypto.randomUUID(),
    };
    setPending(attempt);
    setBusy(true);
    setError("");
    try {
      await updateOwnStoreOperationalAvailability(storeID, attempt.input, attempt.idempotencyKey, attempt.correlationID);
      const confirmed = await readOwnStoreOperationalAvailability(storeID);
      setStatus(confirmed);
      setPending(null);
    } catch (cause) {
      const code = httpStatus(cause);
      try {
        const confirmed = await readOwnStoreOperationalAvailability(storeID);
        setStatus(confirmed);
        if (code === 409 || confirmed.availability.paused === attempt.input.paused) {
          setPending(null);
          if (code === 409 && confirmed.availability.paused !== attempt.input.paused) setError("تغيرت الحالة من جهاز آخر؛ راجع الحالة الحالية قبل التعديل.");
          return;
        }
      } catch { /* Keep the last confirmed value visible until retry. */ }
      if (code !== null && code < 500) {
        setPending(null);
        setError("لم يُقبل تغيير التوفر. راجع صلاحياتك وحاول مجددًا.");
      } else {
        setError("تعذر تأكيد التغيير. أعد المحاولة من المفتاح نفسه.");
      }
    } finally {
      setBusy(false);
    }
  }

  function togglePause(nextPaused: boolean) {
    if (!ready || busy) return;
    if (pending) { void updatePause(pending.input.paused); return; }
    if (!nextPaused) { void updatePause(false); return; }
    Alert.alert("إيقاف استقبال الطلبات", "سيُوقف استقبال الطلبات الجديدة حتى تستأنف يدويًا. لن يتغير جدول الساعات.", [
      { text: "إلغاء", style: "cancel" },
      { text: "إيقاف مؤقت", style: "destructive", onPress: () => void updatePause(true) },
    ]);
  }

  return <View style={{ gap: 6 }}>
    <View style={[styles.headerRow, { alignItems: "center" }]} accessibilityLabel="حالة استقبال الطلبات">
      <View style={styles.headerCopy}>
        <Text style={styles.metaLabel}>استقبال الطلبات</Text>
        <BthwaniStatusBadge icon={accepting ? "success" : "warning"} label={label} tone={accepting ? "success" : "warning"} />
      </View>
      <View style={{ alignItems: "center", gap: 2 }}>
        <Switch accessibilityLabel="إيقاف استقبال الطلبات مؤقتًا" accessibilityHint="التشغيل لا يغيّر جدول ساعات العمل" disabled={!ready || busy} onValueChange={togglePause} value={ready && paused} />
        <Text style={styles.metaLabel}>إيقاف مؤقت</Text>
      </View>
      <BthwaniButton disabled={busy} label="الساعات" variant="secondary" onPress={() => router.push({ pathname: "/store", params: { section: "operations" } } as Href)} />
    </View>
    {pending ? <Text style={styles.muted}>يوجد تغيير لم نتأكد من نتيجته. اضغط المفتاح لإعادة محاولة الحفظ نفسها.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
