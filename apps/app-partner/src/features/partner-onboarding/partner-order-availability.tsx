import { radius, typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreOperationalAvailabilityRequest } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { onStoreAvailabilityChanged, signalStoreAvailabilityChanged } from "./store-availability-events";
import { readOwnStoreOperationalAvailability, updateOwnStoreOperationalAvailability } from "./store-readback-client";

type UpdateAttempt = Readonly<{ input: StoreOperationalAvailabilityRequest; idempotencyKey: string; correlationID: string }>;
type AvailabilityRead = "loading" | "error" | PartnerStoreOperationalAvailabilityResponse;

function httpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { kind?: unknown; status?: unknown };
  return value.kind === "http" && typeof value.status === "number" ? value.status : null;
}

function isOwnStoreReadback(value: PartnerStoreOperationalAvailabilityResponse, storeID: string): boolean {
  return value?.availability?.storeId === storeID &&
    Array.isArray(value.orderabilityByMode) &&
    value.orderabilityByMode.every((mode) => mode?.storeId === storeID);
}

/** Read and resume DSH Store availability for one Store and one Identity session.
 * Uncertain writes retain their original idempotency key only inside that session. */
export function PartnerOrderAvailability({ storeID, published }: { storeID: string; published: boolean }) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const styles = useMemo(() => StyleSheet.create({ pill: { minHeight: 30, maxWidth: 156, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 9 }, label: { ...typography.caption, fontWeight: "800" } }), []);
  const [status, setStatus] = useState<AvailabilityRead>("loading");
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<UpdateAttempt | null>(null);
  const [sessionScope, setSessionScope] = useState(() => partnerSetupSessionKey(currentIdentityState()));
  const activeScope = useRef(sessionScope);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const stillCurrentSession = useCallback(
    () => Boolean(sessionScope) && sessionScope === partnerSetupSessionKey(currentIdentityState()),
    [sessionScope],
  );

  useEffect(() => subscribeIdentitySession((next) => {
    const nextScope = partnerSetupSessionKey(next);
    if (nextScope === activeScope.current) return;
    activeScope.current = nextScope;
    generation.current += 1;
    busyRef.current = false;
    setStatus("loading");
    setReadError(false);
    setBusy(false);
    setError("");
    setPending(null);
    setSessionScope(nextScope);
  }), []);

  const readAvailability = useCallback(async () => {
    if (busyRef.current || !stillCurrentSession()) return;
    const current = ++generation.current;
    try {
      const confirmed = await readOwnStoreOperationalAvailability(storeID);
      if (current !== generation.current || !stillCurrentSession()) return;
      if (!isOwnStoreReadback(confirmed, storeID)) throw new Error("WRONG_STORE_AVAILABILITY");
      setStatus(confirmed);
      setReadError(false);
      if (!confirmed.availability.paused) setPending(null);
    } catch {
      if (current !== generation.current || !stillCurrentSession()) return;
      setStatus((previous) => previous === "loading" ? "error" : previous);
      setReadError(true);
    }
  }, [storeID, stillCurrentSession]);

  useFocusEffect(useCallback(() => {
    setStatus("loading");
    setReadError(false);
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
      busyRef.current = false;
      setBusy(false);
    };
  }, [readAvailability, storeID]));

  const scopeCurrent = stillCurrentSession();
  const ready = scopeCurrent && !readError && typeof status === "object";
  const paused = ready && status.availability.paused &&
    (!status.availability.pauseUntil || Date.parse(status.availability.pauseUntil) > Date.now());
  const accepting = ready && status.orderabilityByMode.some((item) => item.state === "OPEN_FOR_ORDERS");

  async function resumeOrders() {
    if (!scopeCurrent || !ready || !paused || busyRef.current) return;
    const current = ++generation.current;
    const isCurrent = () => current === generation.current && stillCurrentSession();
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
      idempotencyKey: `partner_resume_${Crypto.randomUUID()}`,
      correlationID: `partner_resume_corr_${Crypto.randomUUID()}`,
    };
    setPending(attempt);
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (!isCurrent()) return;
      await updateOwnStoreOperationalAvailability(storeID, attempt.input, attempt.idempotencyKey, attempt.correlationID);
      if (!isCurrent()) return;
      const confirmed = await readOwnStoreOperationalAvailability(storeID);
      if (!isCurrent()) return;
      if (!isOwnStoreReadback(confirmed, storeID)) throw new Error("WRONG_STORE_AVAILABILITY");
      setStatus(confirmed);
      setReadError(false);
      setPending(null);
      signalStoreAvailabilityChanged(storeID);
    } catch (cause) {
      if (!isCurrent()) return;
      const code = httpStatus(cause);
      try {
        const confirmed = await readOwnStoreOperationalAvailability(storeID);
        if (!isCurrent()) return;
        if (!isOwnStoreReadback(confirmed, storeID)) throw new Error("WRONG_STORE_AVAILABILITY");
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
        if (!isCurrent()) return;
        setReadError(true);
      }
      if (!isCurrent()) return;
      if (code !== null && code < 500) {
        setPending(null);
        setError("تعذر استئناف الطلبات. تحقق من صلاحيتك وحاول مجددًا.");
      } else {
        setError("لم نتأكد من الاستئناف. أعد المحاولة للتحقق من الطلب المحفوظ نفسه.");
      }
    } finally {
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  const openModes = ready ? status.orderabilityByMode.filter((mode) => mode.state === "OPEN_FOR_ORDERS").length : 0;
  const totalModes = ready ? status.orderabilityByMode.length : 0;
  const label = !scopeCurrent ? "جارٍ التحقق" : error ? "تعذر الاستئناف" : status === "loading" ? "جارٍ التحقق" : status === "error" || readError ? "حالة غير مؤكدة" : !published ? "غير منشور" : paused ? "متوقف" : accepting ? (openModes < totalModes ? `مفتوح ${openModes}/${totalModes}` : "مفتوح") : "مغلق";
  const tone = !scopeCurrent || status === "loading" || status === "error" || readError ? theme.warning : published && accepting && !paused ? theme.success : theme.warning;
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={paused ? "استئناف استقبال الطلبات" : ready ? `المتجر ${label}، إدارة التشغيل` : "إعادة قراءة حالة المتجر"}
    accessibilityState={{ disabled: busy || !scopeCurrent }}
    disabled={busy || !scopeCurrent}
    onPress={() => {
      if (!stillCurrentSession()) return;
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
