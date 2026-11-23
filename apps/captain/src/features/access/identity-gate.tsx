import { IdentityClientError, normalizeYemeniMobile, type VerifiedIdentitySession } from "@bthwani/identity";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { type Href, Link } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  leaveCaptainAdmission, readCaptainAdmission, requestCaptainPhoneCode, verifyCaptainCode,
} from "./admission-transport";
import { hasActiveCaptainSession } from "./captain-session";
import { CaptainStandingError } from "./captain-standing";

function admissionError(error: unknown) {
  if (error instanceof IdentityClientError) {
    switch (error.code) {
      case "CAPTAIN_NOT_APPROVED": return "أهلية الكابتن غير معتمدة لدى بثواني.";
      case "CAPTAIN_NOT_ACTIVE": return "حساب الكابتن موقوف أو غير نشط.";
      case "VERIFICATION_REQUIRED": return "يلزم التحقق من الهوية أولًا.";
      case "PHONE_CHALLENGE_LIMIT": return "تجاوزت محاولات التحقق المسموح بها.";
      case "OPERATION_RESULT_UNKNOWN": return "نتيجة العملية غير مؤكدة. تحقق من حالة الحساب قبل إعادة المحاولة.";
      case "PHONE_CHALLENGE_CONSUMED": return "استخدمت خدمة الهوية الرمز بالفعل، لكن تعذّر إكمال دخول الكابتن. اطلب رمزًا جديدًا.";
      case "SIGN_OUT_REQUIRED": return "توجد جلسة سابقة أو تحقق غير مكتمل. سجّل الخروج أو أعد التحقق من حالة الحساب قبل طلب رمز آخر.";
      case "UNAUTHORIZED": return "انتهت الجلسة أو لم يتم التحقق منها.";
    }
  }
  if (error instanceof CaptainStandingError) {
    if (error.code === "OPERATION_RESULT_UNKNOWN") return "نتيجة تسجيل طلب الكابتن غير مؤكدة؛ قد يكون DSH حفظه. تحقق من حالة الطلب لدى المشغّل قبل إعادة التقديم.";
    if (error.code === "CAPTAIN_NOT_ELIGIBLE") return "طلب الكابتن غير معتمد أو تم تعليق الأهلية.";
  }
  return "تعذّر التحقق من حساب الكابتن. أعد المحاولة عند استقرار الاتصال.";
}

