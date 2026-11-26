import { IdentityClientError, normalizeYemeniMobile, type VerifiedIdentitySession } from "@bthwani/identity";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { customerAuthDestination } from "./auth-return-path";
import {
  readCustomerAdmission,
  requestCustomerCode,
  signOutCustomer,
  verifyCustomerCode,
} from "./customer-session-transport";

function friendlyError(error: unknown): string {
  if (error instanceof IdentityClientError) {
    if (error.code === "PHONE_CHALLENGE_LIMIT") return "انتظر قليلًا قبل طلب رمز آخر.";
    if (error.code === "UNAUTHORIZED") return "الرمز غير صالح أو انتهت صلاحية المحاولة.";
    if (error.code === "SIGN_OUT_REQUIRED") return "سجّل الخروج قبل تبديل الحساب.";
    if (error.code === "INVALID_REQUEST") return "تحقّق من صيغة الرقم أو الرمز.";
    if (error.code === "OPERATION_RESULT_UNKNOWN") return "تعذّر تأكيد النتيجة؛ أعد قراءة الجلسة قبل إعادة المحاولة.";
  }
  return "تعذّر تأكيد الهوية لدى الخدمة. حاول مجددًا.";
}

/** Customer's synthetic first-factor prerequisite, never a Merchant/Captain/Operator grant. */
export default function CustomerIdentityGate() {
  const { theme } = useMobileAppearance();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const destination = customerAuthDestination(returnTo);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<VerifiedIdentitySession | null>(null);
  const [phone, setPhone] = useState("");
  const phoneNumber = normalizeYemeniMobile(phone);
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>, onTimeout?: () => void) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage("");
    const timeout = setTimeout(() => {
      controller.abort();
      if (active.current === controller && onTimeout) {
        // Only owner revalidation may release its UI slot before settlement.
        // Mutating admission operations retain their existing serialization.
        onTimeout();
        active.current = null;
        setBusy(false);
      }
    }, 20000);
    try {
      await operation(controller.signal);
    } catch (error) {
      if (active.current === controller) setMessage(friendlyError(error));
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, []);

  const refresh = useCallback((silent = false) => {
    const conceal = () => {
      setSession(null);
      // An unresolved owner read must not be mistaken for a signed-out session.
      setEnabled(null);
    };
    void run(async signal => {
      if (silent !== true) conceal();
      try {
        const state = await readCustomerAdmission(signal);
        if (signal.aborted) return;
        setEnabled(state.enabled);
        setSession(state.enabled ? state.session : null);
      } catch (error) {
        if (!signal.aborted) conceal();
        throw error;
      }
    }, conceal);
  }, [run]);

  useEffect(() => {
    refresh();
    const listener = AppState.addEventListener("change", next => {
      if (next !== "active") {
        // Any owner read from before backgrounding is no longer authoritative.
        active.current?.abort();
        active.current = null;
        setBusy(false);
        setSession(null);
        setEnabled(null);
        return;
      }
      refresh();
    });
    return () => {
      listener.remove();
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!session && enabled !== null) return;
    // Expiry and temporary outages require a fresh owner decision, not login.
    const expiry = session ? setTimeout(() => {
      // An outstanding poll cannot extend the previous grant past its deadline.
      setSession(null);
      setEnabled(null);
      refresh();
    }, Math.max(0, Date.parse(session.sessionExpiresAt) - Date.now())) : undefined;
    const revalidate = setInterval(() => {
      if (AppState.currentState === "active") refresh(true);
    }, 30_000);
    return () => {
      clearTimeout(expiry);
      clearInterval(revalidate);
    };
  }, [refresh, session, enabled]);

  const requestCode = () => void run(async signal => {
    if (!phoneNumber) return;
    const next = await requestCustomerCode(phoneNumber, signal);
    if (!signal.aborted) {
      setTicket(next);
      setCode("");
    }
  });
  const verify = () => void run(async signal => {
    const next = await verifyCustomerCode(ticket, code.trim(), signal);
    if (signal.aborted) return;
    setSession(next);
    setTicket("");
    setCode("");
    setPhone("");
  });
  const signOut = () => void run(async signal => {
    await signOutCustomer(signal);
    if (!signal.aborted) {
      setSession(null);
      setTicket("");
    }
  });

  const field = { color: theme.color, borderColor: theme.borderColor,
    borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48, fontSize: 17 } as const;
  const button = (title: string, onPress: () => void, disabled = busy) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={{ borderColor: theme.borderColor, borderWidth: 1, borderRadius: 10,
        padding: 12, minHeight: 48, opacity: disabled ? 0.55 : 1 }}>
      <Text style={{ color: theme.interactiveText, fontWeight: "700", textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
        padding: 24, gap: 12, justifyContent: "center", flexGrow: 1, width: "100%",
        maxWidth: 520, alignSelf: "center",
      }}>
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: theme.borderColor,
          padding: 20, backgroundColor: theme.surface, gap: 14 }}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: theme.interactiveText }}>بثواني</Text>
          <Text accessibilityRole="header" style={{ fontSize: 23, fontWeight: "700", color: theme.color }}>
            التحقق من حساب العميل
          </Text>
          {busy && !session ? <Text style={{ color: theme.colorSecondary }}>جارٍ التحقق…</Text> : null}
          {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
          {enabled === null && !busy ? button("إعادة التحقق", () => refresh()) : null}
          {enabled === false ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            تسجيل الدخول غير متاح في هذه البيئة.
          </Text> : null}
          {enabled && session ? (
            <>
              <Text testID="customer-identity-verified" style={{ color: theme.color }}>
                تم التحقق من جلسة العميل عبر Identity. لا تمنح هذه الجلسة صلاحيات تاجر أو كابتن أو مشغّل.
              </Text>
              {destination !== "/" ? (
                <Link href={destination} replace style={{ color: theme.interactiveText, fontSize: 17,
                  minHeight: 44, textAlign: "center", paddingVertical: 12 }}>
                  {destination === "/wallet" ? "متابعة إلى المحفظة" : "متابعة إلى القسم المطلوب"}
                </Link>
              ) : null}
              {button("تسجيل الخروج", signOut)}
            </>
          ) : null}
          {enabled && !session && !ticket ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>
                هذه تجربة معزولة؛ استخدم رقم الهاتف الاختباري المخصص فقط.
              </Text>
              <TextInput accessibilityLabel="رقم هاتف الاختبار" value={phone} onChangeText={setPhone}
                keyboardType="phone-pad" autoComplete="tel" editable={!busy} maxLength={13} style={field} />
              {button("إرسال رمز التحقق", requestCode, busy || !phoneNumber)}
            </>
          ) : null}
          {enabled && !session && ticket ? (
            <>
              <Text style={{ color: theme.color }}>أدخل رمز التحقق المكوّن من ستة أرقام.</Text>
              <TextInput accessibilityLabel="رمز التحقق" value={code} onChangeText={setCode}
                keyboardType="number-pad" autoComplete="one-time-code" editable={!busy} maxLength={6}
                style={field} />
              {button("تأكيد الهوية", verify, busy || !/^\d{6}$/.test(code))}
              {button("طلب رمز جديد", requestCode)}
              {button("تغيير الرقم", () => { setTicket(""); setCode(""); setMessage(""); })}
            </>
          ) : null}
        </View>
        <Link href="/" style={{ color: theme.interactiveText, fontSize: 17 }}>العودة للرئيسية</Link>
      </ScrollView>
    </SafeAreaView>
  );
}
