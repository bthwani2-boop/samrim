import { type CustomerCartDirectory, DshPublicError } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { readVerifiedCartDirectory, verifyCartDirectorySession } from "../cart/cart-directory-transport";

type Context = { after: string | undefined; actor: string | undefined };
type State =
  | { kind: "loading" | "hidden" | "signed-out" }
  | { kind: "unavailable"; context: Context }
  | { kind: "ready"; page: CustomerCartDirectory; after: string | undefined };

const PAGE_READ_TIMEOUT = 12_000;
const SESSION_POLL_INTERVAL = 15_000;
const SESSION_POLL_TIMEOUT = 5_000;
const MAX_TIMER = 2_147_483_647;

type ReadLease = {
  controller: AbortController;
  expiresAt: number;
  schedule: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer: (timer: ReturnType<typeof setTimeout>) => void;
};

function newReadLease(): ReadLease {
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  controller.signal.addEventListener("abort", () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }, { once: true });
  return {
    controller,
    expiresAt: 0,
    schedule(action, delay) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!controller.signal.aborted) action();
      }, delay);
      timers.add(timer);
      return timer;
    },
    cancelTimer(timer) {
      clearTimeout(timer);
      timers.delete(timer);
    },
  };
}

function foreground(): boolean {
  return Platform.OS === "web"
    ? typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus()
    : AppState.currentState === "active";
}

