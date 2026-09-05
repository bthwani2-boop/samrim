import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { isIdentityClientError, type IdentitySessionState } from "@bthwani/identity";
import {
  currentIdentityState,
  loginClient,
  logoutIdentity,
  recoverClient,
  registerClient,
  requestClientRecovery,
  requestClientRegistration,
  restoreIdentitySession,
} from "./identity";

type AuthMode = "login" | "register" | "recover";
type FieldName = "phone" | "code" | "password";

const colors = {
  background: "#FFFCF8",
  border: "#D7E0EA",
  focus: "#FF500D",
  muted: "#68778A",
  navy: "#0A2F5C",
  orange: "#FF500D",
  surface: "#FFFFFF",
  disabled: "#DCE3EB",
  dangerBackground: "#FFF1F0",
  danger: "#B42318",
  noticeBackground: "#FFF6ED",
};

const modeDetails: Record<AuthMode, { title: string }> = {
  login: { title: "تسجيل الدخول" },
  register: { title: "إنشاء حساب" },
  recover: { title: "استعادة كلمة المرور" },
};

function messageOf(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "تعذر إكمال عملية الهوية.";
}

function isCredentialFailure(value: unknown): boolean {
  return isIdentityClientError(value) && value.kind === "http" && value.status === 401;
}

