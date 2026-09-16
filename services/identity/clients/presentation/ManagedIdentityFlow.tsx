import { direction, radius, resolveRowDirection, resolveTextAlign, resolveTextInputAlign, resolveTheme, spacing, toAsciiDigits, type ThemeColors } from "@bthwani/design-system";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { identityErrorMessage } from "../errors";
import type { IdentitySessionState } from "../index";
import { limitPasswordInput, validatePasswordInputShape } from "../password";

export interface ManagedIdentityBinding {
  role?: "partner" | "captain" | "field";
  surface?: string;
  restoreIdentitySession: () => Promise<IdentitySessionState>;
  currentIdentityState: () => IdentitySessionState;
  subscribe: (listener: (state: IdentitySessionState) => void) => () => void;
  logoutIdentity: () => Promise<void>;
  requestManagedActivation: (phone: string) => Promise<unknown>;
  activateManagedIdentity: (phone: string, verificationCode: string, password: string) => Promise<IdentitySessionState>;
  loginManagedIdentity: (phone: string, password: string) => Promise<IdentitySessionState>;
}

export interface ManagedIdentityFlowProps {
  managedRole: "partner" | "captain" | "field";
  surface: string;
  roleLabel: string;
  binding: ManagedIdentityBinding;
  authenticatedContent?: ReactNode;
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

export function ManagedIdentityFlow({ managedRole, surface, roleLabel, binding, authenticatedContent }: ManagedIdentityFlowProps) {
  if (binding.role && binding.role !== managedRole) {
    throw new Error(`MANAGED_FLOW_ROLE_MISMATCH: binding role ${binding.role} !== prop role ${managedRole}`);
  }
  if (binding.surface && binding.surface !== surface) {
    throw new Error(`MANAGED_FLOW_SURFACE_MISMATCH: binding surface ${binding.surface} !== prop surface ${surface}`);
  }
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = resolveTheme(isDark ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [step, setStep] = useState<"login" | "activation">("login");
  const [phone, setPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [challengeRequested, setChallengeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const restoreSession = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setState(await binding.restoreIdentitySession());
    } catch (cause) {
      setError(identityErrorMessage(cause));
      setState({ kind: "degraded", reason: "unknown" });
    } finally {
      setBusy(false);
    }
  }, [binding]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    const unsubscribe = binding.subscribe(setState);
    setState(binding.currentIdentityState());
    return unsubscribe;
  }, [binding]);

  function resetToLogin() {
    setStep("login");
    setVerificationCode("");
    setPassword("");
    setPasswordConfirmation("");
    setChallengeRequested(false);
    setError("");
    setNotice("");
  }

  function startActivation() {
    setStep("activation");
    setVerificationCode("");
    setPassword("");
    setPasswordConfirmation("");
    setChallengeRequested(false);
    setError("");
    setNotice("");
  }

