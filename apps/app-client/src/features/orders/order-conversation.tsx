import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, createOrderConversationMessageAttempt, isDefinitiveDshMobileClientRejection, orderConversationMessageAttemptStorageKey, parseOrderConversationMessageAttempt, type OrderConversationMessageAttempt } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";

const conversationRole = "client" as const;

function client() {
  const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!value) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function senderLabel(role: string): string {
  return role === "operator" ? "عمليات بثواني" : role === "client" ? "العميل" : role === "partner" ? "المتجر" : "الكابتن";
}

function conversationActorID(): string { const state = currentIdentityState(); return state.kind === "authenticated" ? state.identity.subject.trim() : ""; }
function isCurrentActor(actorID: string): boolean { return Boolean(actorID) && actorID === conversationActorID(); }

export function OrderConversation({ orderId }: { orderId: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; value: Awaited<ReturnType<ReturnType<typeof client>["readOrderConversation"]>> } | { kind: "error" }>({ kind: "loading" });
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<ReadonlyArray<"client" | "partner" | "captain" | "operator">>(["partner"]);
  const [pendingAttempt, setPendingAttempt] = useState<OrderConversationMessageAttempt | null>(null);
  const [attemptStorageReady, setAttemptStorageReady] = useState(false);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const [loadedActorID, setLoadedActorID] = useState("");
  const [loadedOrderID, setLoadedOrderID] = useState("");
  const readSequence = useRef(0);
  const autoReadReceiptAttempt = useRef("");
  const correctOwner = Boolean(loadedActorID) && loadedActorID === activeActorID && loadedOrderID === orderId && isCurrentActor(loadedActorID);

  const load = useCallback(async (): Promise<boolean> => {
    const sequence = ++readSequence.current;
    const requestedActorID = conversationActorID();
    if (!orderId.trim() || !requestedActorID) { setLoadedActorID(""); setState({ kind: "error" }); return false; }
    setLoadedActorID("");
    setLoadedOrderID("");
    setPendingAttempt(null);
    setState({ kind: "loading" });
    setAttemptStorageReady(false);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      if (actorID !== requestedActorID || sequence !== readSequence.current) return false;
      const rawAttempt = await SecureStore.getItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, actorID, orderId));
      const attempt = parseOrderConversationMessageAttempt(rawAttempt, actorID, orderId);
      if (sequence !== readSequence.current || !isCurrentActor(actorID)) return false;
      setPendingAttempt(attempt);
      if (attempt) setBody(attempt.body);
      setAttemptStorageReady(true);
      const value = await client().readOrderConversation(token, orderId, 100);
      if (sequence !== readSequence.current || !isCurrentActor(actorID)) return false;
      setLoadedActorID(actorID);
      setLoadedOrderID(orderId);
      setState({ kind: "ready", value });
      return true;
    } catch (cause) {
      console.error("DSH client order conversation read failed", cause);
      if (sequence === readSequence.current && isCurrentActor(requestedActorID)) setState({ kind: "error" });
      return false;
    }
  }, [orderId]);

  useEffect(() => subscribeIdentitySession(setIdentityState), []);
  useEffect(() => {
    if (!activeActorID) { readSequence.current += 1; setLoadedActorID(""); setLoadedOrderID(""); setState({ kind: "error" }); setPendingAttempt(null); setAttemptStorageReady(false); setBody(""); return; }
    setBody("");
    setPendingAttempt(null);
    setAttemptStorageReady(false);
    void load();
  }, [activeActorID, load]);

  async function submitAttempt(attempt: OrderConversationMessageAttempt, token: string) {
    if (!correctOwner || !isCurrentActor(attempt.actorID)) return;
    try {
      await client().sendOrderConversationMessage(token, attempt.orderID, { body: attempt.body, ...(attempt.recipientRoles ? { recipientRoles: attempt.recipientRoles } : {}) }, attempt.idempotencyKey, attempt.correlationID);
      if (!isCurrentActor(attempt.actorID)) return;
    } catch (cause) {
      if (!isCurrentActor(attempt.actorID)) return;
      console.error("DSH client order conversation send failed", cause);
      if (isDefinitiveDshMobileClientRejection(cause)) {
        let storageCleared = false;
        try {
          await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, attempt.actorID, attempt.orderID));
          storageCleared = true;
        } catch (cleanupCause) {
          console.error("DSH client rejected order conversation attempt cleanup failed", cleanupCause);
        }
        if (!isCurrentActor(attempt.actorID)) return;
        setPendingAttempt(storageCleared ? null : attempt);
        setBody(storageCleared ? "" : attempt.body);
        await load();
        if (!isCurrentActor(attempt.actorID)) return;
        setError(storageCleared ? "رفض الخادم إرسال الرسالة؛ حدّثنا حالة المحادثة ويمكنك تعديل الرسالة والمحاولة مجددًا." : "رفض الخادم إرسال الرسالة، وتعذر حذف محاولة الاستعادة المحفوظة. أعد القراءة قبل أي محاولة جديدة.");
        return;
      }
      setPendingAttempt(attempt);
      setBody(attempt.body);
      setError("لم نتأكد من نتيجة الإرسال. بقيت الرسالة محفوظة؛ أعد المحاولة من الزر نفسه لتجنب تكرارها.");
      return;
    }

    let storageCleared = false;
    try {
      await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, attempt.actorID, attempt.orderID));
      storageCleared = true;
    } catch (cause) {
      console.error("DSH client order conversation recovery record cleanup failed", cause);
    }
    if (!isCurrentActor(attempt.actorID)) return;
    setPendingAttempt(storageCleared ? null : attempt);
    setBody(storageCleared ? "" : attempt.body);
    const refreshed = await load();
    if (!isCurrentActor(attempt.actorID)) return;
    if (!storageCleared) setError("تأكد إرسال الرسالة، وبقيت المحاولة محفوظة. أعد المحاولة من الزر نفسه لتجنب تكرارها.");
    else if (!refreshed) setError("تأكد إرسال الرسالة، لكن تعذر تحديث سجل المحادثة.");
  }

  async function send() {
    const normalized = body.trim();
    if (!correctOwner || !normalized || busy || !attemptStorageReady || pendingAttempt || !selectedRecipients.length || state.kind !== "ready" || !state.value.canSend) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CLIENT_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      if (!isCurrentActor(actorID) || actorID !== loadedActorID) return;
      const attempt = createOrderConversationMessageAttempt(actorID, orderId, normalized, `conversation_${Crypto.randomUUID()}`, `conversation_corr_${Crypto.randomUUID()}`, selectedRecipients);
      await SecureStore.setItemAsync(orderConversationMessageAttemptStorageKey(conversationRole, actorID, orderId), JSON.stringify(attempt));
      if (!isCurrentActor(actorID)) return;
      setPendingAttempt(attempt);
      await submitAttempt(attempt, token);
    } catch (cause) {
      console.error("DSH client order conversation attempt could not be saved", cause);
      setError("تعذر حفظ محاولة الرسالة بأمان؛ لم تُرسل.");
    } finally { setBusy(false); }
  }

  async function retryPendingAttempt() {
    const attempt = pendingAttempt;
    if (!correctOwner || !attempt || !isCurrentActor(attempt.actorID) || busy || !attemptStorageReady) return;
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
    if (!correctOwner || busy || state.kind !== "ready") return;
    const last = state.value.messages.at(-1);
    if (!last || state.value.unreadCount < 1) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrentActor(loadedActorID)) return; await client().markOrderConversationRead(token, orderId, { messageId: last.id });
      await load();
    } catch (cause) {
      console.error("DSH client order conversation read-state write failed", cause);
      setError("تعذر تحديث حالة القراءة.");
    } finally { setBusy(false); }
  }

  const captainAvailable = state.kind === "ready" && ["CAPTAIN_ASSIGNED", "IN_CUSTODY", "DELIVERY_FAILED"].includes(state.value.orderState);
  const recipientOptions = [
    { role: "partner" as const, label: "المتجر" },
    ...(captainAvailable ? [{ role: "captain" as const, label: "الكابتن" }] : []),
    { role: "operator" as const, label: "العمليات" },
  ];
  useEffect(() => {
    if (!correctOwner || state.kind !== "ready" || !state.value.unreadCount || busy) return;
    const last = state.value.messages.at(-1);
    if (!last) return;
    const key = loadedActorID + ":" + orderId + ":" + last.id;
    if (autoReadReceiptAttempt.current === key) return;
    autoReadReceiptAttempt.current = key;
    void markRead();
  }, [correctOwner, state, busy, loadedActorID, orderId]);

  if (!activeActorID || (loadedActorID && !correctOwner)) return <BthwaniSurface tone="base" style={styles.surface} accessibilityLabel="محادثة الطلب"><Text style={styles.muted}>{activeActorID ? "جارٍ التحقق من محادثة الحساب الحالي…" : "سجّل الدخول لقراءة محادثة الطلب."}</Text></BthwaniSurface>;
  return <BthwaniSurface tone="base" style={styles.surface} accessibilityLabel="محادثة الطلب">
    <View style={styles.header}><View><Text style={styles.title}>محادثة الطلب</Text><Text style={styles.muted}>تواصل تشغيلي مرتبط بهذا الطلب فقط.</Text></View>{state.kind === "ready" && state.value.unreadCount > 0 ? <Text style={styles.unread}>{state.value.unreadCount} غير مقروء</Text> : null}</View>
    {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المحادثة…</Text></View> : null}
    {state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة المحادثة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />{pendingAttempt ? <BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /> : null}</View> : null}
    {state.kind === "ready" ? <>
      {!state.value.messages.length ? <Text style={styles.muted}>لا توجد رسائل بعد.</Text> : <View style={styles.messages}>{state.value.messages.map((message) => <View key={message.id} style={[styles.message, message.mine ? styles.mine : null]}><Text style={styles.sender}>{message.mine ? "أنت" : senderLabel(message.senderRole)}</Text><Text style={styles.body}>{message.body}</Text><Text style={styles.time}>{new Date(message.createdAt).toLocaleString("ar-YE")}</Text></View>)}</View>}
      {pendingAttempt ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>المحاولة محفوظة لهذا الحساب والطلب. سنتحقق من نتيجتها قبل إعادة الإرسال.</Text><BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /></View> : state.value.canSend ? <><View style={{ gap: spacing[2] }}><Text style={styles.muted}>إرسال إلى:</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[2] }}>{recipientOptions.map(item => <BthwaniButton key={item.role} label={selectedRecipients.includes(item.role) ? "✓ " + item.label : item.label} disabled={busy} variant={selectedRecipients.includes(item.role) ? "primary" : "secondary"} onPress={() => setSelectedRecipients(roles => roles.includes(item.role) ? roles.filter(r => r !== item.role) : [...roles, item.role])} />)}<BthwaniButton label="الجميع" disabled={busy} variant="secondary" onPress={() => setSelectedRecipients(recipientOptions.map(item => item.role))} /></View><Text style={styles.muted}>العمليات المخولة تستطيع مراجعة الرسائل ولو لم تخترها.</Text></View><TextInput accessibilityLabel="رسالة المحادثة" editable={!busy} maxLength={2000} multiline onChangeText={setBody} placeholder="اكتب رسالة تشغيلية قصيرة" placeholderTextColor={theme.colorMuted} style={styles.input} textAlign="right" value={body} /><BthwaniButton busy={busy} disabled={busy || !attemptStorageReady || !body.trim() || !selectedRecipients.length} label="إرسال الرسالة" onPress={() => void send()} /></> : <Text style={styles.muted}>أُغلقت المحادثة للكتابة، ويمكنك قراءة سجلها فقط.</Text>}
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