export default function IdentityGate() {
  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [proofRequested, setProofRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);
  const [loginFailed, setLoginFailed] = useState(false);

  async function restore() {
    setBusy(true);
    setError("");
    try {
      setState(await restoreIdentitySession());
    } catch (cause) {
      setError(messageOf(cause));
      setState({ kind: "signed_out" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void restore();
  }, []);

  function selectMode(next: AuthMode) {
    setMode(next);
    setCode("");
    setPassword("");
    setProofRequested(false);
    setError("");
    setNotice("");
    setFocusedField(null);
    setLoginFailed(false);
  }

  function updatePhone(value: string) {
    setPhone(value);
    if (mode === "login") {
      setLoginFailed(false);
      setError("");
    }
  }

  function updatePassword(value: string) {
    setPassword(value);
    if (mode === "login") {
      setLoginFailed(false);
      setError("");
    }
  }

  async function requestProof() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "register") {
        await requestClientRegistration(phone);
      } else if (mode === "recover") {
        await requestClientRecovery(phone);
      } else {
        return;
      }
      setProofRequested(true);
      setNotice("تم إرسال رمز التحقق عبر القناة المهيأة.");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    setLoginFailed(false);
    try {
      if (mode === "login") {
        setState(await loginClient(phone, password));
      } else if (mode === "register") {
        setState(await registerClient(phone, code, password));
      } else {
        setState(await recoverClient(phone, code, password));
      }
      setCode("");
      setPassword("");
      setProofRequested(false);
    } catch (cause) {
      setLoginFailed(mode === "login" && isCredentialFailure(cause));
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await logoutIdentity();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setState(currentIdentityState());
      setBusy(false);
    }
  }

  if (state.kind === "restoring") {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.orange} />
        <Text style={styles.muted}>جارٍ التحقق من الجلسة الحية…</Text>
      </View>
    );
  }

  if (state.kind === "authenticated") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>بثواني</Text>
        <Text style={styles.status}>تم تسجيل الدخول</Text>
        <Text style={styles.muted}>العميل: {state.identity.subject}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={busy} onPress={logout} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{busy ? "جارٍ التنفيذ…" : "تسجيل الخروج"}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind === "service_unavailable") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>بثواني</Text>
        <Text style={styles.status}>خدمة الهوية غير متاحة</Text>
        <Pressable disabled={busy} onPress={restore} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>إعادة التحقق</Text>
        </Pressable>
      </View>
    );
  }

  const needsProof = mode !== "login";
  const canSubmit =
    phone.trim().length > 0 &&
    password.length >= 12 &&
    (!needsProof || (proofRequested && code.trim().length === 4));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.authShell}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>بثواني</Text>
            <View style={styles.brandAccent} />
          </View>

          <View style={styles.authCard}>
            <Text style={styles.formTitle}>{modeDetails[mode].title}</Text>

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>رقم الهاتف</Text>
              <TextInput
                accessibilityLabel="رقم الهاتف"
                autoCapitalize="none"
                keyboardType="phone-pad"
                onBlur={() => setFocusedField(null)}
                onChangeText={updatePhone}
                onFocus={() => setFocusedField("phone")}
                placeholder="+967..."
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.numericInput, focusedField === "phone" && styles.inputFocused]}
                value={phone}
              />
            </View>

            {needsProof ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={proofRequested ? "إعادة إرسال رمز التحقق" : "إرسال رمز التحقق"}
                  disabled={busy || !phone.trim()}
                  onPress={requestProof}
                  style={[
                    styles.codeAction,
                    !proofRequested && styles.codeActionPrimary,
                    !proofRequested && (busy || !phone.trim()) && styles.codeActionDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.codeActionText,
                      !proofRequested && styles.codeActionPrimaryText,
                      (busy || !phone.trim()) && styles.disabledText,
                    ]}
                  >
                    {proofRequested ? "إعادة إرسال رمز التحقق" : "إرسال رمز التحقق"}
                  </Text>
                </Pressable>

                {proofRequested ? (
                  <>
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>رمز التحقق</Text>
                      <TextInput
                        accessibilityLabel="رمز التحقق"
                        keyboardType="number-pad"
                        maxLength={4}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 4))}
                        onFocus={() => setFocusedField("code")}
                        placeholder="أدخل الرمز المكوّن من 4 أرقام"
                        placeholderTextColor={colors.muted}
                        style={[styles.input, styles.numericInput, focusedField === "code" && styles.inputFocused]}
                        value={code}
                      />
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>
                        {mode === "recover" ? "كلمة المرور الجديدة" : "كلمة المرور"}
                      </Text>
                      <TextInput
                        accessibilityLabel={mode === "recover" ? "كلمة المرور الجديدة" : "كلمة المرور"}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        onBlur={() => setFocusedField(null)}
                        onChangeText={setPassword}
                        onFocus={() => setFocusedField("password")}
                        placeholder="12 حرفًا على الأقل"
                        placeholderTextColor={colors.muted}
                        secureTextEntry
                        style={[styles.input, focusedField === "password" && styles.inputFocused]}
                        value={password}
                      />
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>كلمة المرور</Text>
                <TextInput
                  accessibilityLabel="كلمة المرور"
                  autoCapitalize="none"
                  autoComplete="current-password"
                  onBlur={() => setFocusedField(null)}
                  onChangeText={updatePassword}
                  onFocus={() => setFocusedField("password")}
                  placeholder="أدخل كلمة المرور"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  style={[styles.input, focusedField === "password" && styles.inputFocused]}
                  value={password}
                />
              </View>
            )}

            {(!needsProof || proofRequested) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={modeDetails[mode].title}
                disabled={busy || !canSubmit}
                onPress={submit}
                style={[styles.primaryButton, (busy || !canSubmit) && styles.primaryButtonDisabled]}
              >
                <Text style={[styles.primaryButtonText, (busy || !canSubmit) && styles.primaryButtonTextDisabled]}>
                  {busy ? "جارٍ التنفيذ…" : mode === "login" ? "تسجيل الدخول" : mode === "register" ? "إنشاء الحساب" : "تعيين كلمة المرور"}
                </Text>
              </Pressable>
            ) : null}

            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}

            {mode === "login" && loginFailed ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => selectMode("recover")}
                style={styles.recoveryButton}
              >
                <Text style={styles.recoveryButtonText}>نسيت كلمة المرور؟</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.modeLinks}>
            {mode !== "login" ? (
              <Pressable accessibilityRole="link" onPress={() => selectMode("login")}>
                <Text style={styles.modeLinkText}>دخول</Text>
              </Pressable>
            ) : null}
            {mode !== "register" ? (
              <Pressable accessibilityRole="link" onPress={() => selectMode("register")}>
                <Text style={styles.modeLinkText}>حساب جديد</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32 },
  authShell: { width: "100%", maxWidth: 480, alignSelf: "center" },
  brandBlock: { alignItems: "center", marginBottom: 24 },
  brand: { color: colors.navy, fontSize: 34, fontWeight: "800", textAlign: "center" },
  brandAccent: { backgroundColor: colors.orange, borderRadius: 3, height: 4, marginTop: 8, width: 42 },
  title: { color: colors.navy, fontSize: 28, fontWeight: "800", textAlign: "center" },
  authCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  formTitle: { color: colors.navy, fontSize: 22, fontWeight: "800", marginBottom: 16, textAlign: "right" },
  fieldBlock: { marginBottom: 14 },
  fieldLabel: { color: colors.navy, fontSize: 14, fontWeight: "700", marginBottom: 7, textAlign: "right" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.navy, fontSize: 16, minHeight: 54, paddingHorizontal: 15, paddingVertical: 13, textAlign: "right" },
  numericInput: { textAlign: "left" },
  inputFocused: { borderColor: colors.focus, borderWidth: 2 },
  codeAction: { alignSelf: "flex-end", paddingBottom: 8, paddingTop: 2 },
  codeActionText: { color: colors.orange, fontSize: 14, fontWeight: "800" },
  codeActionPrimary: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.orange, borderRadius: 14, justifyContent: "center", minHeight: 54, paddingHorizontal: 16 },
  codeActionPrimaryText: { color: colors.surface, fontSize: 16 },
  codeActionDisabled: { backgroundColor: colors.disabled },
  modeLinks: { alignItems: "center", flexDirection: "row-reverse", flexWrap: "wrap", gap: 18, justifyContent: "center", marginTop: 16 },
  modeLinkText: { color: colors.navy, fontSize: 14, fontWeight: "800", textDecorationLine: "underline" },
  recoveryButton: { alignItems: "center", borderColor: colors.orange, borderRadius: 14, borderWidth: 1, justifyContent: "center", marginTop: 14, minHeight: 48, paddingHorizontal: 16 },
  recoveryButtonText: { color: colors.orange, fontSize: 15, fontWeight: "800" },
  disabledText: { color: colors.muted },
  status: { textAlign: "center", fontSize: 17, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: colors.border, borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.navy, fontSize: 15, fontWeight: "700", textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: colors.orange, borderRadius: 14, justifyContent: "center", minHeight: 54, paddingHorizontal: 16 },
  primaryButtonDisabled: { backgroundColor: colors.disabled },
  primaryButtonText: { color: colors.surface, fontSize: 16, fontWeight: "800" },
  primaryButtonTextDisabled: { color: colors.muted },
  notice: { backgroundColor: colors.noticeBackground, borderRadius: 12, color: colors.navy, fontSize: 13, marginTop: 14, padding: 10, textAlign: "right" },
  error: { backgroundColor: colors.dangerBackground, borderRadius: 12, color: colors.danger, fontSize: 13, marginTop: 14, padding: 10, textAlign: "right" },
});
