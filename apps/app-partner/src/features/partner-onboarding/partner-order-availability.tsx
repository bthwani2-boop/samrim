import { radius, spacing, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type PartnerStoreOperationalAvailabilityResponse, type StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";
import { onStoreAvailabilityChanged, signalStoreAvailabilityChanged } from "./store-availability-events";

type UpdateAttempt = Readonly<{ input: StoreOperationalAvailabilityRequest; idempotencyKey: string; correlationID: string }>;
type AvailabilityRead = "loading" | "error" | PartnerStoreOperationalAvailabilityResponse;

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" ? value.status : null;
}

/** Orderability is read from its canonical owner; the status card opens operational settings.
 * Resume keeps the existing idempotent update/recovery flow. */
export function PartnerOrderAvailability({ storeID, published }: { storeID: string; published: boolean }) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => StyleSheet.create({ pill: { minHeight: 30, maxWidth: 156, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 }, label: { ...typography.caption, fontWeight: "800" } }), []);
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
    const stopListening = onStoreAvailabilityChanged(storeID, () => void readAvailability());
    const poll = setInterval(() => {
      if (AppState.currentState === "active") void readAvailability();
    }, 60_000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void readAvailability();
    });
    return () => {
      clearInterval(poll);
      stopListening();
      subscription.remove();
      generation.current += 1;
    };
  }, [readAvailability]));

  const ready = typeof status === "object";
  const paused = ready && status.availability.paused &&
    (!status.availability.pauseUntil || Date.parse(status.availability.pauseUntil) > Date.now());
  const accepting = ready && status.orderabilityByMode.some((item) => item.state === "OPEN_FOR_ORDERS");

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
      signalStoreAvailabilityChanged(storeID);
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

  const stable = status !== "loading" && status !== "error";
  const openModes = ready ? status.orderabilityByMode.filter((mode) => mode.state === "OPEN_FOR_ORDERS").length : 0;
  const totalModes = ready ? status.orderabilityByMode.length : 0;
  const label = error ? "تعذر الاستئناف" : status === "loading" ? "جارٍ التحقق" : status === "error" || readError ? "حالة غير مؤكدة" : !published ? "غير منشور" : paused ? "متوقف" : accepting ? (openModes < totalModes ? `مفتوح ${openModes}/${totalModes}` : "مفتوح") : "مغلق";
  const tone = status === "loading" || status === "error" || readError ? theme.warning : published && accepting && !paused ? theme.success : theme.warning;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={paused ? "استئناف استقبال الطلبات" : stable && !readError ? "المتجر " + label + "، إدارة التشغيل" : "إعادة قراءة حالة المتجر"}
    accessibilityState={{ disabled: busy }}
    disabled={busy}
    onPress={() => {
      if (paused) void resumeOrders();
      else if (status === "error" || readError || status === "loading") void readAvailability();
      else router.push({ pathname: "/store", params: { section: "operations" } } as Href);
    }}
    style={[styles.pill, { borderColor: tone, backgroundColor: theme.surface }]}
  >
    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone }} />
    <Text numberOfLines={1} style={[styles.label, { color: tone }]}>{busy ? "جارٍ التحديث" : label}</Text>
  </Pressable>;
}
