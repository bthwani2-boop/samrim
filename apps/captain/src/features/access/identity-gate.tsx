import { IdentityClientError, type VerifiedIdentitySession } from "@bthwani/identity";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
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
      case "UNAUTHORIZED": return "انتهت الجلسة أو لم يتم التحقق منها.";
    }
  }
  if (error instanceof CaptainStandingError) {
    if (error.code === "CAPTAIN_NOT_ELIGIBLE") return "طلب الكابتن غير معتمد أو تم تعليق الأهلية.";
  }
  return "تعذر التحقق من المالك الحالي. أعد المحاولة عند استقرار الاتصال.";
}

export default function CaptainIdentityGate() {
  const { theme } = useMobileAppearance();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<VerifiedIdentitySession | null>(null);
  const [pending, setPending] = useState(false);
  const [phone, setPhone] = useState("");
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
        setSession(state.session);
      }
    });
  }, [run]);

  useEffect(() => {
    refresh();
    const app = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
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
    return () => clearTimeout(expiry);
  }, [session]);

  const verified = hasActiveCaptainSession(session);
  const input = {
    color: theme.color, borderColor: theme.borderColor, borderWidth: 1,
    borderRadius: 10, padding: 12, minHeight: 48, fontSize: 17,
  } as const;
  const button = (title: string, onPress: () => void, disabled = busy) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={{ padding: 13, borderWidth: 1, borderColor: theme.borderColor,
        borderRadius: 10, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: theme.interactiveText, textAlign: "center", fontWeight: "700" }}>{title}</Text>
    </Pressable>
  );

  function requestCode() {
    void run(async signal => {
      const issuedTicket = await requestCaptainPhoneCode(phone.trim(), signal);
      if (!signal.aborted) { setTicket(issuedTicket); setCode(""); setPending(false); }
    });
  }

  function verify() {
    void run(async signal => {
      const result = await verifyCaptainCode(ticket, code, signal);
      if (signal.aborted) return;
      setTicket("");
      setCode("");
      setPhone("");
      if (result.state === "pending") {
        setPending(true);
        setSession(null);
      } else {
        setPending(false);
        setSession(result.session);
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
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24,
          maxWidth: 540, alignSelf: "center", width: "100%" }}>
        <View style={{ backgroundColor: theme.surface, borderColor: theme.borderColor,
          borderWidth: 1, borderRadius: 16, padding: 22, gap: 15 }}>
          <Text accessibilityRole="header"
            style={{ color: theme.color, fontWeight: "700", fontSize: 26 }}>بثواني — الكابتن</Text>
          {busy ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>
            يجري التحقق من الهوية والأهلية...
          </Text> : null}
          {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
          {enabled === null && !busy ? button("إعادة التحقق", refresh) : null}
          {enabled === false ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            قبول الكباتن غير متاح على هذه البيئة. يلزم اتصال Identity وDSH المعتمد.
          </Text> : null}
          {enabled && verified ? (
            <>
              <Text testID="captain-admission-verified" style={{ color: theme.color }}>
                تم التحقق من دور الكابتن في Identity والأهلية المعتمدة لدى DSH.
              </Text>
              <Link href="/home" style={{ color: theme.interactiveText }}>الانتقال إلى شاشة الكابتن</Link>
              {button("تسجيل الخروج", signOut)}
            </>
          ) : null}
          {enabled && !verified && pending ? (
            <Text testID="captain-admission-pending" style={{ color: theme.color }}>
              تم تسجيل الطلب لدى DSH وهو بانتظار الموافقة. لا تمنح هذه الحالة صلاحية الكابتن.
            </Text>
          ) : null}
          {enabled && !verified && !ticket ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>
                التحقق برقم الهاتف التجريبي ثم قراءة موافقة الكابتن من DSH قبل إصدار الدور.
              </Text>
              <TextInput accessibilityLabel="رقم الهاتف" keyboardType="phone-pad"
                autoComplete="tel" value={phone} editable={!busy} onChangeText={setPhone}
                maxLength={12} style={input} />
              {button(pending ? "التحقق مجددًا من الموافقة" : "إرسال رمز التحقق",
                requestCode, busy || !/^\+120255501[0-9]{2}$/.test(phone.trim()))}
            </>
          ) : null}
          {enabled && !verified && ticket ? (
            <>
              <Text style={{ color: theme.color }}>أدخل رمز التحقق المرسل إلى بيئة الاختبار.</Text>
              <TextInput accessibilityLabel="رمز التحقق" keyboardType="number-pad"
                autoComplete="one-time-code" value={code} editable={!busy}
                onChangeText={setCode} maxLength={6} style={input} />
              {button("التحقق من حساب الكابتن", verify, busy || !/^\d{6}$/.test(code))}
              {button("تعديل رقم الهاتف", () => { setTicket(""); setCode(""); })}
            </>
          ) : null}
          {__DEV__ ? <Link href="/health" style={{ color: theme.interactiveText }}>فحص التطوير</Link> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
