import { direction as designDirection, resolveRowDirection, resolveTextAlign, resolveTextInputAlign, resolveTheme, toAsciiDigits } from "@bthwani/design-system";
import { type IdentitySessionState, identityErrorMessage, identitySessionSignOutMessage, isIdentityClientError, limitPasswordInput, validatePasswordInputShape } from "@bthwani/identity";
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
  useColorScheme,
  View,
} from "react-native";
import {
  currentIdentityState,
  loginClient,
  logoutIdentity,
  recoverClient,
  registerClient,
  requestClientRecovery,
  requestClientRegistration,
  restoreIdentitySession,
  subscribeIdentitySession,
} from "../../bootstrap/identity";
import LocationCore from "../location-core/location-core";
import ClientOrders from "../orders/orders";
import ServiceCityScope from "../service-city/service-city-scope";
import StoreDiscovery from "../store-discovery/store-discovery";
import { type IdentityCopy, identityPresentation } from "./identity-presentation";

type AuthMode = "login" | "register" | "recover";
type FieldName = "phone" | "code" | "password" | "passwordConfirmation";

function getColors(isDark: boolean) {
  const theme = resolveTheme(isDark ? "dark" : "light");
  return {
    background: theme.background,
    border: theme.borderColor,
    focus: theme.focusRing,
    muted: theme.colorMuted,
    navy: theme.structure,
    brandAction: theme.brandAction,
    actionBackground: theme.actionBackground,
    interactiveText: theme.interactiveText,
    surface: theme.surface,
    disabled: theme.disabledBackground,
    disabledText: theme.disabledText,
    dangerBackground: theme.dangerSoft,
    danger: theme.danger,
    noticeBackground: theme.actionSoft,
  };
}

type GateColors = ReturnType<typeof getColors>;

const modeDetails = {
  login: "loginTitle",
  register: "registerTitle",
  recover: "recoverTitle",
} as const satisfies Record<AuthMode, keyof IdentityCopy>;

function isCredentialFailure(value: unknown): boolean {
  return isIdentityClientError(value) && value.kind === "http" && value.status === 401;
}

