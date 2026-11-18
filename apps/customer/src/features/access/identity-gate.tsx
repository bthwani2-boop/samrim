import { IdentityClientError, type VerifiedIdentitySession } from "@bthwani/identity";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
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
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<VerifiedIdentitySession | null>(null);
  const [phone, setPhone] = useState("");
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 20000);
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

  const refresh = useCallback(() => {
    void run(async signal => {
      setSession(null);
      const state = await readCustomerAdmission(signal);
      if (signal.aborted) return;
      setEnabled(state.enabled);
      setSession(state.session);
    });
  }, [run]);

  useEffect(() => {
    refresh();
    const listener = AppState.addEventListener("change", next => {
      if (next === "active") refresh();
    });
    return () => {
      listener.remove();
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);

  const requestCode = () => void run(async signal => {
    const next = await requestCustomerCode(phone.trim(), signal);
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
          <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "700", color: theme.color }}>
            بثواني — التحقق من حساب العميل
          </Text>
          {busy ? <Text style={{ color: theme.colorSecondary }}>جارٍ التحقق…</Text> : null}
          {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
          {enabled === null && !busy ? button("إعادة التحقق", refresh) : null}
          {enabled === false ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
            تسجيل الدخول غير متاح في هذه البيئة.
          </Text> : null}
          {enabled && session ? (
            <>
              <Text testID="customer-identity-verified" style={{ color: theme.color }}>
                تم التحقق من جلسة العميل عبر Identity. لا تمنح هذه الجلسة صلاحيات تاجر أو كابتن أو مشغّل.
              </Text>
              {button("تسجيل الخروج", signOut)}
            </>
          ) : null}
          {enabled && !session && !ticket ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>
                هذه تجربة معزولة؛ استخدم رقم الهاتف الاختباري المخصص فقط.
              </Text>
              <TextInput accessibilityLabel="رقم هاتف الاختبار" value={phone} onChangeText={setPhone}
                keyboardType="phone-pad" autoComplete="tel" editable={!busy} maxLength={12} style={field} />
              {button("إرسال رمز التحقق", requestCode, busy || !/^\+120255501\d{2}$/.test(phone.trim()))}
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
