import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, useColorScheme } from "react-native";
import * as Crypto from "expo-crypto";

import { resolveTheme } from "@bthwani/design-system";
import type { CatalogItem, CatalogPublicationState } from "@bthwani/dsh";
import { createDshMobileClient } from "@bthwani/dsh";
import { readIdentityAccessToken } from "../../bootstrap/identity";

type CatalogState = { kind: "loading" } | { kind: "ready"; items: ReadonlyArray<CatalogItem> } | { kind: "error" };

function baseUrl(): string {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return value;
}

const dshClient = () => createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { kind?: unknown; status?: unknown; code?: unknown; message?: unknown };
    if (value.kind === "http" && value.status === 401) return "انتهت جلسة الشريك. أنهِ الجلسة ثم سجّل الدخول مجدداً.";
    if (value.kind === "http" && value.status === 403) return "لا تملك جلسة الشريك صلاحية إدارة هذا المتجر.";
    if (value.kind === "http" && value.status === 404) return "لم يعد المتجر أو عنصر الكتالوج متاحاً.";
    if (value.kind === "http" && value.status === 409) return "تعارض في إصدار الكتالوج أو مفتاح العملية. أعد القراءة ثم حاول مرة أخرى.";
    if (value.code === "DSH_IDEMPOTENCY_KEY_GENERATOR_REQUIRED") return "تعذر تجهيز عملية الكتالوج على هذا الجهاز.";
    if (value.kind === "network") return "تعذر الاتصال بخدمة الكتالوج. تحقق من الاتصال ثم أعد المحاولة.";
    if (typeof value.message === "string" && value.message === "DSH_IDEMPOTENCY_KEY_GENERATOR_REQUIRED") return "تعذر تجهيز عملية الكتالوج على هذا الجهاز.";
  }
  return "تعذر الوصول إلى كتالوج المتجر. تحقق من الاتصال ثم أعد المحاولة.";
}

function reportCatalogError(error: unknown): void {
  if (error && typeof error === "object") {
    const value = error as { kind?: unknown; status?: unknown; code?: unknown; message?: unknown };
    console.error("DSH catalog request failed", {
      kind: typeof value.kind === "string" ? value.kind : "unknown",
      status: typeof value.status === "number" ? value.status : undefined,
      code: typeof value.code === "string" ? value.code : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
    });
    return;
  }
  console.error("DSH catalog request failed", { kind: "unknown" });
}

export function CatalogManagement({ storeId }: { storeId: string }) {
  const theme = resolveTheme(useColorScheme() === "dark" ? "dark" : "light");
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      const items = await dshClient().readOwnStoreCatalog(token, storeId);
      setState({ kind: "ready", items });
    } catch (nextError) {
      reportCatalogError(nextError);
      setState({ kind: "error" });
      setError(errorText(nextError));
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  async function createItem() {
    if (name.trim().length < 1 || busy) return;
    setBusy(true);
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      await dshClient().createCatalogItem(token, storeId, name.trim());
      setName("");
      await load();
    } catch (nextError) {
      reportCatalogError(nextError);
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function updateItem(item: CatalogItem, publicationState: CatalogPublicationState, availability: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const token = readIdentityAccessToken();
      if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
      await dshClient().updateCatalogItem(token, storeId, item.itemId, item.name, publicationState, availability, item.version);
      await load();
    } catch (nextError) {
      reportCatalogError(nextError);
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="إدارة كتالوج المتجر">
      <Text style={styles.title}>كتالوج المتجر</Text>
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة الكتالوج…</Text></View> : null}
      {state.kind === "error" ? <View style={styles.state}><Text style={styles.muted}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>إعادة المحاولة</Text></Pressable></View> : null}
      {state.kind === "ready" ? <>
        <View style={styles.form}><TextInput accessibilityLabel="اسم عنصر الكتالوج" editable={!busy} onChangeText={setName} placeholder="اسم العنصر" value={name} style={styles.input} /><Pressable accessibilityRole="button" disabled={busy || name.trim().length < 1} onPress={() => void createItem()} style={styles.button}><Text style={styles.buttonText}>إضافة عنصر</Text></Pressable></View>
        {state.items.length === 0 ? <Text style={styles.muted}>لا توجد عناصر بعد.</Text> : state.items.map((item) => <View key={item.itemId} style={styles.item}><View style={styles.itemText}><Text style={styles.itemTitle}>{item.name}</Text><Text style={styles.muted}>الإصدار {item.version} · {item.publicationState}</Text></View><Switch accessibilityLabel={`إتاحة ${item.name}`} disabled={busy} onValueChange={(available) => void updateItem(item, item.publicationState, available)} value={item.availability} /><Pressable accessibilityRole="button" disabled={busy} onPress={() => void updateItem(item, item.publicationState === "published" ? "hidden" : "published", item.availability)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{item.publicationState === "published" ? "إخفاء" : "نشر"}</Text></Pressable></View>)}
      </> : null}
      {error && state.kind !== "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, gap: 12, marginTop: 16, padding: 14, width: "100%" },
    state: { alignItems: "center", gap: 8 },
    title: { color: theme.structure, fontSize: 17, fontWeight: "800" },
    item: { alignItems: "center", borderColor: theme.borderColor, borderTopWidth: 1, flexDirection: "row", gap: 10, paddingTop: 12 },
    itemText: { flex: 1, gap: 3 },
    itemTitle: { color: theme.structure, fontSize: 15, fontWeight: "700" },
    muted: { color: theme.colorMuted, fontSize: 13 },
    form: { flexDirection: "row", gap: 8 },
    input: { borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, color: theme.structure, flex: 1, minHeight: 44, paddingHorizontal: 10 },
    button: { alignItems: "center", backgroundColor: theme.actionBackground, borderRadius: 8, justifyContent: "center", minHeight: 44, paddingHorizontal: 12 },
    buttonText: { color: theme.surface, fontWeight: "800" },
    secondaryButton: { alignItems: "center", borderColor: theme.borderColor, borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 10 },
    secondaryButtonText: { color: theme.structure, fontSize: 13, fontWeight: "700" },
    error: { color: theme.danger, fontSize: 13 },
  });
}
