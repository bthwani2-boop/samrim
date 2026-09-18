import { borders, elevation, radius, sizing, spacing, type ThemeColors, toAsciiDigits, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type IdentitySessionState, identityErrorMessage, identitySessionSignOutMessage, isIdentityClientError, limitPasswordInput, validatePasswordInputShape } from "@bthwani/identity";
import { resolveInternalReturnPath } from "@bthwani/identity/presentation";
import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  currentIdentityState,
  loginClient,
  recoverClient,
  registerClient,
  requestClientRecovery,
  requestClientRegistration,
  restoreIdentitySession,
  subscribeIdentitySession,
} from "../../bootstrap/identity";
import { ClientPublicHeader } from "../../shell/client-shell";
import ServiceCityScope from "../service-city/service-city-scope";
import StoreDiscovery from "../store-discovery/store-discovery";
import { type IdentityCopy, identityPresentation } from "./identity-presentation";

type AuthMode = "login" | "register" | "recover";
type FieldName = "phone" | "code" | "password" | "passwordConfirmation";

const modeDetails = {
  login: "loginTitle",
  register: "registerTitle",
  recover: "recoverTitle",
} as const satisfies Record<AuthMode, keyof IdentityCopy>;

function isCredentialFailure(value: unknown): boolean {
  return isIdentityClientError(value) && value.kind === "http" && value.status === 401;
}

function safeReturnTo(value: string | string[] | undefined): Href {
  return resolveInternalReturnPath(value, "/home", /^\/(?:home|account|orders(?:\/[A-Za-z0-9._~%-]+)?|store\/[A-Za-z0-9._~%-]+|cart\/[A-Za-z0-9._~%-]+)$/u) as Href;
}

