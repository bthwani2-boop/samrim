import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resolveTheme, radius, spacing, type ThemeColors } from "@bthwani/design-system";
import { validatePasswordInputShape, type IdentitySessionState } from "@bthwani/identity";

export interface ManagedIdentityBinding {
  role?: "partner" | "captain" | "field";
  surface?: string;
  restoreIdentitySession: () => Promise<IdentitySessionState>;
  currentIdentityState: () => IdentitySessionState;
  logoutIdentity: () => Promise<void>;
  requestManagedActivation: (phone: string) => Promise<unknown>;
  activateManagedIdentity: (phone: string, verificationCode: string, password: string) => Promise<IdentitySessionState>;
  loginManagedIdentity: (phone: string, password: string) => Promise<IdentitySessionState>;
  requestManagedRecovery: (phone: string) => Promise<unknown>;
  recoverManagedIdentity: (phone: string, code: string, password: string) => Promise<IdentitySessionState>;
}

export interface ManagedIdentityFlowProps {
  managedRole: "partner" | "captain" | "field";
  surface: string;
  roleLabel: string;
  binding: ManagedIdentityBinding;
}

function messageOf(value: unknown, context: "general" | "login" | "recovery" = "general"): string {
  const message = value && typeof value === "object" && "message" in value ? (value as { message?: unknown }).message : undefined;
  const raw = typeof message === "string" ? message.toLowerCase() : "";
  if (raw.includes("network") || raw.includes("fetch failed")) return "تعذر الاتصال بخدمة الهوية. تحقق من الاتصال ثم أعد المحاولة.";
  if (raw.includes("blocked") || raw.includes("forbidden")) return "هذا الحساب موقوف حاليًا. راجع الإدارة.";
  if (raw.includes("invalid") || raw.includes("unauthorized") || raw.includes("authentication")) {
    return context === "login"
      ? "رقم الهاتف أو كلمة المرور غير صحيحة."
      : context === "recovery"
      ? "رمز التحقق أو البيانات الجديدة غير صحيحة."
      : "الرمز المدخل غير صحيح. راجعه وحاول مرة أخرى.";
  }
  return "تعذر إكمال العملية. تحقق من البيانات ثم حاول مرة أخرى.";
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

export function ManagedIdentityFlow({ managedRole, surface, roleLabel, binding }: ManagedIdentityFlowProps) {
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
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [step, setStep] = useState<"phone" | "password" | "activation" | "recovery">("phone");
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
      setError(messageOf(cause));
      setState({ kind: "signed_out" });
    } finally {
      setBusy(false);
    }
  }, [binding]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  function resetToPhone() {
    setStep("phone");
    setVerificationCode("");
    setPassword("");
    setPasswordConfirmation("");
    setChallengeRequested(false);
    setError("");
    setNotice("");
  }

  function chooseIntent(next: "password" | "activation" | "recovery") {
    setStep(next);
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
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function requestRecoveryVerification() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await binding.requestManagedRecovery(phone);
      setChallengeRequested(true);
      setNotice("إذا كانت البيانات صالحة، سيصلك رمز استرداد كلمة المرور عبر القناة المهيأة.");
    } catch (cause) {
      setError(messageOf(cause, "recovery"));
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
      setError(messageOf(cause, "login"));
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
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  async function recoverPassword() {
    setBusy(true);
    setError("");
    try {
      await binding.recoverManagedIdentity(phone, verificationCode, password);
      setState({ kind: "signed_out" });
      setStep("password");
      setVerificationCode("");
      setPassword("");
      setPasswordConfirmation("");
      setChallengeRequested(false);
      setNotice("تم تغيير كلمة المرور. سجّل الدخول الآن باستخدام الكلمة الجديدة.");
    } catch (cause) {
      setError(messageOf(cause, "recovery"));
    } finally {
      setBusy(false);
    }
  }

  async function logoutDevice() {
    setBusy(true);
    setError("");
    try {
      await binding.logoutIdentity();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      resetToPhone();
      setState(binding.currentIdentityState());
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
        <ActivityIndicator color={theme.action} size="large" />
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
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Pressable
          disabled={busy}
          onPress={logoutDevice}
          style={({ pressed }: { pressed: boolean }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabledButton]}
        >
          <Text style={styles.secondaryButtonText}>{busy ? "جارٍ إنهاء الجلسة…" : "إنهاء جلسة هذا الجهاز"}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind === "service_unavailable") {
    return shell(
      <View style={styles.card}>
        <Text style={styles.title}>تعذر الوصول إلى الهوية</Text>
        <Text style={styles.description}>تحقق من تشغيل خدمة الهوية ثم أعد المحاولة.</Text>
        <Pressable disabled={busy} onPress={restoreSession} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>إعادة التحقق</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind === "refresh_conflict") {
    return shell(
      <View style={styles.card}>
        <Text style={styles.title}>تحديث جلسة الجهاز</Text>
        <Text style={styles.description}>تم تجديد بيانات الجلسة من عملية متزامنة. أعد مزامنة الجلسة للمتابعة دون إعادة تسجيل الدخول.</Text>
        <Pressable disabled={busy} onPress={restoreSession} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>مزامنة الجلسة</Text>
        </Pressable>
      </View>
    );
  }

  const phoneReady = phone.trim().length > 0;
  const verificationReady = verificationCode.trim().length === 6;
  const passwordReady = validatePasswordInputShape(password, passwordConfirmation).valid;

  const content =
    step === "phone" ? (
      <>
        <Text style={styles.eyebrow}>دخول موحّد</Text>
        <Text style={styles.title}>ابدأ برقم الهاتف</Text>
        <Text style={styles.description}>اختر الغرض من الدخول بعد إدخال الرقم. لا نكشف حالة الحساب قبل اكتمال التحقق.</Text>
        <Text style={styles.fieldLabel}>رقم الهاتف</Text>
        <TextInput
          accessibilityLabel="رقم الهاتف"
          autoComplete="tel"
          keyboardType="phone-pad"
          onChangeText={(value: string) => {
            setPhone(value);
            setError("");
          }}
          placeholder="مثال: 967 77 000 101"
          placeholderTextColor={theme.colorMuted}
          style={styles.input}
          textAlign="right"
          value={phone}
        />
        <Pressable
          disabled={busy || !phoneReady}
          onPress={() => chooseIntent("password")}
          style={({ pressed }: { pressed: boolean }) => [styles.primaryButton, pressed && styles.pressed, (busy || !phoneReady) && styles.disabledButton]}
        >
          <Text style={styles.primaryButtonText}>تسجيل الدخول</Text>
        </Pressable>
        <Pressable
          disabled={busy || !phoneReady}
          onPress={() => chooseIntent("activation")}
          style={({ pressed }: { pressed: boolean }) => [styles.secondaryButton, pressed && styles.pressed, (busy || !phoneReady) && styles.disabledButton]}
        >
          <Text style={styles.secondaryButtonText}>التفعيل لأول مرة</Text>
        </Pressable>
        <Pressable disabled={busy || !phoneReady} onPress={() => chooseIntent("recovery")} style={styles.linkButton}>
          <Text style={styles.linkText}>استرداد كلمة المرور</Text>
        </Pressable>
      </>
    ) : step === "password" ? (
      <>
        <Text style={styles.eyebrow}>حساب مفعّل</Text>
        <Text style={styles.title}>تسجيل الدخول</Text>
        <Text style={styles.description}>أدخل كلمة المرور الخاصة بدور {roleLabel}.</Text>
        <Text style={styles.summaryPhone}>{phone}</Text>
        <Text style={styles.fieldLabel}>كلمة المرور</Text>
        <TextInput
          accessibilityLabel="كلمة المرور"
          autoComplete="current-password"
          onChangeText={(value: string) => {
            setPassword(value);
            setError("");
          }}
          placeholder="١٥ حرفاً على الأقل"
          placeholderTextColor={theme.colorMuted}
          secureTextEntry
          style={styles.input}
          textAlign="right"
          value={password}
        />
        <Pressable
          disabled={busy || !validatePasswordInputShape(password).valid}
          onPress={loginDevice}
          style={({ pressed }: { pressed: boolean }) => [styles.primaryButton, pressed && styles.pressed, (busy || !validatePasswordInputShape(password).valid) && styles.disabledButton]}
        >
          <Text style={styles.primaryButtonText}>{busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            setStep("recovery");
            setChallengeRequested(false);
            setError("");
          }}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>نسيت كلمة المرور؟ استرداد عبر الهاتف</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={resetToPhone} style={styles.linkButton}>
          <Text style={styles.mutedLink}>تغيير رقم الهاتف</Text>
        </Pressable>
      </>
    ) : step === "recovery" ? (
      <>
        <Text style={styles.eyebrow}>استرداد الحساب</Text>
        <Text style={styles.title}>تغيير كلمة المرور</Text>
        <Text style={styles.description}>سيتم تغيير كلمة مرور دور {roleLabel} فقط وإلغاء جلساته القديمة.</Text>
        <Text style={styles.summaryPhone}>{phone}</Text>
        <Pressable disabled={busy || !phoneReady} onPress={requestRecoveryVerification} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{busy ? "جارٍ إرسال الرمز…" : challengeRequested ? "إعادة إرسال الرمز" : "إرسال رمز التحقق"}</Text>
        </Pressable>
        {challengeRequested ? (
          <>
            <Text style={styles.fieldLabel}>رمز تحقق الهاتف</Text>
            <TextInput
              accessibilityLabel="رمز تحقق الهاتف"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value: string) => setVerificationCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="رمز من ٦ أرقام"
              placeholderTextColor={theme.colorMuted}
              style={styles.input}
              textAlign="right"
              value={verificationCode}
            />
            <Text style={styles.fieldLabel}>كلمة المرور الجديدة</Text>
            <TextInput
              accessibilityLabel="كلمة المرور الجديدة"
              autoComplete="new-password"
              onChangeText={setPassword}
              placeholder="١٥ حرفاً على الأقل"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              textAlign="right"
              value={password}
            />
            <Text style={styles.fieldLabel}>تأكيد كلمة المرور</Text>
            <TextInput
              accessibilityLabel="تأكيد كلمة المرور"
              autoComplete="new-password"
              onChangeText={setPasswordConfirmation}
              placeholder="أعد إدخال كلمة المرور"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              textAlign="right"
              value={passwordConfirmation}
            />
            <Pressable
              disabled={busy || !verificationReady || !passwordReady}
              onPress={recoverPassword}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>{busy ? "جارٍ التغيير…" : "تغيير كلمة المرور"}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable disabled={busy} onPress={() => setStep("password")} style={styles.linkButton}>
          <Text style={styles.mutedLink}>العودة إلى كلمة المرور</Text>
        </Pressable>
      </>
    ) : (
      <>
        <Text style={styles.eyebrow}>تفعيل أول مرة</Text>
        <Text style={styles.title}>تفعيل جهاز {roleLabel}</Text>
        <Text style={styles.description}>أثبت رقم الهاتف المرتبط بالدور ثم أنشئ كلمة المرور.</Text>
        <Text style={styles.summaryPhone}>{phone}</Text>
        <Pressable disabled={busy || !phoneReady} onPress={requestActivationVerification} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{busy ? "جارٍ إرسال رمز الهاتف…" : challengeRequested ? "إعادة إرسال رمز الهاتف" : "إرسال رمز تحقق الهاتف"}</Text>
        </Pressable>
        {challengeRequested ? (
          <>
            <Text style={styles.fieldLabel}>رمز تحقق الهاتف</Text>
            <TextInput
              accessibilityLabel="رمز تحقق الهاتف"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(value: string) => setVerificationCode(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="رمز من ٦ أرقام"
              placeholderTextColor={theme.colorMuted}
              style={styles.input}
              textAlign="right"
              value={verificationCode}
            />
            <Text style={styles.fieldLabel}>كلمة المرور</Text>
            <TextInput
              accessibilityLabel="كلمة المرور"
              autoComplete="new-password"
              onChangeText={setPassword}
              placeholder="١٥ حرفاً على الأقل"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              textAlign="right"
              value={password}
            />
            <Text style={styles.fieldLabel}>تأكيد كلمة المرور</Text>
            <TextInput
              accessibilityLabel="تأكيد كلمة المرور"
              autoComplete="new-password"
              onChangeText={setPasswordConfirmation}
              placeholder="أعد إدخال كلمة المرور"
              placeholderTextColor={theme.colorMuted}
              secureTextEntry
              style={styles.input}
              textAlign="right"
              value={passwordConfirmation}
            />
            <Pressable
              disabled={busy || !verificationReady || !passwordReady}
              onPress={activateDevice}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>{busy ? "جارٍ التفعيل…" : "حفظ كلمة المرور والدخول"}</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable disabled={busy} onPress={resetToPhone} style={styles.linkButton}>
          <Text style={styles.mutedLink}>تغيير رقم الهاتف</Text>
        </Pressable>
      </>
    );

  return (
    shell(
      <View style={styles.card}>
        {content}
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
    )
  );
}

export default ManagedIdentityFlow;

function createStyles(theme: ThemeColors, isDark: boolean) {
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
      flexDirection: "row",
      gap: spacing[2],
      justifyContent: "center",
    },
    brandMark: {
      alignItems: "flex-end",
      flexDirection: "row",
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
      backgroundColor: theme.action,
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
      flexDirection: "row",
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    liveDot: {
      backgroundColor: theme.action,
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
      color: theme.action,
      fontSize: 13,
      fontWeight: "800",
      textAlign: "right",
    },
    title: {
      color: theme.color,
      fontSize: 23,
      fontWeight: "800",
      textAlign: "right",
    },
    description: {
      color: theme.colorSecondary,
      fontSize: 14,
      lineHeight: 23,
      textAlign: "right",
    },
    fieldLabel: {
      color: theme.color,
      fontSize: 14,
      fontWeight: "700",
      marginTop: spacing[2],
      textAlign: "right",
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
    },
    summaryPhone: {
      backgroundColor: theme.structureSoft,
      borderRadius: radius.sm,
      color: theme.color,
      fontSize: 15,
      marginTop: spacing[2],
      padding: spacing[2],
      textAlign: "center",
    },
    primaryButton: {
      alignItems: "center",
      backgroundColor: theme.action,
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
    disabledButton: { opacity: 0.45 },
    pressed: { opacity: 0.8 },
    linkButton: {
      alignItems: "center",
      paddingVertical: spacing[2],
    },
    linkText: {
      color: theme.action,
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
      textAlign: "right",
    },
    error: {
      backgroundColor: theme.dangerSoft,
      borderRadius: radius.sm,
      color: theme.danger,
      fontSize: 13,
      marginTop: spacing[2],
      padding: spacing[2],
      textAlign: "right",
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
      flexDirection: "row-reverse",
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
