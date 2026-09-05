import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { IdentitySessionState } from "@bthwani/identity";
import {
  currentIdentityState,
  loginClient,
  logoutIdentity,
  recoverClient,
  registerClient,
  requestClientRecovery,
  requestClientRegistration,
  restoreIdentitySession,
} from "../src/identity";

type AuthMode = "login" | "register" | "recover";

function messageOf(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "تعذر إكمال عملية الهوية.";
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
        <ActivityIndicator />
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
    (!needsProof || (proofRequested && code.trim().length === 6));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>بثواني</Text>
      <View style={styles.modeRow}>
        <Pressable onPress={() => selectMode("login")} style={styles.modeButton}>
          <Text style={styles.secondaryButtonText}>دخول</Text>
        </Pressable>
        <Pressable onPress={() => selectMode("register")} style={styles.modeButton}>
          <Text style={styles.secondaryButtonText}>حساب جديد</Text>
        </Pressable>
        <Pressable onPress={() => selectMode("recover")} style={styles.modeButton}>
          <Text style={styles.secondaryButtonText}>نسيت كلمة المرور</Text>
        </Pressable>
      </View>

      <TextInput
        autoCapitalize="none"
        keyboardType="phone-pad"
        onChangeText={setPhone}
        placeholder="+967..."
        style={styles.input}
        value={phone}
      />

      {needsProof ? (
        <>
          <Pressable disabled={busy || !phone.trim()} onPress={requestProof} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>
              {proofRequested ? "إعادة إرسال رمز التحقق" : "إرسال رمز التحقق"}
            </Text>
          </Pressable>
          <TextInput
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            placeholder="رمز التحقق"
            secureTextEntry
            style={styles.input}
            value={code}
          />
        </>
      ) : null}

      <TextInput
        autoCapitalize="none"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        onChangeText={setPassword}
        placeholder={mode === "recover" ? "كلمة المرور الجديدة" : "كلمة المرور"}
        secureTextEntry
        style={styles.input}
        value={password}
      />

      <Pressable disabled={busy || !canSubmit} onPress={submit} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>
          {busy ? "جارٍ التنفيذ…" : mode === "login" ? "تسجيل الدخول" : mode === "register" ? "إنشاء الحساب" : "تعيين كلمة المرور"}
        </Text>
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "stretch", justifyContent: "center", padding: 24, gap: 12 },
  title: { textAlign: "center", fontSize: 26, fontWeight: "700" },
  status: { textAlign: "center", fontSize: 17, fontWeight: "600" },
  muted: { textAlign: "center", fontSize: 14, opacity: 0.7 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeButton: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  primaryButton: { borderRadius: 10, padding: 14, alignItems: "center", backgroundColor: "#111" },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: { borderWidth: 1, borderRadius: 10, padding: 12, alignItems: "center" },
  secondaryButtonText: { fontWeight: "600", textAlign: "center" },
  notice: { textAlign: "center", fontSize: 13 },
  error: { textAlign: "center", fontSize: 13 },
});