export default function CaptainIdentityGate() {
  const { theme } = useMobileAppearance();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [standingReady, setStandingReady] = useState(false);
  const [session, setSession] = useState<VerifiedIdentitySession | null>(null);
  const [pending, setPending] = useState(false);
  const [phone, setPhone] = useState("");
  const phoneNumber = normalizeYemeniMobile(phone);
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setMessage("");
    const deadline = setTimeout(() => next.abort(), 20000);
    try {
      await task(next.signal);
    } catch (error) {
      if (controller.current === next) setMessage(admissionError(error));
    } finally {
      clearTimeout(deadline);
      if (controller.current === next) {
        controller.current = null;
        setBusy(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    void run(async signal => {
      // No prior actor may be displayed while new Identity/DSH owner reads run.
      setSession(null);
      const state = await readCaptainAdmission(signal);
      if (!signal.aborted) {
        setEnabled(state.enabled);
        setStandingReady(state.standingReady !== false);
        setSession(state.session);
      }
    });
  }, [run]);

  useEffect(() => {
    refresh();
    const app = AppState.addEventListener("change", state => {
      if (state === "active") {
        refresh();
      } else {
        // A result from before backgrounding cannot re-authorize the entry UI.
        controller.current?.abort();
        controller.current = null;
        setSession(null);
        setEnabled(null);
        setStandingReady(false);
        setBusy(false);
      }
    });
    return () => {
      app.remove();
      controller.current?.abort();
      controller.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const ms = Date.parse(session.sessionExpiresAt) - Date.now();
    const expiry = setTimeout(() => setSession(null), Math.max(0, ms));
    // Renew through Identity before the short-lived access token expires.
    // The actual Captain standing remains a fresh, mandatory DSH check.
    const revalidate = setInterval(() => {
      if (AppState.currentState === "active") refresh();
    }, 30_000);
    return () => {
      clearTimeout(expiry);
      clearInterval(revalidate);
    };
  }, [session]);

  const verified = hasActiveCaptainSession(session);
  const input = {
    color: theme.color, borderColor: theme.borderColor, borderWidth: 1,
    borderRadius: 10, padding: 12, minHeight: 48, fontSize: 17,
  } as const;
  const actionStyle = { minHeight: 48, justifyContent: "center", paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor } as const;
  const primaryAction = { ...actionStyle, backgroundColor: theme.actionBackground, borderColor: theme.actionBackground };
  const button = (title: string, onPress: () => void, disabled = busy, primary = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled}
      style={{ ...(primary ? primaryAction : actionStyle), opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: primary ? theme.onAction : theme.interactiveText, textAlign: "center", fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );

  function requestCode() {
    void run(async signal => {
      if (!phoneNumber) return;
      const issuedTicket = await requestCaptainPhoneCode(phoneNumber, signal);
      if (!signal.aborted) { setTicket(issuedTicket); setCode(""); setPending(false); }
    });
  }

  function verify() {
    void run(async signal => {
      try {
        const result = await verifyCaptainCode(ticket, code, signal);
        if (signal.aborted) return;
        setTicket("");
        setCode("");
        if (result.state === "pending") {
          // Keep the phone for the next verified check in this app session;
          // the short-lived Customer proof has already been revoked.
          setPending(true);
          setSession(null);
        } else {
          setPhone("");
          setPending(false);
          setSession(result.session);
        }
      } catch (error) {
        if (!signal.aborted && error instanceof IdentityClientError &&
            error.code === "PHONE_CHALLENGE_CONSUMED") {
          setTicket("");
          setCode("");
        }
        throw error;
      }
    });
  }

  function signOut() {
    void run(async signal => {
      try { await leaveCaptainAdmission(signal); }
      finally {
        setSession(null);
        setTicket("");
        setCode("");
      }
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16,
          maxWidth: 540, alignSelf: "center", width: "100%" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontWeight: "700", fontSize: 30 }}>بثواني الكابتن</Text>
        <View style={{ backgroundColor: theme.surface, borderColor: theme.borderColor,
          borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 }}>
          {busy ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
            جارٍ التحقق…
          </Text> : null}
          {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
          {!busy && (enabled === null || (enabled && !verified && message && !ticket))
            ? button("إعادة التحقق", refresh) : null}
          {enabled === false ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            تعذّر تهيئة الاتصال بخدمة الهوية في هذه البيئة.
          </Text> : null}
          {enabled && !standingReady ? <Text testID="captain-standing-service-unavailable"
            accessibilityRole="alert" style={{ color: theme.warningText }}>
            تسجيل الدخول للكابتن ينتظر تفعيل خدمة الأهلية. يمكنك إدخال رقم الهاتف، لكن إرسال الرمز والدخول محجوبان حتى جاهزية DSH.
          </Text> : null}
          {enabled && verified ? (
            <>
              <Text testID="captain-admission-verified" style={{ color: theme.successText, fontWeight: "700" }}>
                حساب الكابتن معتمد
              </Text>
              <Link href="/home" asChild>
                <Pressable accessibilityRole="link" style={primaryAction}>
                  <Text style={{ color: theme.onAction, textAlign: "center", fontWeight: "700" }}>فتح مساحة الكابتن</Text>
                </Pressable>
              </Link>
              {button("تسجيل الخروج", signOut)}
            </>
          ) : null}
          {enabled && !verified && pending ? (
            <Text testID="captain-admission-pending" style={{ color: theme.color }}>
              تم تسجيل طلب أهليتك لدى DSH وهو بانتظار اعتماد المشغّل. لإعادة فحص الموافقة يلزم رمز تحقق جديد؛ رقم الهاتف وحده لا يفتح حساب الكابتن.
            </Text>
          ) : null}
          {enabled && !verified && !ticket ? (
            <>
              <Text style={{ color: theme.color, fontWeight: "700", fontSize: 20 }}>تسجيل دخول الكابتن</Text>
              <View style={{ gap: 6 }}>
                <Text style={{ color: theme.color, fontWeight: "600" }}>رقم الهاتف التجريبي</Text>
                <TextInput accessibilityLabel="رقم الهاتف التجريبي" keyboardType="phone-pad"
                  autoComplete="tel" value={phone} editable={!busy} onChangeText={setPhone}
                  maxLength={13} style={input} />
              </View>
              {button(pending ? "إرسال رمز جديد للتحقق من حالة الطلب" : "إرسال رمز التحقق",
                requestCode, busy || !phoneNumber || !standingReady, true)}
            </>
          ) : null}
          {enabled && !verified && ticket ? (
            <>
              <View style={{ gap: 6 }}>
                <Text style={{ color: theme.color, fontWeight: "600" }}>رمز التحقق</Text>
                <TextInput accessibilityLabel="رمز التحقق" keyboardType="number-pad"
                  autoComplete="one-time-code" value={code} editable={!busy}
                  onChangeText={setCode} maxLength={6} style={input} />
              </View>
              {button("التحقق من حساب الكابتن", verify, busy || !/^\d{6}$/.test(code), true)}
              {button("تعديل رقم الهاتف", () => { setTicket(""); setCode(""); })}
            </>
          ) : null}
          {!verified ? (
            <Link href={"/join" as Href} asChild>
              <Pressable accessibilityRole="link" testID="captain-one-way-registration-link"
                style={{ ...actionStyle, justifyContent: "center" }}>
                <Text style={{ color: theme.interactiveText, textAlign: "center", fontWeight: "600" }}>
                  انضم إلى كباتن بثواني
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