export default function IdentityGate() {
  const { focus, returnTo } = useLocalSearchParams<{ focus?: string | string[]; returnTo?: string | string[] }>();
  const theme = useAppearanceTheme();
  const { copy } = identityPresentation;
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
  const [code, setCode] = useState("");
  const [proofRequested, setProofRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focusedField, setFocusedField] = useState<FieldName | null>(null);
  const [loginFailed, setLoginFailed] = useState(false);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  const restore = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setState(await restoreIdentitySession());
    } catch (cause) {
      setError(identityErrorMessage(cause, "general", copy.errors));
      setState({ kind: "degraded", reason: "unknown" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const unsubscribe = subscribeIdentitySession(setState);
    setState(currentIdentityState());
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (state.kind === "signed_out" && returnTo && !authPromptVisible) setAuthPromptVisible(true);
  }, [authPromptVisible, returnTo, state.kind]);

  const selectMode = useCallback((next: AuthMode) => {
    setMode(next);
    setCode("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setShowPasswordConfirmation(false);
    setProofRequested(false);
    setError("");
    setNotice("");
    setFocusedField(null);
    setLoginFailed(false);
  }, []);

  const requestAuthentication = useCallback(() => {
    selectMode("login");
    setAuthPromptVisible(true);
  }, [selectMode]);

  const publicDiscovery = <ServiceCityScope><View style={styles.publicDiscovery}><ClientPublicHeader /><View style={styles.publicDiscoveryContent}><StoreDiscovery autoFocusSearch={focus === "search"} isAuthenticated={state.kind === "authenticated"} onRequireAuthentication={state.kind === "signed_out" ? requestAuthentication : undefined} /></View></View></ServiceCityScope>;

  function resetSignedOutAuthState() {
    setMode("login");
    setPhone("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setShowPasswordConfirmation(false);
    setCode("");
    setProofRequested(false);
    setError("");
    setNotice("");
    setFocusedField(null);
    setLoginFailed(false);
  }

  function updatePhone(value: string) {
    setPhone(toAsciiDigits(value));
    if (mode === "login") {
      setLoginFailed(false);
      setError("");
    }
  }

  function updatePassword(value: string) {
    setPassword(limitPasswordInput(value));
    if (mode === "login") {
      setLoginFailed(false);
      setError("");
    }
  }

  function updatePasswordConfirmation(value: string) {
    setPasswordConfirmation(limitPasswordInput(value));
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
      setNotice(copy.proofNotice);
    } catch (cause) {
      setError(identityErrorMessage(cause, "general", copy.errors));
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
      setPasswordConfirmation("");
      setShowPassword(false);
      setShowPasswordConfirmation(false);
      setProofRequested(false);
      setMode("login");
    } catch (cause) {
      setLoginFailed(mode === "login" && isCredentialFailure(cause));
      setError(identityErrorMessage(cause, mode === "login" ? "login" : mode === "recover" ? "recovery" : "general", copy.errors));
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "restoring") {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme.actionBackground} />
        <Text style={styles.muted}>{copy.restoringSession}</Text>
        {publicDiscovery}
      </View>
    );
  }

  if (state.kind === "authenticated") {
    return <Redirect href={safeReturnTo(returnTo)} />;
  }

  if (state.kind === "signed_out" && !returnTo && !authPromptVisible) {
    return <Redirect href="/home" />;
  }

  if (state.kind === "degraded") {
    const conflict = state.reason === "refresh_conflict";
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{copy.brand}</Text>
        <Text style={styles.status}>{conflict ? copy.refreshingSession : copy.serviceUnavailable}</Text>
        {conflict ? <Text style={styles.muted}>{copy.refreshConflict}</Text> : null}
        <BthwaniButton
          accessibilityLabel={conflict ? copy.syncSession : copy.retryVerification}
          busy={busy}
          disabled={busy}
          label={conflict ? copy.syncSession : copy.retryVerification}
          onPress={() => void restore()}
          variant="secondary"
        />
        {publicDiscovery}
      </View>
    );
  }

  if (!authPromptVisible) {
    return <View style={styles.container}>{publicDiscovery}</View>;
  }

  const needsProof = mode !== "login";
  const passwordShape = validatePasswordInputShape(password, needsProof ? passwordConfirmation : undefined);
  const canSubmit =
    phone.trim().length > 0 &&
    passwordShape.valid &&
    (!needsProof || (proofRequested && code.trim().length === 6));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {publicDiscovery}
        <View style={styles.authShell}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>{copy.brand}</Text>
            <View style={styles.brandAccent} />
          </View>

          <View style={styles.authCard}>
            <Text style={styles.formTitle}>{copy[modeDetails[mode]]}</Text>
            {state.kind === "signed_out" ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.notice}>{identitySessionSignOutMessage(state.reason)}</Text> : null}

            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{copy.phoneLabel}</Text>
              <TextInput
                accessibilityLabel={copy.phoneLabel}
                autoCapitalize="none"
                keyboardType="phone-pad"
                onBlur={() => setFocusedField(null)}
                onChangeText={updatePhone}
                onFocus={() => setFocusedField("phone")}
                placeholder={copy.phonePlaceholder}
                placeholderTextColor={theme.colorMuted}
                style={[styles.input, styles.numericInput, focusedField === "phone" && styles.inputFocused]}
                value={phone}
              />
            </View>

            {needsProof ? (
              <>
                <BthwaniButton
                  accessibilityLabel={proofRequested ? copy.resendCode : copy.sendCode}
                  busy={busy}
                  disabled={busy || !phone.trim()}
                  label={proofRequested ? copy.resendCode : copy.sendCode}
                  onPress={() => void requestProof()}
                  style={proofRequested ? styles.codeAction : undefined}
                  variant={proofRequested ? "quiet" : "primary"}
                />

                {proofRequested ? (
                  <>
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>{copy.verificationCodeLabel}</Text>
                      <TextInput
                        accessibilityLabel={copy.verificationCodeLabel}
                        keyboardType="number-pad"
                        maxLength={6}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={(value) => setCode(toAsciiDigits(value).replace(/\D/g, "").slice(0, 6))}
                        onFocus={() => setFocusedField("code")}
                        placeholder={copy.verificationCodePlaceholder}
                        placeholderTextColor={theme.colorMuted}
                        style={[styles.input, styles.numericInput, focusedField === "code" && styles.inputFocused]}
                        value={code}
                      />
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>
                        {mode === "recover" ? copy.newPasswordLabel : copy.passwordLabel}
                      </Text>
                      <TextInput
                        accessibilityLabel={mode === "recover" ? copy.newPasswordLabel : copy.passwordLabel}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        maxLength={8}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={updatePassword}
                        onFocus={() => setFocusedField("password")}
                        placeholder={copy.newPasswordPlaceholder}
                        placeholderTextColor={theme.colorMuted}
                        secureTextEntry={!showPassword}
                        style={[styles.input, focusedField === "password" && styles.inputFocused]}
                        value={password}
                      />
                      <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? copy.hidePassword : copy.showPassword} onPress={() => setShowPassword((value) => !value)} style={styles.revealButton}>
                        <Text style={styles.revealText}>{showPassword ? copy.hidePassword : copy.showPassword}</Text>
                      </Pressable>
                    </View>

                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>{copy.passwordConfirmationLabel}</Text>
                      <TextInput
                        accessibilityLabel={copy.passwordConfirmationLabel}
                        autoCapitalize="none"
                        autoComplete="new-password"
                        maxLength={8}
                        onBlur={() => setFocusedField(null)}
                        onChangeText={updatePasswordConfirmation}
                        onFocus={() => setFocusedField("passwordConfirmation")}
                        placeholder={copy.passwordConfirmationPlaceholder}
                        placeholderTextColor={theme.colorMuted}
                        secureTextEntry={!showPasswordConfirmation}
                        style={[styles.input, focusedField === "passwordConfirmation" && styles.inputFocused]}
                        value={passwordConfirmation}
                      />
                      <Pressable accessibilityRole="button" accessibilityLabel={showPasswordConfirmation ? copy.hidePassword : copy.showPassword} onPress={() => setShowPasswordConfirmation((value) => !value)} style={styles.revealButton}>
                        <Text style={styles.revealText}>{showPasswordConfirmation ? copy.hidePassword : copy.showPassword}</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>{copy.passwordLabel}</Text>
                <TextInput
                  accessibilityLabel={copy.passwordLabel}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  maxLength={8}
                  onBlur={() => setFocusedField(null)}
                  onChangeText={updatePassword}
                  onFocus={() => setFocusedField("password")}
                  placeholder={copy.loginPasswordPlaceholder}
                  placeholderTextColor={theme.colorMuted}
                  secureTextEntry={!showPassword}
                  style={[styles.input, focusedField === "password" && styles.inputFocused]}
                  value={password}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? copy.hidePassword : copy.showPassword} onPress={() => setShowPassword((value) => !value)} style={styles.revealButton}>
                  <Text style={styles.revealText}>{showPassword ? copy.hidePassword : copy.showPassword}</Text>
                </Pressable>
              </View>
            )}

            {(!needsProof || proofRequested) ? (
              <BthwaniButton
                accessibilityLabel={copy[modeDetails[mode]]}
                busy={busy}
                disabled={!canSubmit}
                label={mode === "login" ? copy.loginButton : mode === "register" ? copy.registerButton : copy.recoverButton}
                onPress={() => void submit()}
              />
            ) : null}

            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            {error ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

            {mode === "login" && loginFailed ? (
                <BthwaniButton disabled={busy} label={copy.forgotPassword} onPress={() => selectMode("recover")} style={styles.recoveryAction} variant="secondary" />
            ) : null}
          </View>

          <View style={styles.modeLinks}>
            <Pressable accessibilityRole="button" accessibilityLabel={copy.continueBrowsing} onPress={() => { setAuthPromptVisible(false); resetSignedOutAuthState(); }}>
              <Text style={styles.modeLinkText}>{copy.continueBrowsing}</Text>
            </Pressable>
            {mode !== "login" ? (
              <Pressable accessibilityRole="link" accessibilityLabel={copy.signInLink} onPress={() => selectMode("login")}>
                <Text style={styles.modeLinkText}>{copy.signInLink}</Text>
              </Pressable>
            ) : null}
            {mode !== "register" ? (
              <Pressable accessibilityRole="link" accessibilityLabel={copy.newAccountLink} onPress={() => selectMode("register")}>
                <Text style={styles.modeLinkText}>{copy.newAccountLink}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: ThemeColors) {
  const fullWidthText = { width: "100%" as const };
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    publicDiscovery: { flexShrink: 0, minHeight: 260, width: "100%" },
    publicDiscoveryContent: { paddingVertical: spacing[4], width: "100%" },
    scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing[5], paddingVertical: spacing[8] },
    authShell: { width: "100%", maxWidth: 480, alignSelf: "center" },
    brandBlock: { alignItems: "center", marginBottom: spacing[6] },
    brand: { ...typography.display, color: theme.structure, textAlign: "center" },
    brandAccent: { backgroundColor: theme.brandAction, borderRadius: radius.xs, height: borders.strong, marginTop: spacing[2], width: sizing.controlMd },
    title: { ...typography.hero, color: theme.structure, textAlign: "center" },
    authCard: {
      alignItems: "stretch",
      ...elevation.overlay,
      backgroundColor: theme.surface,
      borderColor: theme.borderColor,
      borderRadius: radius.xl,
      borderWidth: borders.hairline,
      padding: spacing[5],
      width: "100%",
    },
    formTitle: { ...fullWidthText, ...typography.titleMd, color: theme.structure, marginBottom: spacing[4] },
    fieldBlock: { alignItems: "stretch", marginBottom: spacing[3], width: "100%" },
    fieldLabel: { ...fullWidthText, ...typography.bodyStrong, color: theme.structure, marginBottom: spacing[2] },
    input: { ...fullWidthText, backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.structure, ...typography.bodyLg, minHeight: sizing.controlLg, paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
    numericInput: { alignSelf: "stretch", textAlign: "left", writingDirection: "ltr" },
    inputFocused: { borderColor: theme.focusRing, borderWidth: borders.strong },
    revealButton: { alignSelf: "flex-end", justifyContent: "center", minHeight: sizing.controlSm, paddingHorizontal: spacing[1] },
    revealText: { ...typography.label, color: theme.interactiveText, textDecorationLine: "underline" },
    codeAction: { alignSelf: "flex-end", minHeight: sizing.controlSm, paddingHorizontal: spacing[2] },
    modeLinks: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing[4], justifyContent: "center", marginTop: spacing[4] },
    modeLinkText: { ...typography.bodyStrong, color: theme.structure, textDecorationLine: "underline" },
    recoveryAction: { marginTop: spacing[3] },
    status: { ...typography.bodyLg, color: theme.structure, textAlign: "center" },
    muted: { ...typography.body, color: theme.colorMuted, textAlign: "center" },
    notice: { ...fullWidthText, ...typography.bodySm, backgroundColor: theme.actionSoft, borderRadius: radius.sm, color: theme.structure, marginTop: spacing[3], padding: spacing[2] },
    error: { ...fullWidthText, ...typography.bodySm, backgroundColor: theme.dangerSoft, borderRadius: radius.sm, color: theme.danger, marginTop: spacing[3], padding: spacing[2] },
  });
}