/** Read-only DSH cart directory. A page is visible only under its current verified owner lease. */
export default function MultiStoreCheckoutScreen() {
  const { theme } = useMobileAppearance();
  const [state, setState] = useState<State>({ kind: "hidden" });
  const current = useRef<State>({ kind: "hidden" });
  const active = useRef<ReadLease | null>(null);
  const focused = useRef(false);

  const publish = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);
  const stop = useCallback(() => {
    const previous = active.current;
    active.current = null;
    previous?.controller.abort();
  }, []);
  const conceal = useCallback(() => {
    stop();
    publish({ kind: "hidden" });
  }, [publish, stop]);

  const load = useCallback((after?: string, actor?: string) => {
    if (!focused.current || !foreground()) {
      conceal();
      return;
    }
    stop();
    const lease = newReadLease();
    const signal = lease.controller.signal;
    active.current = lease;
    publish({ kind: "loading" });
    let context: Context = { after, actor };

    function ownsLease() {
      return active.current === lease && !signal.aborted;
    }
    function canPublish() {
      if (!ownsLease()) return false;
      if (!focused.current || !foreground()) {
        conceal();
        return false;
      }
      return true;
    }
    function end(next: State) {
      if (ownsLease()) {
        stop();
        publish(next);
      }
    }
    const unavailable = () => end({ kind: "unavailable", context });
    const expired = () => end({ kind: "signed-out" });
    function reject(error: unknown) {
      if (!canPublish()) return;
      if (error instanceof DshPublicError && error.status === 401) expired();
      else unavailable();
    }

    const readDeadline = lease.schedule(unavailable, PAGE_READ_TIMEOUT);
    void readVerifiedCartDirectory(signal, after, actor).then(result => {
      lease.cancelTimer(readDeadline);
      if (!canPublish()) return;
      if (actor !== undefined && result.value.actorId !== actor) {
        expired();
        return;
      }
      context = { after, actor: result.value.actorId };
      if (!Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
        expired();
        return;
      }
      lease.expiresAt = result.expiresAt;
      publish({ kind: "ready", page: result.value, after });

      // Keep every timer and pending operation under the same cancellable
      // lease. A shorter verified grant can reduce, never extend, visibility.
      let expiryTimer: ReturnType<typeof setTimeout> | undefined;
      function armExpiry() {
        if (expiryTimer !== undefined) lease.cancelTimer(expiryTimer);
        if (!canPublish()) return;
        const remaining = lease.expiresAt - Date.now();
        if (remaining <= 0) {
          expired();
          return;
        }
        expiryTimer = lease.schedule(armExpiry, Math.min(MAX_TIMER, remaining));
      }
      function poll() {
        if (!canPublish()) return;
        if (lease.expiresAt <= Date.now()) {
          expired();
          return;
        }
        const deadline = lease.schedule(unavailable, SESSION_POLL_TIMEOUT);
        void verifyCartDirectorySession(signal, result.value.actorId).then(session => {
          lease.cancelTimer(deadline);
          if (!canPublish()) return;
          const until = Date.parse(session.sessionExpiresAt);
          if (session.actorId !== result.value.actorId || session.role !== "customer" ||
              !Number.isFinite(until) || until <= Date.now()) {
            expired();
            return;
          }
          lease.expiresAt = Math.min(lease.expiresAt, until);
          armExpiry();
          if (ownsLease()) lease.schedule(poll, SESSION_POLL_INTERVAL);
        }).catch(error => {
          lease.cancelTimer(deadline);
          reject(error);
        });
      }
      armExpiry();
      if (ownsLease()) lease.schedule(poll, SESSION_POLL_INTERVAL);
    }).catch(error => {
      lease.cancelTimer(readDeadline);
      reject(error);
    });
  }, [conceal, publish, stop]);

  const resume = useCallback(() => {
    if (focused.current && foreground() && !active.current) load();
  }, [load]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    resume();
    return () => {
      focused.current = false;
      conceal();
    };
  }, [conceal, resume]));

  useEffect(() => {
    if (Platform.OS === "web") {
      const visibility = () => {
        if (foreground()) resume();
        else conceal();
      };
      window.addEventListener("blur", conceal);
      window.addEventListener("focus", resume);
      document.addEventListener("visibilitychange", visibility);
      return () => {
        window.removeEventListener("blur", conceal);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", visibility);
      };
    }
    const listener = AppState.addEventListener("change", value => {
      if (value === "active") resume();
      else conceal();
    });
    return () => listener.remove();
  }, [conceal, resume]);

  function currentReady() {
    const lease = active.current;
    return state.kind === "ready" && current.current === state && focused.current && foreground() &&
      lease !== null && !lease.controller.signal.aborted && lease.expiresAt > Date.now();
  }
  function next() {
    if (state.kind === "ready" && currentReady() && state.page.nextCursor) {
      load(state.page.nextCursor, state.page.actorId);
    }
  }
  function restart() {
    if (state.kind === "ready" && currentReady()) load(undefined, state.page.actorId);
  }
  function retry() {
    if (state.kind === "unavailable" && current.current === state) {
      load(state.context.after, state.context.actor);
    }
  }

  const button = { minHeight: 44, padding: 12, borderRadius: 10,
    backgroundColor: theme.actionSoft, justifyContent: "center" as const };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 20, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 26, fontWeight: "700" }}>سلال التسوق المحفوظة</Text>
        <Text style={{ color: theme.colorSecondary }}>راجع سلة كل متجر على حدة.</Text>
        {state.kind === "ready" ? <>
          {state.page.carts.length === 0 ? <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>لا توجد سلال محفوظة في هذه الصفحة.</Text> : null}
          {state.page.carts.map(cart => (
            <View key={cart.storeId} style={{ backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>{cart.storeName || "متجر غير متاح"}</Text>
              <Text style={{ color: theme.colorSecondary }}>عدد الأصناف: {cart.lineCount}</Text>
              <Link href={{ pathname: "/cart/[storeId]", params: { storeId: cart.storeId } }} asChild
                onPress={event => { if (!currentReady()) event.preventDefault(); }}>
                <Pressable accessibilityRole="link" style={button}>
                  <Text style={{ color: theme.interactiveText }}>مراجعة سلة المتجر</Text>
                </Pressable>
              </Link>
            </View>
          ))}
          {state.page.nextCursor ? <Pressable accessibilityRole="button" onPress={next} style={button}><Text style={{ color: theme.interactiveText }}>المزيد من السلال</Text></Pressable> : null}
          {state.after ? <Pressable accessibilityRole="button" onPress={restart} style={button}><Text style={{ color: theme.interactiveText }}>العودة إلى البداية</Text></Pressable> : null}
        </> : state.kind === "signed-out" ? <Link href="/login" style={{ color: theme.interactiveText }}>سجّل الدخول لعرض سلالك</Link>
          : state.kind === "unavailable" ? <>
            <Text accessibilityRole="alert" style={{ color: theme.color }}>تعذر التحقق من السلال.</Text>
            <Pressable accessibilityRole="button" onPress={retry} style={button}><Text style={{ color: theme.interactiveText }}>إعادة المحاولة</Text></Pressable>
          </> : <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ التحقق من السلال.</Text>}
        <Text testID="checkout-confirmation-unavailable" style={{ color: theme.colorSecondary }}>تأكيد الطلب من عدة متاجر والدفع الموحّد غير متاحين حاليًا.</Text>
        <Link href="/stores" style={{ color: theme.interactiveText }}>متابعة تصفح المتاجر</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