  async function requestActivationVerification() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await binding.requestManagedActivation(phone);
      setChallengeRequested(true);
      setNotice("إذا كانت البيانات صالحة، سيصلك رمز تحقق الهاتف عبر القناة المهيأة.");
    } catch (cause) {
      setError(identityErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loginDevice() {
    setBusy(true);
    setError("");
    try {
      setState(await binding.loginManagedIdentity(phone, password));
      setPassword("");
    } catch (cause) {
      setError(identityErrorMessage(cause, "login"));
    } finally {
      setBusy(false);
    }
  }

  async function activateDevice() {
    setBusy(true);
    setError("");
    try {
      setState(await binding.activateManagedIdentity(phone, verificationCode, password));
    } catch (cause) {
      setError(identityErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function logoutDevice() {
    setBusy(true);
    setError("");
    let remoteRevocationConfirmed = true;
    try {
      await binding.logoutIdentity();
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      resetToLogin();
      setState(binding.currentIdentityState());
      if (!remoteRevocationConfirmed) setNotice("تم تسجيل الخروج من هذا الجهاز، لكن تعذر تأكيد إبطال الجلسة على الخادم.");
      setBusy(false);
    }
  }

  const shell = (content: ReactNode) => (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top + spacing[4], spacing[8]) }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <BrandHeader styles={styles} />
      <View style={styles.rolePill}>
        <View style={styles.liveDot} />
        <Text style={styles.rolePillText}>مساحة تشغيل {roleLabel}</Text>
      </View>
      {content}
    </ScrollView>
  );

  if (state.kind === "restoring") {
    return shell(
      <View style={styles.stateCard}>
        <ActivityIndicator color={theme.actionBackground} size="large" />
        <Text style={styles.stateTitle}>جارٍ تجهيز المساحة</Text>
        <Text style={styles.muted}>نستعيد جلسة هذا الجهاز بأمان.</Text>
      </View>
    );
  }

  if (state.kind === "authenticated") {
    return shell(
      <View style={styles.card}>
        <View style={styles.successBadge}>
          <View style={styles.successDot} />
          <Text style={styles.successBadgeText}>الجهاز جاهز للعمل</Text>
        </View>
        <Text style={styles.title}>مرحباً بك في مساحة {roleLabel}</Text>
        <Text style={styles.description}>تم تفعيل جلسة هذا الجهاز بنجاح.</Text>
        {authenticatedContent}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إنهاء جلسة هذا الجهاز"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={logoutDevice}
          style={({ pressed }: { pressed: boolean }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed, busy && styles.disabledButton]}
        >
          <Text style={[styles.secondaryButtonText, busy && styles.disabledButtonText]}>{busy ? "جارٍ إنهاء الجلسة…" : "إنهاء جلسة هذا الجهاز"}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind === "degraded") {
    const conflict = state.reason === "refresh_conflict";
    return shell(
      <View style={styles.card}>
        <Text style={styles.title}>{conflict ? "تحديث الوصول" : "تعذر استعادة الوصول"}</Text>
        <Text style={styles.description}>{conflict ? "تغيرت بيانات الوصول بالتزامن. حدّثها للمتابعة دون إعادة تسجيل الدخول." : "تعذر التحقق من الوصول الآن. حاول مرة أخرى لاستعادة الدخول."}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={conflict ? "تحديث الوصول" : "إعادة التحقق"}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={restoreSession}
          style={({ pressed }: { pressed: boolean }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, busy && styles.disabledButton]}
        >
          <Text style={[styles.primaryButtonText, busy && styles.disabledButtonText]}>{conflict ? "تحديث الوصول" : "إعادة التحقق"}</Text>
        </Pressable>
      </View>
    );
  }

  const phoneReady = phone.trim().length > 0;
  const verificationReady = verificationCode.trim().length === 6;
  const passwordReady = validatePasswordInputShape(password, passwordConfirmation).valid;

  const content =
    step === "login" ? (
      <>
        <Text style={styles.eyebrow}>دخول موحّد</Text>
        <Text style={styles.title}>تسجيل الدخول</Text>
        <Text style={styles.description}>أدخل رقم الهاتف وكلمة المرور الخاصة بدور {roleLabel}.</Text>
        <Text style={styles.fieldLabel}>رقم الهاتف</Text>
        <TextInput
          accessibilityLabel="رقم الهاتف"
          autoComplete="tel"
          keyboardType="phone-pad"
          onChangeText={(value: string) => {
            setPhone(toAsciiDigits(value));
            setError("");
          }}
          placeholder="مثال: 967 77 000 101"
          placeholderTextColor={theme.colorMuted}
          style={[styles.input, styles.numericInput]}
          textAlign="center"
          value={phone}
        />
        <Text style={styles.fieldLabel}>كلمة المرور</Text>
        <TextInput
          accessibilityLabel="كلمة المرور"
          autoComplete="current-password"
          maxLength={8}
          onChangeText={(value: string) => {
            setPassword(limitPasswordInput(value));
            setError("");
          }}
          placeholder="8 أحرف بالضبط"
          placeholderTextColor={theme.colorMuted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تسجيل الدخول"
          accessibilityState={{ busy, disabled: busy || !phoneReady || !validatePasswordInputShape(password).valid }}
          disabled={busy || !phoneReady || !validatePasswordInputShape(password).valid}
          onPress={loginDevice}
          style={({ pressed }: { pressed: boolean }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, (busy || !phoneReady || !validatePasswordInputShape(password).valid) && styles.disabledButton]}
        >
          <Text style={[styles.primaryButtonText, (busy || !phoneReady || !validatePasswordInputShape(password).valid) && styles.disabledButtonText]}>{busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="التفعيل لأول مرة"
          accessibilityState={{ busy, disabled: busy || !phoneReady }}
          disabled={busy || !phoneReady}
          onPress={startActivation}
          style={({ pressed }: { pressed: boolean }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed, (busy || !phoneReady) && styles.disabledButton]}
        >
          <Text style={[styles.secondaryButtonText, (busy || !phoneReady) && styles.disabledButtonText]}>التفعيل لأول مرة</Text>
        </Pressable>
        <Text style={styles.helper}>إذا لم يسبق تفعيل الجهاز، استخدم خيار التفعيل بعد إدخال رقم الهاتف.</Text>
      </>
    ) : (
      <>
        <Text style={styles.eyebrow}>تفعيل أول مرة</Text>
        <Text style={styles.title}>تفعيل جهاز {roleLabel}</Text>
        <Text style={styles.description}>أثبت رقم الهاتف المرتبط بالدور ثم أنشئ كلمة المرور.</Text>
        <Text style={styles.summaryPhone}>{phone}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={challengeRequested ? "إعادة إرسال رمز الهاتف" : "إرسال رمز تحقق الهاتف"}
          accessibilityState={{ busy, disabled: busy || !phoneReady }}
          disabled={busy || !phoneReady}
          onPress={requestActivationVerification}
           style={({ pressed }: { pressed: boolean }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed, (busy || !phoneReady) && styles.disabledButton]}
         >
           <Text style={[styles.secondaryButtonText, (busy || !phoneReady) && styles.disabledButtonText]}>{busy ? "جارٍ إرسال رمز الهاتف…" : challengeRequested ? "إعادة إرسال رمز الهاتف" : "إرسال رمز تحقق الهاتف"}</Text>
        </Pressable>
        {challengeRequested ? (
          <>
            <Text style={styles.fieldLabel}>رمز تحقق الهاتف</Text>
              <TextInput
              accessibilityLabel="رمز تحقق الهاتف"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value: string) => setVerificationCode(toAsciiDigits(value).replace(/\D/g, "").slice(0, 6))}
              placeholder="رمز من 6 أرقام"
              placeholderTextColor={theme.colorMuted}
              style={[styles.input, styles.numericInput]}
              textAlign="center"
              value={verificationCode}
            />
            <Text style={styles.fieldLabel}>كلمة المرور</Text>
              <TextInput
              accessibilityLabel="كلمة المرور"
              autoComplete="new-password"
              maxLength={8}
              onChangeText={(value: string) => setPassword(limitPasswordInput(value))}
              placeholder="8 أحرف بالضبط"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              value={password}
            />
            <Text style={styles.fieldLabel}>تأكيد كلمة المرور</Text>
            <TextInput
              accessibilityLabel="تأكيد كلمة المرور"
              autoComplete="new-password"
              maxLength={8}
              onChangeText={(value: string) => setPasswordConfirmation(limitPasswordInput(value))}
              placeholder="أعد إدخال كلمة المرور"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              value={passwordConfirmation}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="حفظ كلمة المرور والدخول"
              accessibilityState={{ busy, disabled: busy || !verificationReady || !passwordReady }}
              disabled={busy || !verificationReady || !passwordReady}
              onPress={activateDevice}
              style={[styles.primaryButton, (busy || !verificationReady || !passwordReady) && styles.disabledButton]}
            >
              <Text style={[styles.primaryButtonText, (busy || !verificationReady || !passwordReady) && styles.disabledButtonText]}>{busy ? "جارٍ التفعيل…" : "حفظ كلمة المرور والدخول"}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تغيير رقم الهاتف"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={resetToLogin}
          style={styles.linkButton}
        >
          <Text style={[styles.mutedLink, busy && styles.disabledLinkText]}>تغيير رقم الهاتف</Text>
        </Pressable>
      </>
    );

  return (
    shell(
      <View style={styles.card}>
        {content}
        {notice ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
    )
  );
}

function createStyles(theme: ThemeColors) {
  const activeDirection = direction.defaultDirection;
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);
  const numericTextAlign = resolveTextInputAlign("start", "ltr");
  const rowDirection = resolveRowDirection(activeDirection);

  return StyleSheet.create({
    content: {
      flexGrow: 1,
      alignItems: "stretch",
      backgroundColor: theme.background,
      gap: spacing[4],
      paddingHorizontal: spacing[4],
      paddingBottom: spacing[12],
    },
    brandRow: {
      alignItems: "center",
      flexDirection: rowDirection,
      gap: spacing[2],
      justifyContent: "center",
    },
    brandMark: {
      alignItems: "flex-end",
      flexDirection: rowDirection,
      gap: 3,
      height: 22,
    },
    brandMarkNavy: {
      backgroundColor: theme.structure,
      borderRadius: radius.xs,
      height: 22,
      width: 8,
    },
    brandMarkOrange: {
      backgroundColor: theme.brandAction,
      borderRadius: radius.xs,
      height: 12,
      width: 8,
    },
    brandName: {
      color: theme.color,
      fontSize: 28,
      fontWeight: "800",
    },
    rolePill: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: theme.structureSoft,
      borderRadius: radius.round,
      flexDirection: rowDirection,
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    liveDot: {
      backgroundColor: theme.brandAction,
      borderRadius: radius.round,
      height: 7,
      width: 7,
    },
    rolePillText: {
      color: theme.colorSecondary,
      fontSize: 13,
      fontWeight: "700",
    },
    stateCard: {
      alignItems: "center",
      backgroundColor: theme.surface,
      borderColor: theme.borderColor,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing[3],
      padding: spacing[6],
    },
    stateTitle: {
      color: theme.color,
      fontSize: 20,
      fontWeight: "800",
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.borderColor,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing[2],
      padding: spacing[5],
    },
    eyebrow: {
      color: theme.interactiveText,
      fontSize: 13,
      fontWeight: "800",
      textAlign: startTextAlign,
    },
    title: {
      color: theme.color,
      fontSize: 23,
      fontWeight: "800",
      textAlign: startTextAlign,
    },
    description: {
      color: theme.colorSecondary,
      fontSize: 14,
      lineHeight: 23,
      textAlign: startTextAlign,
    },
    fieldLabel: {
      color: theme.color,
      fontSize: 14,
      fontWeight: "700",
      marginTop: spacing[2],
      textAlign: startTextAlign,
    },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.borderColor,
      borderRadius: radius.md,
      borderWidth: 1,
      color: theme.color,
      fontSize: 16,
      minHeight: 52,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      textAlign: startInputTextAlign,
      writingDirection: activeDirection,
    },
    numericInput: {
      textAlign: numericTextAlign,
      writingDirection: "ltr",
    },
    summaryPhone: {
      backgroundColor: theme.structureSoft,
      borderRadius: radius.sm,
      color: theme.color,
      fontSize: 15,
      marginTop: spacing[2],
      padding: spacing[2],
      textAlign: "center",
      writingDirection: "ltr",
    },
    primaryButton: {
      alignItems: "center",
      backgroundColor: theme.actionBackground,
      borderRadius: radius.md,
      justifyContent: "center",
      minHeight: 52,
      marginTop: spacing[2],
      paddingHorizontal: spacing[3],
    },
    primaryButtonText: {
      color: theme.onAction,
      fontSize: 15,
      fontWeight: "800",
    },
    secondaryButton: {
      alignItems: "center",
      borderColor: theme.borderColorStrong,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: "center",
      minHeight: 52,
      marginTop: spacing[2],
      paddingHorizontal: spacing[3],
    },
    secondaryButtonText: {
      color: theme.color,
      fontSize: 14,
      fontWeight: "800",
      textAlign: "center",
    },
    disabledButton: { backgroundColor: theme.disabledBackground, borderColor: theme.disabledBackground },
    disabledButtonText: { color: theme.disabledText },
    disabledLinkText: { color: theme.disabledText },
    primaryButtonPressed: { backgroundColor: theme.actionPressed },
    secondaryButtonPressed: { backgroundColor: theme.surfaceInset },
    linkButton: {
      alignItems: "center",
      paddingVertical: spacing[2],
    },
    linkText: {
      color: theme.interactiveText,
      fontSize: 13,
      fontWeight: "800",
      textAlign: "center",
      textDecorationLine: "underline",
    },
    mutedLink: {
      color: theme.colorMuted,
      fontSize: 13,
      textAlign: "center",
      textDecorationLine: "underline",
    },
    helper: {
      color: theme.colorMuted,
      fontSize: 12,
    },
    notice: {
      backgroundColor: theme.structureSoft,
      borderRadius: radius.sm,
      color: theme.color,
      fontSize: 13,
      marginTop: spacing[2],
      padding: spacing[2],
      textAlign: startTextAlign,
    },
    error: {
      backgroundColor: theme.dangerSoft,
      borderRadius: radius.sm,
      color: theme.danger,
      fontSize: 13,
      marginTop: spacing[2],
      padding: spacing[2],
      textAlign: startTextAlign,
    },
    muted: {
      color: theme.colorMuted,
      fontSize: 14,
      textAlign: "center",
    },
    successBadge: {
      alignItems: "center",
      alignSelf: "flex-end",
      backgroundColor: theme.structureSoft,
      borderRadius: radius.round,
      flexDirection: rowDirection,
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    successDot: {
      backgroundColor: theme.success,
      borderRadius: radius.round,
      height: 7,
      width: 7,
    },
    successBadgeText: {
      color: theme.color,
      fontSize: 13,
      fontWeight: "800",
    },
  });
}
