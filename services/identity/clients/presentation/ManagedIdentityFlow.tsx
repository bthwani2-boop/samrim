import { radius, spacing, type ThemeColors, toAsciiDigits } from "@bthwani/design-system";
import { BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { identityErrorMessage, type IdentityErrorMessages } from "../errors";
import type { IdentitySessionState } from "../index";
import { limitPasswordInput, validatePasswordInputShape } from "../password";

export interface ManagedIdentityBinding {
  role?: "partner" | "captain" | "field";
  surface?: string;
  restoreIdentitySession: () => Promise<IdentitySessionState>;
  currentIdentityState: () => IdentitySessionState;
  subscribe: (listener: (state: IdentitySessionState) => void) => () => void;
  requestManagedActivation: (phone: string) => Promise<unknown>;
  activateManagedIdentity: (phone: string, verificationCode: string, password: string) => Promise<IdentitySessionState>;
  loginManagedIdentity: (phone: string, password: string) => Promise<IdentitySessionState>;
  requestManagedRecovery: (phone: string) => Promise<unknown>;
  recoverManagedIdentity: (phone: string, verificationCode: string, password: string) => Promise<unknown>;
}

/** Routing belongs to the host; Identity admits the authenticated route tree. */
export interface MobileIdentitySessionBinding {
  restoreIdentitySession: () => Promise<IdentitySessionState>;
  currentIdentityState: () => IdentitySessionState;
  subscribe: (listener: (state: IdentitySessionState) => void) => () => void;
}

export interface AuthenticatedMobileBoundaryProps {
  binding: MobileIdentitySessionBinding;
  onUnauthenticated: () => void;
  children: ReactNode;
}

export interface ManagedIdentityFlowProps {
  managedRole: "partner" | "captain" | "field";
  surface: string;
  binding: ManagedIdentityBinding;
  authenticatedContent?: ReactNode;
}

const messages: IdentityErrorMessages = {
  generic: "تعذر الإكمال. حاول مجددًا.",
  network: "تعذر الاتصال. حاول مجددًا.",
  rateLimited: "انتظر قليلًا ثم حاول مجددًا.",
  refreshStale: "سجّل الدخول مجددًا.",
  forbidden: "تعذر الدخول. راجع الإدارة.",
  unauthenticated: {
    general: "تعذر التحقق. حاول مجددًا.",
    login: "تحقق من الرقم وكلمة المرور.",
    recovery: "تحقق من الرمز وكلمة المرور.",
  },
  conflict: "حاول مجددًا.",
  invalidLogin: "تحقق من الرقم وكلمة المرور.",
};

export function resolveInternalReturnPath(value: string | string[] | undefined, fallback: string, admitted: RegExp): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return fallback;
  return admitted.test(candidate) ? candidate : fallback;
}

function BrandHeader({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark} accessibilityElementsHidden>
        <View style={styles.brandMarkNavy} />
        <View style={styles.brandMarkOrange} />
      </View>
      <Text style={styles.brandName}>بثواني</Text>
    </View>
  );
}

export function AuthenticatedMobileBoundary({ binding, onUnauthenticated, children }: AuthenticatedMobileBoundaryProps) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<IdentitySessionState>(() => binding.currentIdentityState());
  const [busy, setBusy] = useState(false);

  const restoreSession = useCallback(async () => {
    setBusy(true);
    try {
      setState(await binding.restoreIdentitySession());
    } catch {
      setState({ kind: "degraded", reason: "unknown" });
    } finally {
      setBusy(false);
    }
  }, [binding]);

  useEffect(() => {
    const unsubscribe = binding.subscribe(setState);
    const current = binding.currentIdentityState();
    setState(current);
    if (current.kind !== "authenticated") void restoreSession();
    return unsubscribe;
  }, [binding, restoreSession]);

  useEffect(() => {
    if (state.kind === "signed_out") onUnauthenticated();
  }, [onUnauthenticated, state.kind]);

  if (state.kind === "authenticated") return <>{children}</>;

  return (
    <View style={styles.boundaryContainer}>
      <BrandHeader styles={styles} />
      <View style={styles.stateCard}>
        {state.kind === "degraded" ? (
          <>
            <Text style={styles.stateTitle}>تعذر التحقق</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void restoreSession()} style={styles.primaryButton}>
              {busy ? <ActivityIndicator accessibilityLabel="جارٍ التحقق" color={theme.onAction} /> : <Text style={styles.primaryButtonText}>إعادة المحاولة</Text>}
            </Pressable>
          </>
        ) : <ActivityIndicator accessibilityLabel="جارٍ التحقق" color={theme.actionBackground} size="large" />}
      </View>
    </View>
  );
}

