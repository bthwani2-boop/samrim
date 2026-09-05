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
  activateIdentity,
  currentIdentityState,
  logoutIdentity,
  restoreIdentitySession,
} from "../src/identity";

function messageOf(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "تعذر إكمال عملية الهوية.";
}

export default function IdentityGate() {
  const [state, setState] = useState<IdentitySessionState>({ kind: "restoring" });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
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

  async function activate() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setState(await activateIdentity(phone, code));
      setCode("");
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
      // IdentitySessionManager changes its state only after local SecureStore
      // clearing succeeds. Mirror that canonical state even when remote revoke fails.
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
        <Text style={styles.title}>بثواني الشريك</Text>
        <Text style={styles.status}>الهوية مفعلة</Text>
        <Text style={styles.muted}>الشريك: {state.identity.subject}</Text>
        <Text style={styles.muted}>السطح: {state.identity.surface}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={busy} onPress={logout} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{busy ? "جارٍ التنفيذ…" : "تسجيل الخروج"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>بثواني الشريك</Text>
      <Text style={styles.status}>
        {state.kind === "service_unavailable" ? "خدمة الهوية غير متاحة" : "تفعيل الهوية"}
      </Text>
      {state.kind === "service_unavailable" ? (
        <Pressable disabled={busy} onPress={restore} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>إعادة التحقق</Text>
        </Pressable>
      ) : (
        <>
          <TextInput
            autoCapitalize="none"
            keyboardType="phone-pad"
            onChangeText={setPhone}
            placeholder="+967..."
            style={styles.input}
            value={phone}
          />
          <TextInput
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            placeholder="رمز التفعيل"
            secureTextEntry
            style={styles.input}
            value={code}
          />
          <Pressable
            disabled={busy || !phone.trim() || code.trim().length !== 6}
            onPress={activate}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{busy ? "جارٍ التحقق…" : "تفعيل"}</Text>
          </Pressable>
        </>
      )}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    textAlign: "center",
    fontSize: 26,
    fontWeight: "700",
  },
  status: {
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
  muted: {
    textAlign: "center",
    fontSize: 14,
    opacity: 0.7,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryButton: {
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    backgroundColor: "#111",
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontWeight: "600",
  },
  notice: {
    textAlign: "center",
    fontSize: 13,
  },
  error: {
    textAlign: "center",
    fontSize: 13,
  },
});
