import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, createOrderConversationMessageAttempt, isDefinitiveDshMobileClientRejection, orderConversationMessageAttemptStorageKey, parseOrderConversationMessageAttempt, type OrderConversationMessageAttempt } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

const conversationRole = "client" as const;

function client() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function senderLabel(role: string): string {
  return role === "client" ? "العميل" : role === "partner" ? "المتجر" : "الكابتن";
}

export function OrderConversation({ orderId }: { orderId: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; value: Awaited<ReturnType<ReturnType<typeof client>["readOrderConversation"]>> } | { kind: "error" }>({ kind: "loading" });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingAttempt, setPendingAttempt] = useState<OrderConversationMessageAttempt | null>(null);
  const [attemptStorageReady, setAttemptStorageReady] = useState(false);

  const load = useCallback(async (): Promise<boolean> => {
    if (!orderId.trim()) return false;
    setAttemptStorageReady(false);
    setState((current) => current.kind === "ready" ? current : { kind: "loading" });
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const rawAttempt = await SecureStore.getItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, actorID, orderId));
      const attempt = parseOrderConversationMessageAttempt(rawAttempt, actorID, orderId);
      setPendingAttempt(attempt);
      if (attempt) setBody(attempt.body);
      setAttemptStorageReady(true);
      setState({ kind: "ready", value: await client().readOrderConversation(token, orderId, 100) });
      return true;
    } catch (cause) {
      console.error("DSH client order conversation read failed", cause);
      setState({ kind: "error" });
      return false;
    }
  }, [orderId]);

  useEffect(() => { setBody(""); setPendingAttempt(null); void load(); }, [load]);

  async function submitAttempt(attempt: OrderConversationMessageAttempt, token: string) {
    try {
      await client().sendOrderConversationMessage(token, attempt.orderID, { body: attempt.body }, attempt.idempotencyKey, attempt.correlationID);
    } catch (cause) {
      console.error("DSH client order conversation send failed", cause);
      if (isDefinitiveDshMobileClientRejection(cause)) {
        let storageCleared = false;
        try {
          await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, attempt.actorID, attempt.orderID));
          storageCleared = true;
        } catch (cleanupCause) {
          console.error("DSH client rejected order conversation attempt cleanup failed", cleanupCause);
        }
        setPendingAttempt(storageCleared ? null : attempt);
        setBody(storageCleared ? "" : attempt.body);
        await load();
        setError(storageCleared ? "رفض الخادم إرسال الرسالة؛ حدّثنا حالة المحادثة ويمكنك تعديل الرسالة والمحاولة مجددًا." : "رفض الخادم إرسال الرسالة، وتعذر حذف محاولة الاستعادة المحفوظة. أعد القراءة قبل أي محاولة جديدة.");
        return;
      }
      setPendingAttempt(attempt);
      setBody(attempt.body);
      setError("لم نتأكد من نتيجة الإرسال. بقيت الرسالة محفوظة؛ أعد المحاولة بالمفتاح نفسه لتفادي تكرارها.");
      return;
    }

    let storageCleared = false;
    try {
      await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, attempt.actorID, attempt.orderID));
      storageCleared = true;
    } catch (cause) {
      console.error("DSH client order conversation recovery record cleanup failed", cause);
    }
    setPendingAttempt(storageCleared ? null : attempt);
    setBody(storageCleared ? "" : attempt.body);
    const refreshed = await load();
    if (!storageCleared) setError("تأكد إرسال الرسالة، وبقي سجل الاستعادة المحلي. إعادة المحاولة بالمفتاح نفسه آمنة.");
    else if (!refreshed) setError("تأكد إرسال الرسالة، لكن تعذر تحديث سجل المحادثة.");
  }

  async function send() {
    const normalized = body.trim();
    if (!normalized || busy || !attemptStorageReady || pendingAttempt || state.kind !== "ready" || !state.value.canSend) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      const attempt = createOrderConversationMessageAttempt(actorID, orderId, normalized, `conversation_${Crypto.randomUUID()}`, `conversation_corr_${Crypto.randomUUID()}`);
      await SecureStore.setItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, actorID, orderId), JSON.stringify(attempt));
      setPendingAttempt(attempt);
      await submitAttempt(attempt, token);
    } catch (cause) {
      console.error("DSH client order conversation attempt could not be saved", cause);
      setError("تعذر حفظ محاولة الرسالة بأمان؛ لم تُرسل.");
    } finally { setBusy(false); }
  }

  async function retryPendingAttempt() {
    const attempt = pendingAttempt;
    if (!attempt || busy || !attemptStorageReady) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || identity.identity.subject.trim() !== attempt.actorID) throw new Error("CLIENT_SESSION_CHANGED");
      await submitAttempt(attempt, token);
    } catch (cause) {
      console.error("DSH client order conversation recovery failed", cause);
      setError("تعذر التحقق من جلسة صاحب المحاولة. بقيت الرسالة محفوظة كما هي.");
    } finally { setBusy(false); }
  }

  async function markRead() {
    if (busy || state.kind !== "ready") return;
    const last = state.value.messages.at(-1);
    if (!last || state.value.unreadCount < 1) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().markOrderConversationRead(token, orderId, { messageId: last.id });
      await load();
    } catch (cause) {
      console.error("DSH client order conversation read-state write failed", cause);
      setError("تعذر تحديث حالة القراءة.");
    } finally { setBusy(false); }
  }

  return <BthwaniSurface tone="base" style={styles.surface} accessibilityLabel="محادثة الطلب">
    <View style={styles.header}><View><Text style={styles.title}>محادثة الطلب</Text><Text style={styles.muted}>تواصل تشغيلي مرتبط بهذا الطلب فقط.</Text></View>{state.kind === "ready" && state.value.unreadCount > 0 ? <Text style={styles.unread}>{state.value.unreadCount} غير مقروء</Text> : null}</View>
    {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المحادثة…</Text></View> : null}
    {state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة المحادثة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />{pendingAttempt ? <BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /> : null}</View> : null}
    {state.kind === "ready" ? <>
      {!state.value.messages.length ? <Text style={styles.muted}>لا توجد رسائل بعد.</Text> : <View style={styles.messages}>{state.value.messages.map((message) => <View key={message.id} style={[styles.message, message.mine ? styles.mine : null]}><Text style={styles.sender}>{message.mine ? "أنت" : senderLabel(message.senderRole)}</Text><Text style={styles.body}>{message.body}</Text><Text style={styles.time}>{new Date(message.createdAt).toLocaleString("ar-YE")}</Text></View>)}</View>}
      {state.value.unreadCount > 0 ? <BthwaniButton busy={busy} disabled={busy} label="تحديد الرسائل كمقروءة" onPress={() => void markRead()} variant="secondary" /> : null}
      {pendingAttempt ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>المحاولة محفوظة لهذا الحساب والطلب. ستُعاد بالمفتاح نفسه حتى نتأكد من نتيجتها.</Text><BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /></View> : state.value.canSend ? <><TextInput accessibilityLabel="رسالة المحادثة" editable={!busy} maxLength={2000} multiline onChangeText={setBody} placeholder="اكتب رسالة تشغيلية قصيرة" placeholderTextColor={theme.colorMuted} style={styles.input} textAlign="right" value={body} /><BthwaniButton busy={busy} disabled={busy || !attemptStorageReady || !body.trim()} label="إرسال الرسالة" onPress={() => void send()} /></> : <Text style={styles.muted}>أُغلقت المحادثة للكتابة، ويمكنك قراءة سجلها فقط.</Text>}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </BthwaniSurface>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  surface: { borderColor: theme.borderColor, borderRadius: radius.lg, borderWidth: borders.hairline, gap: spacing[3], padding: spacing[4] },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" },
  title: { ...typography.titleSm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, unread: { ...typography.label, color: theme.interactiveText },
  messages: { gap: spacing[2] }, message: { alignSelf: "flex-start", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], maxWidth: "92%", padding: spacing[3] }, mine: { alignSelf: "flex-end", backgroundColor: theme.actionSoft }, sender: { ...typography.label, color: theme.interactiveText }, body: { ...typography.body, color: theme.color }, time: { ...typography.caption, color: theme.colorMuted }, input: { ...typography.body, backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 72, padding: spacing[3] }, state: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, error: { ...typography.bodySm, color: theme.warning },
}); }
