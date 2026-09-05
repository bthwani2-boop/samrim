import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colorRoles, radius, spacing } from "../index";

export type ManagedSessionState =
  | { kind: "restoring" }
  | { kind: "signed_out" }
  | { kind: "service_unavailable" }
  | { kind: "authenticated" };

export type ManagedIdentityGateProps = {
  roleLabel: string;
  requestCode: (phone: string, activationCode: string) => Promise<unknown>;
  login: (phone: string, password: string) => Promise<ManagedSessionState>;
  activate: (phone: string, activationCode: string, verificationCode: string, password: string) => Promise<ManagedSessionState>;
  restore: () => Promise<ManagedSessionState>;
  currentState: () => ManagedSessionState;
  logout: () => Promise<void>;
};

function messageOf(value: unknown, roleLabel: string, context: "activation" | "login" = "activation"): string {
  const message = value && typeof value === "object" && "message" in value ? (value as { message?: unknown }).message : undefined;
  const raw = typeof message === "string" ? message.toLowerCase() : "";
  if (raw.includes("fetch failed") || raw.includes("network")) return "تعذر الاتصال بخدمة الهوية. تحقق من الاتصال بالخدمة ثم أعد المحاولة.";
  if (raw.includes("authentication") || raw.includes("unauthorized") || raw.includes("invalid")) return context === "login" ? "رقم الهاتف أو كلمة المرور غير صحيحة." : "رمز التفعيل أو رمز تحقق الهاتف غير صحيح. راجع الرمز وحاول مرة أخرى.";
  if (raw.includes("eligible") || raw.includes("role")) return `هذا الرقم غير مهيأ لتفعيل جهاز ${roleLabel}.`;
  return "تعذر إكمال التفعيل. تحقق من البيانات ثم حاول مرة أخرى.";
}

function BrandHeader() {
  return <View style={styles.brandRow}><View style={styles.brandMark} accessibilityElementsHidden><View style={styles.brandMarkNavy} /><View style={styles.brandMarkOrange} /></View><Text style={styles.brandName}>بثواني</Text></View>;
}

