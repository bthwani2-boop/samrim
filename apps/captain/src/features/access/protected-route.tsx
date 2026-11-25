import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Redirect, useFocusEffect } from "expo-router";
import { createContext, type PropsWithChildren, useCallback, useContext, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { leaveCaptainAdmission, readCaptainAdmission } from "./admission-transport";
import { type CaptainSessionView, hasActiveCaptainSession } from "./captain-session";
import type { CaptainStanding } from "./captain-standing";

type RouteAccess = "checking" | "allowed" | "denied" | "unavailable" | "signing-out" | "sign-out-unconfirmed";
const CaptainWorkspace = createContext<Readonly<{
  session: CaptainSessionView;
  standing: CaptainStanding | null;
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
  const [verified, setVerified] = useState<Readonly<{
    session: CaptainSessionView; standing: CaptainStanding | null;
  }> | null>(null);
  const retryCheck = useRef<() => void>(() => undefined);
  const closeSession = useRef<(actorId: string) => void>(() => undefined);
  const signingOutActor = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    let current: AbortController | undefined;
    let closing: AbortController | undefined;
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let verifiedUntil = 0;

    function signOut(actorId: string) {
      if (closing || !active) return;
      signingOutActor.current = actorId;
      current?.abort();
      if (expiry) clearTimeout(expiry);
      verifiedUntil = 0;
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

    function expire() {
      // An in-flight revalidation is not authorization past the previous expiry.
      verifiedUntil = 0;
      setAccess("checking");
      if (!current) check();
    }

    function check(silent = false) {
      if (signingOutActor.current !== null) {
        signOut(signingOutActor.current);
        return;
      }
      if (silent && current) return;
      current?.abort();
      // Ordinary foreground polling must not blank a still-current workspace.
      // Expiry, background/resume and actual owner failure remain fail closed.
      if (!silent || verifiedUntil <= Date.now()) {
        verifiedUntil = 0;
        if (expiry) clearTimeout(expiry);
        setAccess("checking");
      }
      const request = new AbortController();
      current = request;
      void readCaptainAdmission(request.signal)
        .then(result => {
          if (!active || request.signal.aborted || current !== request) return;
          current = undefined;
          if (expiry) clearTimeout(expiry);
          verifiedUntil = 0;
          const session = result.session;
          if (!result.enabled || !session || !hasActiveCaptainSession(session)) {
            setVerified(null);
            setAccess("denied");
            return;
          }
          const remaining = Date.parse(session.sessionExpiresAt) - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) {
            setVerified(null);
            setAccess("denied");
            return;
          }
          // Identity alone never admits a Captain workspace. DSH's current,
          // actor-matched approval and revision are mandatory on every read.
          const standing = result.standing;
          if (!standing || standing.actorId !== session.actorId ||
            standing.status !== "APPROVED" ||
            !Number.isSafeInteger(standing.version) || standing.version < 1) {
            setVerified(null);
            setAccess("denied");
            return;
          }
          // Preserve the component tree for a renewed, still-approved actor.
          // A different actor or changed DSH standing revision resets private state.
          setVerified({ session, standing });
          setAccess("allowed");
          // Access expiry is not a verdict about the persistent session.
          // Hide protected content while Identity and DSH confirm renewal.
          verifiedUntil = Date.parse(session.sessionExpiresAt);
          expiry = setTimeout(expire, remaining);
        })
        .catch(() => {
          if (active && current === request && !request.signal.aborted) {
            current = undefined;
            verifiedUntil = 0;
            if (expiry) clearTimeout(expiry);
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
        current = undefined;
        verifiedUntil = 0;
        if (expiry) clearTimeout(expiry);
        setAccess("checking");
      }
    });
    check();
    // While the route stays foregrounded, re-read the owner instead of
    // trusting a previously granted role for the lifetime of the component.
    const periodic = setInterval(() => {
      if (AppState.currentState === "active") check(true);
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
  // Keep the navigator visible during healthy polling of a still-valid grant.
  // An initial check, expiry, backgrounding or owner failure conceals private
  // content from display, touch and accessibility until fresh approval.
  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    {verified ? (
      <CaptainWorkspace.Provider value={{ session: verified.session, standing: verified.standing,
          signOut: () => closeSession.current(verified.session.actorId) }}>
        <View key={JSON.stringify([verified.session.actorId, verified.standing?.version])}
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