export default function IdentityGate() {
  const colorScheme = useColorScheme();
  const { copy } = identityPresentation;
  const isDark = colorScheme === "dark";
  const colors = useMemo(() => getColors(isDark), [isDark]);
  const styles = useMemo(() => createStyles(colors, designDirection.defaultDirection), [colors]);

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

  const publicDiscovery = <View style={styles.publicDiscovery}><ServiceCityScope><StoreDiscovery isAuthenticated={state.kind === "authenticated"} onRequireAuthentication={state.kind === "signed_out" ? requestAuthentication : undefined} /></ServiceCityScope></View>;

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

  async function logout() {
    setBusy(true);
    setError("");
    setNotice("");
    let remoteRevocationConfirmed = true;
    try {
      await logoutIdentity();
    } catch {
      remoteRevocationConfirmed = false;
    } finally {
      setState(currentIdentityState());
      resetSignedOutAuthState();
      setAuthPromptVisible(false);
      if (!remoteRevocationConfirmed) setNotice(copy.remoteLogoutFailure);
      setBusy(false);
    }
  }

  if (state.kind === "restoring") {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.actionBackground} />
        <Text style={styles.muted}>{copy.restoringSession}</Text>
        {publicDiscovery}
      </View>
    );
  }

  if (state.kind === "authenticated") {
    return (
      <ScrollView contentContainerStyle={styles.authenticatedScrollContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.container}>
          <Text style={styles.title}>{copy.brand}</Text>
          <Text style={styles.status}>{copy.authenticatedStatus}</Text>
          <ServiceCityScope>
            <StoreDiscovery isAuthenticated />
            <LocationCore />
          </ServiceCityScope>
          <ClientOrders />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.logout}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={logout}
            style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
          >
            <Text style={[styles.primaryButtonText, busy && styles.primaryButtonTextDisabled]}>{busy ? copy.busyAction : copy.logout}</Text>
          </Pressable>
      </ScrollView>
    );
  }

  if (state.kind === "degraded") {
    const conflict = state.reason === "refresh_conflict";
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{copy.brand}</Text>
        <Text style={styles.status}>{conflict ? copy.refreshingSession : copy.serviceUnavailable}</Text>
        {conflict ? <Text style={styles.muted}>{copy.refreshConflict}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={conflict ? copy.syncSession : copy.retryVerification}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={restore}
          style={[styles.secondaryButton, busy && styles.secondaryButtonDisabled]}
        >
          <Text style={[styles.secondaryButtonText, busy && styles.disabledText]}>{busy ? copy.syncing : conflict ? copy.syncSession : copy.retryVerification}</Text>
        </Pressable>
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
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.numericInput, focusedField === "phone" && styles.inputFocused]}
                value={phone}
              />
            </View>

            {needsProof ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={proofRequested ? copy.resendCode : copy.sendCode}
                  accessibilityState={{ busy, disabled: busy || !phone.trim() }}
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
                    {proofRequested ? copy.resendCode : copy.sendCode}
                  </Text>
                </Pressable>

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
                        placeholderTextColor={colors.muted}
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
                        placeholderTextColor={colors.muted}
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
                        placeholderTextColor={colors.muted}
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
                  placeholderTextColor={colors.muted}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy[modeDetails[mode]]}
                accessibilityState={{ busy, disabled: busy || !canSubmit }}
                disabled={busy || !canSubmit}
                onPress={submit}
                style={[styles.primaryButton, (busy || !canSubmit) && styles.primaryButtonDisabled]}
              >
                <Text style={[styles.primaryButtonText, (busy || !canSubmit) && styles.primaryButtonTextDisabled]}>
                  {busy ? copy.busyAction : mode === "login" ? copy.loginButton : mode === "register" ? copy.registerButton : copy.recoverButton}
                </Text>
              </Pressable>
            ) : null}

            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
            {error ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

            {mode === "login" && loginFailed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.forgotPassword}
                  accessibilityState={{ busy, disabled: busy }}
                  disabled={busy}
                  onPress={() => selectMode("recover")}
                  style={[styles.recoveryButton, busy && styles.secondaryButtonDisabled]}
                >
                <Text style={[styles.recoveryButtonText, busy && styles.disabledText]}>{copy.forgotPassword}</Text>
              </Pressable>
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

function createStyles(colors: GateColors, activeDirection: "rtl" | "ltr") {
  const startTextAlign = resolveTextAlign("start", activeDirection);
  const startInputTextAlign = resolveTextInputAlign("start", activeDirection);
  const endCrossAxisAlignment = activeDirection === "rtl" ? "flex-end" : "flex-start";
  const logicalText = {
    textAlign: startTextAlign,
    writingDirection: activeDirection,
  };
  const fullWidthLogicalText = { ...logicalText, width: "100%" as const };
  const fullWidthLogicalInput = { ...fullWidthLogicalText, textAlign: startInputTextAlign };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, direction: activeDirection },
    publicDiscovery: { flexShrink: 0, minHeight: 260, paddingVertical: 16, width: "100%", direction: activeDirection },
    authenticatedScrollContent: { alignItems: "stretch", flexGrow: 1, gap: 16, paddingBottom: 160, paddingHorizontal: 20, paddingTop: 32, width: "100%", direction: activeDirection },
    scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32, direction: activeDirection },
    authShell: { width: "100%", maxWidth: 480, alignSelf: "center", direction: activeDirection },
    brandBlock: { alignItems: "center", marginBottom: 24, direction: activeDirection },
    brand: { color: colors.navy, fontSize: 34, fontWeight: "800", textAlign: "center", writingDirection: activeDirection },
    brandAccent: { backgroundColor: colors.brandAction, borderRadius: 3, height: 4, marginTop: 8, width: 42 },
    title: { color: colors.navy, fontSize: 28, fontWeight: "800", textAlign: "center", writingDirection: activeDirection },
    authCard: {
      alignItems: "stretch",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 24,
      borderWidth: 1,
      direction: activeDirection,
      padding: 20,
      width: "100%",
      shadowColor: colors.navy,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.08,
      shadowRadius: 20,
      elevation: 3,
    },
    formTitle: { ...fullWidthLogicalText, color: colors.navy, fontSize: 22, fontWeight: "800", marginBottom: 16 },
    fieldBlock: { alignItems: "stretch", marginBottom: 14, width: "100%" },
    fieldLabel: { ...fullWidthLogicalText, color: colors.navy, fontSize: 14, fontWeight: "700", marginBottom: 7 },
    input: { ...fullWidthLogicalInput, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, color: colors.navy, fontSize: 16, minHeight: 54, paddingHorizontal: 15, paddingVertical: 13 },
    numericInput: { alignSelf: "stretch", textAlign: resolveTextInputAlign("start", "ltr"), writingDirection: "ltr" },
    inputFocused: { borderColor: colors.focus, borderWidth: 2 },
    revealButton: { alignSelf: endCrossAxisAlignment, minHeight: 40, justifyContent: "center", paddingHorizontal: 4 },
    revealText: { color: colors.interactiveText, fontSize: 13, fontWeight: "700", textDecorationLine: "underline", writingDirection: activeDirection },
    codeAction: { alignSelf: endCrossAxisAlignment, paddingBottom: 8, paddingTop: 2 },
    codeActionText: { color: colors.interactiveText, fontSize: 14, fontWeight: "800" },
    codeActionPrimary: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.actionBackground, borderRadius: 14, justifyContent: "center", minHeight: 54, paddingHorizontal: 16 },
    codeActionPrimaryText: { color: colors.surface, fontSize: 16 },
    codeActionDisabled: { backgroundColor: colors.disabled },
    modeLinks: { alignItems: "center", flexDirection: resolveRowDirection(activeDirection), flexWrap: "wrap", gap: 18, justifyContent: "center", marginTop: 16 },
    modeLinkText: { color: colors.navy, fontSize: 14, fontWeight: "800", textDecorationLine: "underline", writingDirection: activeDirection },
    recoveryButton: { alignItems: "center", borderColor: colors.interactiveText, borderRadius: 14, borderWidth: 1, justifyContent: "center", marginTop: 14, minHeight: 48, paddingHorizontal: 16 },
    recoveryButtonText: { color: colors.interactiveText, fontSize: 15, fontWeight: "800" },
    disabledText: { color: colors.disabledText },
    status: { color: colors.navy, fontSize: 17, fontWeight: "600", textAlign: "center", writingDirection: activeDirection },
    muted: { color: colors.muted, fontSize: 14, textAlign: "center", writingDirection: activeDirection },
    secondaryButton: { alignItems: "center", borderColor: colors.border, borderRadius: 14, borderWidth: 1, justifyContent: "center", minHeight: 50, paddingHorizontal: 16 },
    secondaryButtonDisabled: { backgroundColor: colors.disabled, borderColor: colors.disabled },
    secondaryButtonText: { color: colors.navy, fontSize: 15, fontWeight: "700", textAlign: "center" },
    primaryButton: { alignItems: "center", backgroundColor: colors.actionBackground, borderRadius: 14, justifyContent: "center", minHeight: 54, paddingHorizontal: 16 },
    primaryButtonDisabled: { backgroundColor: colors.disabled },
    primaryButtonText: { color: colors.surface, fontSize: 16, fontWeight: "800" },
    primaryButtonTextDisabled: { color: colors.disabledText },
    notice: { ...fullWidthLogicalText, backgroundColor: colors.noticeBackground, borderRadius: 12, color: colors.navy, fontSize: 13, marginTop: 14, padding: 10 },
    error: { ...fullWidthLogicalText, backgroundColor: colors.dangerBackground, borderRadius: 12, color: colors.danger, fontSize: 13, marginTop: 14, padding: 10 },
  });
}
