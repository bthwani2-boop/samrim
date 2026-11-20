import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Redirect, useFocusEffect } from "expo-router";
import { createContext, type PropsWithChildren, useCallback, useContext, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, Text, View } from "react-native";
import { leaveCaptainAdmission, readCaptainAdmission } from "./admission-transport";
import { type CaptainSessionView, hasActiveCaptainSession } from "./captain-session";

type RouteAccess = "checking" | "allowed" | "denied" | "unavailable" | "signing-out" | "sign-out-unconfirmed";
const CaptainWorkspace = createContext<Readonly<{
  session: CaptainSessionView;
  signOut: () => void;
}> | null>(null);

export function useCaptainWorkspace() {
  return useContext(CaptainWorkspace);
}

/**
 * No protected Captain UI is mounted before both current owner reads succeed.
 * A deep link, background resume or stale bearer cannot bypass the entry gate.
 * Every server-side Captain action must independently authorize the bearer.
 */
export default function CaptainProtectedRoute({ children }: PropsWithChildren) {
  const { theme } = useMobileAppearance();
  const [access, setAccess] = useState<RouteAccess>("checking");
  const [verified, setVerified] = useState<CaptainSessionView | null>(null);
  const retryCheck = useRef<() => void>(() => undefined);
  const closeSession = useRef<(actorId: string) => void>(() => undefined);
  const signingOutActor = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    let current: AbortController | undefined;
    let closing: AbortController | undefined;
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    function signOut(actorId: string) {
      if (closing || !active) return;
      signingOutActor.current = actorId;
      current?.abort();
      if (expiry) clearTimeout(expiry);
      setVerified(null);
      setAccess("signing-out");
      const request = new AbortController();
      closing = request;
      const limit = setTimeout(() => request.abort(), 8000);
      void leaveCaptainAdmission(request.signal, actorId).then(() => {
        if (!active) return;
        signingOutActor.current = null;
        setAccess("denied");
      }).catch((error: unknown) => {
        if (!active) return;
        if (error && typeof error === "object" && "code" in error && error.code === "CAPTAIN_CONTEXT_CHANGED") {
          signingOutActor.current = null;
          setAccess("denied");
        } else {
          setAccess("sign-out-unconfirmed");
        }
      }).finally(() => {
        clearTimeout(limit);
        if (closing === request) closing = undefined;
      });
    }

    function check() {
      if (signingOutActor.current !== null) {
        signOut(signingOutActor.current);
        return;
      }
      current?.abort();
      if (expiry) clearTimeout(expiry);
      setAccess("checking");
      const request = new AbortController();
      current = request;
      void readCaptainAdmission(request.signal)
        .then(result => {
          if (!active || request.signal.aborted || current !== request) return;
          const session = result.session;
          if (!result.enabled || !session || !hasActiveCaptainSession(session)) {
            setAccess("denied");
            return;
          }
          const remaining = Date.parse(session.sessionExpiresAt) - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) {
            setAccess("denied");
            return;
          }
          // A different actor or renewed session expiry must not inherit the prior
          // Captain component tree (including private in-memory screen state).
          setVerified(session);
          setAccess("allowed");
          expiry = setTimeout(() => {
            current?.abort();
            setAccess("denied");
          }, remaining);
        })
        .catch(() => {
          if (active && current === request && !request.signal.aborted) {
            setAccess("unavailable");
          }
        });
    }

    retryCheck.current = check;
    closeSession.current = signOut;
    const app = AppState.addEventListener("change", state => {
      if (state === "active") check();
      else if (signingOutActor.current === null) {
        current?.abort();
        setAccess("checking");
      }
    });
    check();
    // While the route stays foregrounded, re-read the owner instead of
    // trusting a previously granted role for the lifetime of the component.
    const periodic = setInterval(() => {
      if (AppState.currentState === "active") check();
    }, 30_000);
    return () => {
      active = false;
      current?.abort();
      closing?.abort();
      if (expiry) clearTimeout(expiry);
      clearInterval(periodic);
      app.remove();
      retryCheck.current = () => undefined;
      closeSession.current = () => undefined;
    };
  }, []));

  if (access === "denied") return <Redirect href="/" />;

  const visible = access === "allowed";
  // After the first successful owner check, keep the navigator and its
  // component state mounted across periodic checks. While the owner result
  // is unknown, hide it from display, touch and accessibility. A new route
  // still mounts no protected content until Identity and DSH both approve.
  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    {verified ? (
      <CaptainWorkspace.Provider value={{ session: verified, signOut: () => closeSession.current(verified.actorId) }}>
        <View key={JSON.stringify([verified.actorId, verified.sessionExpiresAt])}
          style={visible ? { flex: 1 } : { display: "none" }}
          pointerEvents={visible ? "auto" : "none"}
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? "auto" : "no-hide-descendants"}>
          {children}
        </View>
      </CaptainWorkspace.Provider>
    ) : null}
    {!visible ? <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
          {access === "checking" ? "جارٍ التحقق من جلسة الكابتن وأهليته..."
            : access === "signing-out" ? "جارٍ إنهاء الجلسة لدى Identity…"
            : access === "sign-out-unconfirmed" ? "تعذّر تأكيد إنهاء الجلسة. أعد محاولة تسجيل الخروج."
            : "تعذر الوصول إلى Identity أو DSH. الوصول محجوب حتى التحقق."}
        </Text>
        {access === "unavailable" || access === "sign-out-unconfirmed" ? (
          <Pressable accessibilityRole="button" onPress={() => retryCheck.current()}
            style={{ borderColor: theme.borderColor, borderWidth: 1, borderRadius: 10, padding: 12 }}>
            <Text style={{ color: theme.interactiveText }}>
              {access === "sign-out-unconfirmed" ? "إعادة محاولة تسجيل الخروج" : "إعادة التحقق"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView> : null}
  </View>;
}
