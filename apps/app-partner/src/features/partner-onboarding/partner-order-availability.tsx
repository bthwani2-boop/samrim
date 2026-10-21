import { radius, spacing } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";

type UpdateAttempt = Readonly<{ input: StoreOperationalAvailabilityRequest; idempotencyKey: string; correlationID: string }>;
type AvailabilityRead = "loading" | "error" | PartnerStoreOperationalAvailabilityResponse;

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" ? value.status : null;
}

/** Routine order work has no operating-hours link or pause toggle.
 * Only exceptions that prevent receiving new orders appear above the queue. */
export function PartnerOrderAvailability({ storeID }: { storeID: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [status, setStatus] = useState<AvailabilityRead>("loading");
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<UpdateAttempt | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);

  const readAvailability = useCallback(async () => {
    if (busyRef.current) return;
    const current = ++generation.current;
    try {
      const confirmed = await readOwnStoreOperationalAvailability(storeID);
      if (current !== generation.current) return;
      setStatus(confirmed);
      setReadError(false);
    } catch {
      if (current !== generation.current) return;
      setStatus((previous) => previous === "loading" ? "error" : previous);
      setReadError(true);
    }
  }, [storeID]);

  useFocusEffect(useCallback(() => {
    void readAvailability();
    const poll = setInterval(() => {
      if (AppState.currentState === "active") void readAvailability();
    }, 60_000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void readAvailability();
    });
    return () => {
      clearInterval(poll);
      subscription.remove();
      generation.current += 1;
    };
  }, [readAvailability]));

  const ready = typeof status === "object";
  const paused = ready && status.availability.paused &&
    (!status.availability.pauseUntil || Date.parse(status.availability.pauseUntil) > Date.now());
  const accepting = ready && status.orderabilityByMode.some((item) => item.state === "OPEN_FOR_ORDERS");
  const scheduledClosed = ready && status.orderabilityByMode.some((item) => item.state === "CLOSED_BY_SCHEDULE");
  const operationallyUnavailable = ready && status.orderabilityByMode.some((item) => item.state === "OPERATIONALLY_UNAVAILABLE");

  async function resumeOrders() {
    if (!ready || !paused || busyRef.current) return;
    const availability = status.availability;
    const attempt = pending ?? {
      input: {
        scheduleMode: availability.scheduleMode,
        weeklySchedule: availability.weeklySchedule,
        paused: false,
        pauseReason: null,
        pauseUntil: null,
        preparationMinutes: availability.preparationMinutes ?? null,
        unavailableFulfillmentModes: availability.unavailableFulfillmentModes,
        expectedVersion: availability.version,
      },
      idempotencyKey: "partner_resume_" + Crypto.randomUUID(),
      correlationID: "partner_resume_corr_" + Crypto.randomUUID(),
    };
    setPending(attempt);
    busyRef.current = true;
    generation.current += 1;
    setBusy(true);
    setError("");
    try {
      await updateOwnStoreOperationalAvailability(storeID, attempt.input, attempt.idempotencyKey, attempt.correlationID);
      const confirmed = await readOwnStoreOperationalAvailability(storeID);
      setStatus(confirmed);
      setReadError(false);
      setPending(null);
    } catch (cause) {
      const code = httpStatus(cause);
      try {
        const confirmed = await readOwnStoreOperationalAvailability(storeID);
        setStatus(confirmed);
        setReadError(false);
        if (!confirmed.availability.paused) {
          setPending(null);
          return;
        }
        if (code === 409) {
          setPending(null);
          setError("تغيّرت حالة المتجر من جهاز آخر. راجع الحالة الظاهرة.");
          return;
        }
      } catch {
        setReadError(true);
      }
      if (code !== null && code < 500) {
        setPending(null);
        setError("تعذر استئناف الطلبات. تحقق من صلاحيتك وحاول مجددًا.");
      } else {
        setError("لم نتأكد من الاستئناف. أعد المحاولة للتحقق من الطلب المحفوظ نفسه.");
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (status === "loading") return null;
  if (status === "error") return <View style={{ gap: spacing[1] }}>
    <Text accessibilityRole="alert" style={styles.error}>تعذر التحقق من استقبال الطلبات.</Text>
    <BthwaniButton variant="secondary" label="إعادة المحاولة" onPress={() => void readAvailability()} />
  </View>;

  if (!paused && accepting && !readError) return null;

  return <View accessibilityLabel="حالة استقبال الطلبات" style={{
    backgroundColor: theme.surfaceInset, borderRadius: radius.md,
    padding: spacing[3], gap: spacing[2],
  }}>
    {paused ? <View style={[styles.headerRow, { alignItems: "center" }]}>
      <View style={[styles.headerCopy, { flex: 1 }]}>
        <Text style={styles.value}>المتجر متوقف مؤقتًا</Text>
        <Text style={styles.muted}>لن تصل طلبات جديدة حتى الاستئناف</Text>
      </View>
      <BthwaniButton
        label={pending ? "التحقق من الاستئناف" : "استئناف الطلبات"}
        disabled={busy}
        busy={busy}
        variant="secondary"
        onPress={() => void resumeOrders()}
      />
    </View> : <Text style={styles.muted}>
      {accepting ? "تعذر تحديث حالة الاستقبال؛ آخر حالة مؤكدة: يستقبل الطلبات." :
        scheduledClosed ? "المتجر مغلق حسب ساعات العمل" :
        operationallyUnavailable ? "استقبال الطلبات غير متاح حاليًا" :
          "لا يستقبل المتجر طلبات جديدة حاليًا"}
    </Text>}
    {readError ? <BthwaniButton label="إعادة المحاولة" variant="quiet" onPress={() => void readAvailability()} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}
