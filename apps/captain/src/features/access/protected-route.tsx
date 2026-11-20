import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Redirect, useFocusEffect } from "expo-router";
import { type PropsWithChildren, useCallback, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, Text, View } from "react-native";
import { readCaptainAdmission } from "./admission-transport";
import { hasActiveCaptainSession } from "./captain-session";

type RouteAccess = "checking" | "allowed" | "denied" | "unavailable";

/**
 * No protected Captain UI is mounted before both current owner reads succeed.
 * A deep link, background resume or stale bearer cannot bypass the entry gate.
 * Every server-side Captain action must independently authorize the bearer.
 */
export default function CaptainProtectedRoute({ children }: PropsWithChildren) {
  const { theme } = useMobileAppearance();
  const [access, setAccess] = useState<RouteAccess>("checking");
  const [previouslyAllowed, setPreviouslyAllowed] = useState(false);
  const [verifiedSessionKey, setVerifiedSessionKey] = useState<string | null>(null);
  const retryCheck = useRef<() => void>(() => undefined);

  useFocusEffect(useCallback(() => {
    let current: AbortController | undefined;
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    function check() {
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
          setVerifiedSessionKey(JSON.stringify([session.actorId, session.sessionExpiresAt]));
          setPreviouslyAllowed(true);
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
    const app = AppState.addEventListener("change", state => {
      if (state === "active") check();
      else {
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
      if (expiry) clearTimeout(expiry);
      clearInterval(periodic);
      app.remove();
      retryCheck.current = () => undefined;
    };
  }, []));

  if (access === "denied") return <Redirect href="/" />;

  const visible = access === "allowed";
  // After the first successful owner check, keep the navigator and its
  // component state mounted across periodic checks. While the owner result
  // is unknown, hide it from display, touch and accessibility. A new route
  // still mounts no protected content until Identity and DSH both approve.
  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    {previouslyAllowed ? (
      <View key={verifiedSessionKey} style={visible ? { flex: 1 } : { display: "none" }}
        pointerEvents={visible ? "auto" : "none"}
        importantForAccessibility={visible ? "auto" : "no-hide-descendants"}>
        {children}
      </View>
    ) : null}
    {!visible ? <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <Text accessibilityLiveRegion="polite" style={{ color: theme.color }}>
          {access === "checking"
            ? "جارٍ التحقق من جلسة الكابتن وأهليته..."
            : "تعذر الوصول إلى Identity أو DSH. الوصول محجوب حتى التحقق."}
        </Text>
        {access === "unavailable" ? (
          <Pressable accessibilityRole="button" onPress={() => retryCheck.current()}
            style={{ borderColor: theme.borderColor, borderWidth: 1, borderRadius: 10, padding: 12 }}>
            <Text style={{ color: theme.interactiveText }}>إعادة التحقق</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView> : null}
  </View>;
}