export function ManagedIdentityGate({ roleLabel, requestCode, login, activate, restore, currentState, logout }: ManagedIdentityGateProps) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<ManagedSessionState>({ kind: "restoring" });
  const [mode, setMode] = useState<"login" | "activate">("activate");
  const [phone, setPhone] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [challengeRequested, setChallengeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function restoreSession() { setBusy(true); setError(""); try { setState(await restore()); } catch (cause) { setError(messageOf(cause, roleLabel)); setState({ kind: "signed_out" }); } finally { setBusy(false); } }
  useEffect(() => { void restoreSession(); }, []);
  useEffect(() => { setChallengeRequested(false); setVerificationCode(""); setError(""); }, [mode]);

  async function requestPhoneVerification() {
    setBusy(true); setError(""); setNotice("");
    try { await requestCode(phone, activationCode); setChallengeRequested(true); setNotice("تم قبول رمز الجهة. أُرسل الآن رمز تحقق الهاتف عبر القناة المهيأة."); }
    catch (cause) { setError(messageOf(cause, roleLabel)); }
    finally { setBusy(false); }
  }

  async function activateDevice() {
    setBusy(true); setError(""); setNotice("");
    try { setState(await activate(phone, activationCode, verificationCode, password)); setVerificationCode(""); setPassword(""); setPasswordConfirmation(""); }
    catch (cause) { setError(messageOf(cause, roleLabel)); }
    finally { setBusy(false); }
  }

  async function loginDevice() {
    setBusy(true); setError("");
    try { setState(await login(phone, password)); setPassword(""); }
    catch (cause) { setError(messageOf(cause, roleLabel, "login")); }
    finally { setBusy(false); }
  }

  async function logoutDevice() { setBusy(true); setError(""); try { await logout(); } catch (cause) { setError(messageOf(cause, roleLabel)); } finally { setMode("login"); setChallengeRequested(false); setActivationCode(""); setVerificationCode(""); setPassword(""); setPasswordConfirmation(""); setState(currentState()); setBusy(false); } }

  const shell = (content: React.ReactNode) => <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top + spacing[4], spacing[8]) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><BrandHeader /><View style={styles.rolePill}><View style={styles.liveDot} /><Text style={styles.rolePillText}>مساحة تشغيل {roleLabel}</Text></View>{content}</ScrollView>;
  if (state.kind === "restoring") return shell(<View style={styles.stateCard}><ActivityIndicator color={colorRoles.brandAction} size="large" /><Text style={styles.stateTitle}>جارٍ تجهيز المساحة</Text><Text style={styles.muted}>نستعيد جلسة هذا الجهاز بأمان.</Text></View>);
  if (state.kind === "authenticated") return shell(<View style={styles.card}><View style={styles.successBadge}><View style={styles.successDot} /><Text style={styles.successBadgeText}>الجهاز جاهز للعمل</Text></View><Text style={styles.title}>مرحباً بك في مساحة {roleLabel}</Text><Text style={styles.description}>تم تفعيل جلسة هذا الجهاز بنجاح، ويمكنك متابعة مهامك التشغيلية الآن.</Text>{error ? <Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={logoutDevice} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabledButton]}><Text style={styles.secondaryButtonText}>{busy ? "جارٍ إنهاء الجلسة…" : "إنهاء جلسة هذا الجهاز"}</Text></Pressable><Text style={styles.helper}>إنهاء الجلسة يعيد الجهاز إلى التفعيل المحكوم.</Text></View>);
  if (state.kind === "service_unavailable") return shell(<View style={styles.card}><View style={styles.warningBadge}><Text style={styles.warningBadgeText}>الخدمة تحتاج انتباهاً</Text></View><Text style={styles.title}>تعذر الوصول إلى الهوية</Text><Text style={styles.description}>لم نتمكن من التحقق من جلسة الجهاز الآن. أعد المحاولة بعد التأكد من تشغيل خدمة الهوية.</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={restoreSession} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabledButton]}><Text style={styles.primaryButtonText}>{busy ? "جارٍ التحقق…" : "إعادة التحقق"}</Text></Pressable></View>);

  const phoneReady = phone.trim().length > 0;
  const activationReady = activationCode.trim().length === 4;
  const verificationReady = verificationCode.trim().length === 4;
  const passwordReady = password.length >= 12 && password === passwordConfirmation;
  return shell(<View style={styles.card}><View style={styles.modeSwitch}><Pressable accessibilityRole="button" onPress={() => { setMode("activate"); setError(""); }} style={[styles.modeButton, mode === "activate" && styles.modeButtonActive]}><Text style={[styles.modeButtonText, mode === "activate" && styles.modeButtonTextActive]}>تفعيل الجهاز</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { setMode("login"); setError(""); }} style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}><Text style={[styles.modeButtonText, mode === "login" && styles.modeButtonTextActive]}>تسجيل الدخول</Text></Pressable></View>{mode === "login" ? <><Text style={styles.eyebrow}>دخول آمن</Text><Text style={styles.title}>تسجيل دخول {roleLabel}</Text><Text style={styles.description}>استخدم رقم الهاتف وكلمة المرور التي أنشأتها بعد التفعيل الأول.</Text><Text style={styles.fieldLabel}>رقم الهاتف</Text><TextInput accessibilityLabel="رقم الهاتف" autoCapitalize="none" autoComplete="tel" keyboardType="phone-pad" onChangeText={(value) => { setPhone(value); setError(""); }} placeholder="مثال: 967 77 000 101" placeholderTextColor={colorRoles.textMuted} style={styles.input} textAlign="right" value={phone} /><Text style={styles.fieldLabel}>كلمة المرور</Text><TextInput accessibilityLabel="كلمة المرور" autoCapitalize="none" autoComplete="current-password" onChangeText={(value) => { setPassword(value); setError(""); }} placeholder="١٢ حرفاً على الأقل" placeholderTextColor={colorRoles.textMuted} secureTextEntry style={styles.input} textAlign="right" value={password} /><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !phoneReady || password.length < 12 }} disabled={busy || !phoneReady || password.length < 12} onPress={loginDevice} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (busy || !phoneReady || password.length < 12) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}</Text></Pressable>{error ? <Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text> : null}</> : <><Text style={styles.eyebrow}>تفعيل أولي لمرة واحدة</Text><Text style={styles.title}>تفعيل جهاز {roleLabel}</Text><Text style={styles.description}>استخدم رمز لوحة التحكم، ثم أثبت ملكية الهاتف، وبعدها أنشئ كلمة المرور. لا يوجد رمز تحقق ثانٍ بعد ذلك.</Text><View style={styles.stepHeader}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>١</Text></View><View style={styles.stepCopy}><Text style={styles.fieldLabel}>رمز تفعيل صادر من لوحة التحكم</Text><Text style={styles.helper}>يُمنح للحساب المهيأ مسبقاً ويُستخدم مرة واحدة.</Text></View></View><TextInput accessibilityLabel="رمز تفعيل صادر من لوحة التحكم" autoCorrect={false} keyboardType="number-pad" maxLength={4} onChangeText={(value) => { setActivationCode(value.replace(/\D/g, "").slice(0, 4)); setError(""); }} placeholder="0000" placeholderTextColor={colorRoles.textMuted} style={styles.input} textAlign="right" value={activationCode} /><View style={styles.stepHeader}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>٢</Text></View><View style={styles.stepCopy}><Text style={styles.fieldLabel}>رقم الجوال المهيأ</Text><Text style={styles.helper}>اكتب الرقم بصيغة دولية.</Text></View></View><TextInput accessibilityLabel="رقم الجوال" autoCapitalize="none" autoComplete="tel" keyboardType="phone-pad" onChangeText={(value) => { setPhone(value); setError(""); }} placeholder="مثال: 967 77 000 101" placeholderTextColor={colorRoles.textMuted} style={styles.input} textAlign="right" value={phone} /><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !phoneReady || !activationReady }} disabled={busy || !phoneReady || !activationReady} onPress={requestPhoneVerification} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, (!phoneReady || !activationReady || busy) && styles.disabledButton]}><Text style={styles.secondaryButtonText}>{busy ? "جارٍ التحقق من رمز الجهة…" : challengeRequested ? "إعادة إرسال رمز الهاتف" : "التحقق من رمز الجهة وإرسال رمز الهاتف"}</Text></Pressable>{challengeRequested ? <><View style={styles.stepHeader}><View style={[styles.stepNumber, styles.stepNumberActive]}><Text style={styles.stepNumberTextActive}>٣</Text></View><View style={styles.stepCopy}><Text style={styles.fieldLabel}>رمز تحقق الهاتف</Text><Text style={styles.helper}>رمز منفصل من ٤ أرقام أُرسل إلى الرقم أعلاه.</Text></View></View><TextInput accessibilityLabel="رمز تحقق الهاتف" autoComplete="one-time-code" keyboardType="number-pad" maxLength={4} onChangeText={(value) => { setVerificationCode(value.replace(/\D/g, "").slice(0, 4)); setError(""); }} placeholder="0000" placeholderTextColor={colorRoles.textMuted} style={styles.input} textAlign="right" value={verificationCode} /><Text style={styles.fieldLabel}>إنشاء كلمة المرور</Text><TextInput accessibilityLabel="إنشاء كلمة المرور" autoCapitalize="none" autoComplete="new-password" onChangeText={(value) => { setPassword(value); setError(""); }} placeholder="١٢ حرفاً على الأقل" placeholderTextColor={colorRoles.textMuted} secureTextEntry style={styles.input} textAlign="right" value={password} /><Text style={styles.fieldLabel}>تأكيد كلمة المرور</Text><TextInput accessibilityLabel="تأكيد كلمة المرور" autoCapitalize="none" autoComplete="new-password" onChangeText={(value) => { setPasswordConfirmation(value); setError(""); }} placeholder="أعد إدخال كلمة المرور" placeholderTextColor={colorRoles.textMuted} secureTextEntry style={styles.input} textAlign="right" value={passwordConfirmation} /><Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !verificationReady || !passwordReady }} disabled={busy || !verificationReady || !passwordReady} onPress={activateDevice} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (busy || !verificationReady || !passwordReady) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{busy ? "جارٍ حفظ كلمة المرور…" : "حفظ كلمة المرور والدخول"}</Text></Pressable></> : null}{notice ? <Text accessibilityRole="alert" selectable style={styles.notice}>{notice}</Text> : null}{error ? <Text accessibilityRole="alert" selectable style={styles.error}>{error}</Text> : null}</>}</View>);
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, alignItems: "stretch", backgroundColor: colorRoles.surfaceWarm, gap: spacing[4], paddingHorizontal: spacing[4], paddingBottom: spacing[12] },
  brandRow: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "center" }, brandMark: { alignItems: "flex-end", flexDirection: "row", gap: 3, height: 22 }, brandMarkNavy: { backgroundColor: colorRoles.brandStructure, borderRadius: radius.xs, height: 22, width: 8 }, brandMarkOrange: { backgroundColor: colorRoles.brandAction, borderRadius: radius.xs, height: 12, width: 8 }, brandName: { color: colorRoles.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }, rolePill: { alignItems: "center", alignSelf: "center", backgroundColor: colorRoles.brandStructureSoft, borderRadius: radius.round, flexDirection: "row", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] }, liveDot: { backgroundColor: colorRoles.brandAction, borderRadius: radius.round, height: 7, width: 7 }, rolePillText: { color: colorRoles.textSecondary, fontSize: 13, fontWeight: "700" },
  card: { backgroundColor: colorRoles.surfaceBase, borderColor: colorRoles.borderSubtle, borderRadius: radius["2xl"], borderWidth: 1, gap: spacing[4], padding: spacing[5], boxShadow: "0 12px 28px rgba(10, 47, 92, 0.10)" }, stateCard: { alignItems: "center", backgroundColor: colorRoles.surfaceBase, borderColor: colorRoles.borderSubtle, borderRadius: radius["2xl"], borderWidth: 1, gap: spacing[3], padding: spacing[8], boxShadow: "0 12px 28px rgba(10, 47, 92, 0.10)" }, modeSwitch: { alignItems: "center", flexDirection: "row", gap: spacing[2], justifyContent: "flex-end" }, modeButton: { borderBottomColor: "transparent", borderBottomWidth: 2, paddingHorizontal: spacing[2], paddingVertical: spacing[2] }, modeButtonActive: { borderBottomColor: colorRoles.brandAction }, modeButtonText: { color: colorRoles.textMuted, fontSize: 15, fontWeight: "700" }, modeButtonTextActive: { color: colorRoles.textPrimary }, eyebrow: { color: colorRoles.brandAction, fontSize: 13, fontWeight: "800", textAlign: "right" }, title: { color: colorRoles.textPrimary, fontSize: 25, fontWeight: "800", lineHeight: 34, textAlign: "right" }, stateTitle: { color: colorRoles.textPrimary, fontSize: 19, fontWeight: "800", textAlign: "center" }, description: { color: colorRoles.textSecondary, fontSize: 15, lineHeight: 24, textAlign: "right" }, fieldLabel: { color: colorRoles.textPrimary, fontSize: 16, fontWeight: "800", textAlign: "right" }, helper: { color: colorRoles.textMuted, fontSize: 13, lineHeight: 20, textAlign: "right" }, stepHeader: { alignItems: "center", flexDirection: "row", gap: spacing[3], marginTop: spacing[2] }, stepNumber: { alignItems: "center", backgroundColor: colorRoles.brandStructureSoft, borderRadius: radius.round, height: 30, justifyContent: "center", width: 30 }, stepNumberActive: { backgroundColor: colorRoles.brandActionSoft }, stepNumberText: { color: colorRoles.brandStructure, fontSize: 14, fontWeight: "800" }, stepNumberTextActive: { color: colorRoles.brandAction, fontSize: 14, fontWeight: "800" }, stepCopy: { flex: 1, gap: 2 }, input: { backgroundColor: colorRoles.surfaceBase, borderColor: colorRoles.borderStrong, borderRadius: radius.lg, borderWidth: 1, color: colorRoles.textPrimary, fontSize: 17, minHeight: 56, paddingHorizontal: spacing[4], paddingVertical: spacing[3] }, primaryButton: { alignItems: "center", backgroundColor: colorRoles.brandAction, borderRadius: radius.lg, minHeight: 56, justifyContent: "center", paddingHorizontal: spacing[4] }, primaryButtonText: { color: colorRoles.textInverse, fontSize: 16, fontWeight: "800" }, secondaryButton: { alignItems: "center", backgroundColor: colorRoles.brandStructureSoft, borderColor: colorRoles.borderSubtle, borderRadius: radius.lg, borderWidth: 1, minHeight: 52, justifyContent: "center", paddingHorizontal: spacing[4] }, secondaryButtonText: { color: colorRoles.textPrimary, fontSize: 15, fontWeight: "800", textAlign: "center" }, disabledButton: { opacity: 0.48 }, pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] }, successBadge: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#ECFDF3", borderRadius: radius.round, flexDirection: "row", gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] }, successDot: { backgroundColor: colorRoles.success, borderRadius: radius.round, height: 8, width: 8 }, successBadgeText: { color: colorRoles.success, fontSize: 13, fontWeight: "800" }, warningBadge: { alignSelf: "flex-start", backgroundColor: "#FFFBEB", borderRadius: radius.round, paddingHorizontal: spacing[3], paddingVertical: spacing[2] }, warningBadgeText: { color: colorRoles.warning, fontSize: 13, fontWeight: "800" }, notice: { backgroundColor: "#EFF6FF", borderRadius: radius.md, color: colorRoles.info, fontSize: 14, lineHeight: 22, padding: spacing[3], textAlign: "right" }, error: { backgroundColor: "#FEF2F2", borderRadius: radius.md, color: colorRoles.danger, fontSize: 14, lineHeight: 22, padding: spacing[3], textAlign: "right" }, muted: { color: colorRoles.textMuted, fontSize: 14, lineHeight: 22, textAlign: "center" },
});
