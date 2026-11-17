import { IdentityClientError, type VerifiedIdentitySession } from "@bthwani/identity";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import {
  readAdmission,
  requestAdmissionCode,
  signOutOfAdmission,
  submitAdmissionCode,
} from "./admission-transport";

function errorMessage(error: unknown) {
  if (error instanceof IdentityClientError) {
    if (error.code === "PHONE_CHALLENGE_LIMIT") return "انتظر قليلًا قبل طلب رمز آخر.";
    if (error.code === "UNAUTHORIZED") return "الرمز غير صالح أو انتهت محاولاته. تحقّق منه أو اطلب رمزًا جديدًا.";
    if (error.code === "MERCHANT_NOT_ACTIVE") return "دخول التاجر غير متاح لهذا الحساب. تواصل مع الدعم.";
    if (error.code === "SIGN_OUT_REQUIRED") return "توجد جلسة مفتوحة. سجّل الخروج قبل تبديل الحساب.";
    if (error.code === "INVALID_REQUEST") return "تحقّق من صيغة الرقم أو الرمز.";
    if (error.code === "OPERATION_RESULT_UNKNOWN") return "تعذّر تأكيد النتيجة. أعد فتح الدخول أو اطلب رمزًا جديدًا.";
  }
  return "تعذّر الاتصال بخدمة تسجيل الدخول. حاول مجددًا.";
}

export default function MerchantIdentityGate() {
  const { theme } = useMobileAppearance();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<VerifiedIdentitySession | null>(null);
  const [phone, setPhone] = useState("");
  const [ticket, setTicket] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const action = useRef<AbortController | null>(null);

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setMessage("");
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      await operation(controller.signal);
    } catch (error) {
      if (action.current === controller) setMessage(errorMessage(error));
    } finally {
      clearTimeout(timeout);
      if (action.current === controller) {
        action.current = null;
        setBusy(false);
      }
    }
  }, []);

  const refresh = useCallback(() => {
    void run(async signal => {
      setSession(null);
      const state = await readAdmission(signal);
      if (signal.aborted) return;
      setEnabled(state.enabled);
      setSession(state.session);
    });
  }, [run]);

  useEffect(() => {
    refresh();
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") refresh();
    });
    return () => {
      listener.remove();
      action.current?.abort();
      action.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(() => setSession(null),
      Math.max(0, Date.parse(session.sessionExpiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [session]);

  function requestCode() {
    void run(async signal => {
      const nextTicket = await requestAdmissionCode(phone.trim(), signal);
      if (!signal.aborted) {
        setTicket(nextTicket);
        setCode("");
      }
    });
  }

  function signIn() {
    void run(async signal => {
      const admitted = await submitAdmissionCode(ticket, code, signal);
      if (!signal.aborted) {
        setSession(admitted);
        setPhone("");
        setTicket("");
        setCode("");
      }
    });
  }

  function signOut() {
    void run(async signal => {
      await signOutOfAdmission(signal);
      if (!signal.aborted) setSession(null);
    });
  }

  const fieldStyle = {
    color: theme.color, borderColor: theme.borderColor, borderWidth: 1,
    borderRadius: 10, padding: 12, minHeight: 48, fontSize: 17,
  } as const;
  const button = (label: string, onPress: () => void, disabled = busy) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={{ borderColor: theme.borderColor, borderWidth: 1, borderRadius: 10,
        padding: 12, minHeight: 48, opacity: disabled ? 0.55 : 1 }}>
      <Text style={{ color: theme.interactiveText, fontWeight: "700", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{
        flexGrow: 1, padding: 24, justifyContent: "center", width: "100%", maxWidth: 500, alignSelf: "center",
      }}>
        <View style={{ backgroundColor: theme.surface, padding: 22, gap: 14, borderRadius: 16,
          borderColor: theme.borderColor, borderWidth: 1 }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 27, fontWeight: "700" }}>
            بثواني — التاجر
          </Text>
          {busy ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ التحقق…</Text> : null}
          {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
          {enabled === null && !busy ? button("إعادة المحاولة", refresh) : null}
          {enabled === false ? (
            <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تسجيل دخول التاجر غير متاح في هذه البيئة.</Text>
          ) : null}
          {enabled && session ? (
            <>
              {!busy ? <Text testID="merchant-admission-verified" style={{ color: theme.color }}>
                تم التحقق من جلسة التاجر. تحتاج إدارة المتجر إلى صلاحية منفصلة من DSH.
              </Text> : null}
              {button("تسجيل الخروج", signOut)}
            </>
          ) : null}
          {enabled && !session && !ticket ? (
            <>
              <Text style={{ color: theme.colorSecondary }}>استخدم رقم الاختبار المخصص لك في هذه البيئة المعزولة.</Text>
              <TextInput accessibilityLabel="رقم هاتف الاختبار" value={phone} onChangeText={setPhone}
                keyboardType="phone-pad" autoComplete="tel" editable={!busy} maxLength={12} style={fieldStyle} />
              {button("إرسال رمز التحقق", requestCode, busy || !/^\+120255501[0-9]{2}$/.test(phone.trim()))}
            </>
          ) : null}
          {enabled && !session && ticket ? (
            <>
              <Text style={{ color: theme.color }}>أدخل الرمز المكوّن من ستة أرقام.</Text>
              <TextInput accessibilityLabel="رمز التحقق" value={code} onChangeText={setCode}
                keyboardType="number-pad" autoComplete="one-time-code" editable={!busy} maxLength={6} style={fieldStyle} />
              {button("دخول مساحة التاجر", signIn, busy || !/^\d{6}$/.test(code))}
              {button("طلب رمز جديد", requestCode)}
              {button("تغيير الرقم", () => { setTicket(""); setCode(""); setMessage(""); })}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