export function ManagedIdentityFlow({ managedRole, surface, binding, authenticatedContent }: ManagedIdentityFlowProps) {
  if (binding.role && binding.role !== managedRole) throw new Error("MANAGED_FLOW_ROLE_MISMATCH");
  if (binding.surface && binding.surface !== surface) throw new Error("MANAGED_FLOW_SURFACE_MISMATCH");
  const insets = useSafeAreaInsets();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [step, setStep] = useState<"login" | "setup" | "recovery">("login");
  const [phone, setPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [challengeRequested, setChallengeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const restoreSession = useCallback(async () => {
    setBusy(true);
    try {
      setState(await binding.restoreIdentitySession());
    } catch {
      setState({ kind: "degraded", reason: "unknown" });
    } finally {
      setBusy(false);
    }
  }, [binding]);

  useEffect(() => {
    const unsubscribe = binding.subscribe(setState);
    void restoreSession();
    return unsubscribe;
  }, [binding, restoreSession]);

  function changeStep(next: typeof step) {
    setStep(next);
    setVerificationCode("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setShowPasswordConfirmation(false);
    setChallengeRequested(false);
    setError("");
    setNotice("");
  }

  async function requestCode() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (step === "setup") await binding.requestManagedActivation(phone);
      else await binding.requestManagedRecovery(phone);
      setVerificationCode("");
      setChallengeRequested(true);
      setNotice("تحقق من الرسائل.");
    } catch (cause) {
      setError(identityErrorMessage(cause, "general", messages));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function submitCredentials() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (step === "login") {
        setState(await binding.loginManagedIdentity(phone, password));
      } else if (step === "setup") {
        setState(await binding.activateManagedIdentity(phone, verificationCode, password));
      } else {
        await binding.recoverManagedIdentity(phone, verificationCode, password);
        changeStep("login");
        setNotice("تم حفظ كلمة المرور.");
      }
      setPassword("");
      setPasswordConfirmation("");
      setShowPassword(false);
      setShowPasswordConfirmation(false);
    } catch (cause) {
      setError(identityErrorMessage(cause, step === "login" ? "login" : "recovery", messages));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const shell = (content: ReactNode) => (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.shell}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + spacing[6], spacing[6]), paddingTop: Math.max(insets.top + spacing[4], spacing[8]) }]} keyboardShouldPersistTaps="handled">
        <BrandHeader styles={styles} />
        <View style={styles.formArea}>{content}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  if (state.kind === "restoring") return shell(<ActivityIndicator accessibilityLabel="جارٍ التحقق" color={theme.actionBackground} size="large" />);
  if (state.kind === "authenticated") return authenticatedContent ?? null;
  if (state.kind === "degraded") return shell(
    <View style={styles.card}>
      <Text style={styles.title}>تعذر التحقق</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => void restoreSession()} style={styles.primaryButton}>
        {busy ? <ActivityIndicator accessibilityLabel="جارٍ التحقق" color={theme.onAction} /> : <Text style={styles.primaryButtonText}>إعادة المحاولة</Text>}
      </Pressable>
    </View>,
  );

  const phoneReady = phone.trim().length > 0;
  const login = step === "login";
  const passwordReady = login ? password.trim().length > 0 : validatePasswordInputShape(password, passwordConfirmation).valid;
  const canSubmit = phoneReady && passwordReady && (login || (challengeRequested && verificationCode.length === 6));

  function passwordField(label: string, value: string, onChange: (value: string) => void, visible: boolean, onToggle: () => void) {
    return <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput accessibilityLabel={label} autoComplete={login ? "current-password" : "new-password"} autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={(text) => { onChange(login ? text : limitPasswordInput(text)); setError(""); }} placeholder={login ? undefined : "8 أحرف"} placeholderTextColor={theme.colorMuted} secureTextEntry={!visible} style={styles.passwordInput} value={value} />
        <BthwaniIconButton icon={visible ? "eye-off" : "eye"} label={visible ? "إخفاء " + label : "إظهار " + label} disabled={busy} onPress={onToggle} />
      </View>
    </>;
  }

  return shell(
    <View style={styles.card}>
      <Text style={styles.title}>{login ? "تسجيل الدخول" : step === "setup" ? "تعيين كلمة المرور" : "استعادة كلمة المرور"}</Text>
      <Text style={styles.fieldLabel}>رقم الجوال</Text>
      <TextInput accessibilityLabel="رقم الجوال" autoComplete="tel" keyboardType="phone-pad" editable={!busy} onChangeText={(value) => {
        setPhone(toAsciiDigits(value));
        setVerificationCode("");
        setChallengeRequested(false);
        setError("");
        setNotice("");
      }} placeholder="777000101" placeholderTextColor={theme.colorMuted} style={[styles.input, styles.numericInput]} value={phone} />
      {!login ? <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy || !phoneReady }} disabled={busy || !phoneReady} onPress={() => void requestCode()} style={[styles.secondaryButton, (busy || !phoneReady) && styles.disabledButton]}>
        <Text style={[styles.secondaryButtonText, (busy || !phoneReady) && styles.disabledButtonText]}>{challengeRequested ? "إعادة إرسال الرمز" : "إرسال الرمز"}</Text>
      </Pressable> : null}
      {!login && challengeRequested ? <>
        <Text style={styles.fieldLabel}>رمز التحقق</Text>
        <TextInput accessibilityLabel="رمز التحقق" autoComplete="one-time-code" keyboardType="number-pad" maxLength={6} editable={!busy} onChangeText={(value) => { setVerificationCode(toAsciiDigits(value).replace(/\D/g, "").slice(0, 6)); setError(""); setNotice(""); }} style={[styles.input, styles.numericInput]} value={verificationCode} />
      </> : null}
      {login || challengeRequested ? <>
        {passwordField("كلمة المرور", password, setPassword, showPassword, () => setShowPassword((value) => !value))}
        {!login ? passwordField("تأكيد كلمة المرور", passwordConfirmation, setPasswordConfirmation, showPasswordConfirmation, () => setShowPasswordConfirmation((value) => !value)) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={login ? "دخول" : "حفظ"} accessibilityState={{ busy, disabled: busy || !canSubmit }} disabled={busy || !canSubmit} onPress={() => void submitCredentials()} style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, (busy || !canSubmit) && styles.disabledButton]}>
          {busy ? <ActivityIndicator accessibilityLabel="جارٍ الإكمال" color={theme.disabledText} /> : <Text style={[styles.primaryButtonText, !canSubmit && styles.disabledButtonText]}>{login ? "دخول" : "حفظ"}</Text>}
        </Pressable>
      </> : null}
      {login ? <View style={styles.links}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStep("setup")} style={styles.linkButton}><Text style={[styles.linkText, busy && styles.disabledButtonText]}>أول دخول؟</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStep("recovery")} style={styles.linkButton}><Text style={[styles.linkText, busy && styles.disabledButtonText]}>نسيت كلمة المرور؟</Text></Pressable>
      </View> : <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStep("login")} style={styles.linkButton}><Text style={[styles.linkText, busy && styles.disabledButtonText]}>رجوع</Text></Pressable>}
      {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>,
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    boundaryContainer: { alignItems: "stretch", backgroundColor: theme.background, flex: 1, gap: spacing[4], justifyContent: "center", paddingHorizontal: spacing[4] },
    shell: { backgroundColor: theme.background, flex: 1 },
    content: { flexGrow: 1, backgroundColor: theme.background, gap: spacing[6], paddingHorizontal: spacing[4] },
    formArea: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing[4] },
    brandRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "center" },
    brandMark: { alignItems: "flex-end", flexDirection: "row", gap: 3, height: 22 },
    brandMarkNavy: { backgroundColor: theme.structure, borderRadius: radius.xs, height: 22, width: 8 },
    brandMarkOrange: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: 12, width: 8 },
    brandName: { color: theme.color, fontSize: 28, fontWeight: "800" },
    stateCard: { alignItems: "center", backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: 1, gap: spacing[3], padding: spacing[6] },
    stateTitle: { color: theme.color, fontSize: 20, fontWeight: "800" },
    card: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: 1, gap: spacing[2], padding: spacing[5] },
    title: { color: theme.color, fontSize: 23, fontWeight: "800" },
    fieldLabel: { color: theme.color, fontSize: 14, fontWeight: "700", marginTop: spacing[2] },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: 1, color: theme.color, fontSize: 16, minHeight: 52, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    numericInput: { textAlign: "left", writingDirection: "ltr" },
    passwordRow: { alignItems: "center", borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", paddingEnd: spacing[1] },
    passwordInput: { color: theme.color, flex: 1, fontSize: 16, minHeight: 52, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    primaryButton: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: radius.md, justifyContent: "center", minHeight: 52, marginTop: spacing[2], paddingHorizontal: spacing[3] },
    primaryButtonText: { color: theme.onAction, fontSize: 15, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColorStrong, borderRadius: radius.md, borderWidth: 1, justifyContent: "center", minHeight: 52, marginTop: spacing[2], paddingHorizontal: spacing[3] },
    secondaryButtonText: { color: theme.color, fontSize: 14, fontWeight: "800" },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    primaryButtonPressed: { backgroundColor: theme.actionPressed },
    links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
    linkButton: { justifyContent: "center", minHeight: 44, paddingVertical: spacing[2] },
    linkText: { color: theme.interactiveText, fontSize: 13, fontWeight: "700" },
    notice: { color: theme.colorSecondary, fontSize: 13, marginTop: spacing[2] },
    error: { color: theme.danger, fontSize: 13, marginTop: spacing[2] },
  });
}
