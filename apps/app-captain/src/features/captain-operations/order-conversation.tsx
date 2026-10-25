import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniOrderChatComposer, BthwaniSurface, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, createOrderConversationMessageAttempt, isDefinitiveDshMobileClientRejection, orderConversationMessageAttemptStorageKey, parseOrderConversationMessageAttempt, type OrderConversationMessageAttempt } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { OrderConversationMediaMessage } from "./order-conversation-media";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession, role } from "../../bootstrap/identity";

function client() { const value = process.env.EXPO_PUBLIC_DSH_API_URL?.trim(); if (!value) throw new Error("DSH_BASE_URL_REQUIRED"); return createDshMobileClient(value, { cryptoRandomUUID: () => Crypto.randomUUID() }); }
function senderLabel(role: string): string { return role==="operator"?"العمليات":role==="client"?"العميل":role==="partner"?"المتجر":"الكابتن"; }

function conversationActorID(): string { const state = currentIdentityState(); return state.kind === "authenticated" ? state.identity.subject.trim() : ""; }
function isCurrentActor(actorID: string): boolean { return Boolean(actorID) && actorID === conversationActorID(); }

// Delay loading the native recorder until requested; older dev builds retain text chat.
const AudioRecorderControls = lazy(async () => {
  try { return await import("@bthwani/design-system/native/order-chat-voice-recorder"); }
  catch { return { default: () => <Text>يتطلب تسجيل الصوت إصدار Android يحتوي مكتبة الصوت.</Text> }; }
});

export function OrderConversation({ orderId }: { orderId: string }) {
  const theme = useAppearanceTheme(); const styles = useMemo(() => createStyles(theme), [theme]);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; value: Awaited<ReturnType<ReturnType<typeof client>["readOrderConversation"]>> } | { kind: "error" }>({ kind: "loading" });
  const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [selectedRecipients, setSelectedRecipients] = useState<ReadonlyArray<"client" | "partner" | "captain" | "operator">>(["client"]);
  const [pendingAttempt, setPendingAttempt] = useState<OrderConversationMessageAttempt | null>(null);
  const [attemptStorageReady, setAttemptStorageReady] = useState(false);
  const [identityState, setIdentityState] = useState(currentIdentityState);
  const activeActorID = identityState.kind === "authenticated" ? identityState.identity.subject.trim() : "";
  const [loadedActorID, setLoadedActorID] = useState("");
  const [loadedOrderID, setLoadedOrderID] = useState("");
  const readSequence = useRef(0);
  const [showAudioControls,setShowAudioControls] = useState(false);
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
    setAttemptStorageReady(false); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      if (actorID !== requestedActorID || sequence !== readSequence.current) return false;
      const key = orderConversationMessageAttemptStorageKey(role, actorID, orderId);
      const attempt = parseOrderConversationMessageAttempt(await SecureStore.getItemAsync(key), actorID, orderId);
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
    } catch (cause) { console.error("DSH captain order conversation read failed", cause); if (sequence === readSequence.current && isCurrentActor(requestedActorID)) setState({ kind: "error" }); return false; }
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
    try { await client().sendOrderConversationMessage(token, attempt.orderID, { body: attempt.body, ...(attempt.recipientRoles ? { recipientRoles: attempt.recipientRoles } : {}),
        ...(attempt.mediaKind && attempt.mediaContentType && attempt.mediaFileUri ? {
          mediaKind: attempt.mediaKind, mediaContentType: attempt.mediaContentType, mediaBase64: await new File(attempt.mediaFileUri).base64(),
        } : {}) }, attempt.idempotencyKey, attempt.correlationID); if (!isCurrentActor(attempt.actorID)) return; }
    catch (cause) { if (!isCurrentActor(attempt.actorID)) return; console.error("DSH captain order conversation send failed", cause); if (isDefinitiveDshMobileClientRejection(cause)) { let cleared = false; try { await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(role, attempt.actorID, attempt.orderID)); cleared = true; } catch (cleanupCause) { console.error("DSH captain rejected order conversation attempt cleanup failed", cleanupCause); } if (!isCurrentActor(attempt.actorID)) return; setPendingAttempt(cleared ? null : attempt); setBody(cleared ? "" : attempt.body); await load(); if (!isCurrentActor(attempt.actorID)) return; setError(cleared ? "رفض الخادم إرسال الرسالة؛ حدّثنا حالة المحادثة ويمكنك تعديل الرسالة والمحاولة مجددًا." : "رفض الخادم إرسال الرسالة، وتعذر حذف المحاولة المحفوظة. أعد قراءة المحادثة قبل أي محاولة جديدة."); return; } setPendingAttempt(attempt); setBody(attempt.body); setError("لم نتأكد من نتيجة الإرسال. بقيت الرسالة محفوظة؛ أعد المحاولة من الزر نفسه لتجنب تكرارها."); return; }
    let storageCleared = false;
    try { await SecureStore.deleteItemAsync(orderConversationMessageAttemptStorageKey(role, attempt.actorID, attempt.orderID)); storageCleared = true; }
    catch (cause) { console.error("DSH captain order conversation recovery record cleanup failed", cause); }
    if (!isCurrentActor(attempt.actorID)) return;
    setPendingAttempt(storageCleared ? null : attempt); setBody(storageCleared ? "" : attempt.body);
    const refreshed = await load();
    if (storageCleared && attempt.mediaFileUri) {try {new File(attempt.mediaFileUri).delete();} catch {}}
    if (!isCurrentActor(attempt.actorID)) return;
    if (!storageCleared) setError("تأكد إرسال الرسالة، وبقيت المحاولة محفوظة. أعد المحاولة من الزر نفسه لتجنب تكرارها.");
    else if (!refreshed) setError("تأكد إرسال الرسالة، لكن تعذر تحديث سجل المحادثة.");
  }

  async function send() {
    if (!correctOwner || !body.trim() || busy || !attemptStorageReady || pendingAttempt || !selectedRecipients.length || state.kind !== "ready" || !state.value.canSend) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || !identity.identity.subject.trim()) throw new Error("CAPTAIN_SESSION_REQUIRED");
      const actorID = identity.identity.subject.trim();
      if (!isCurrentActor(actorID) || actorID !== loadedActorID) return;
      const attempt = createOrderConversationMessageAttempt(actorID, orderId, body, `conversation_${Crypto.randomUUID()}`, `conversation_corr_${Crypto.randomUUID()}`, selectedRecipients);
      await SecureStore.setItemAsync(orderConversationMessageAttemptStorageKey(role, actorID, orderId), JSON.stringify(attempt));
      if (!isCurrentActor(actorID)) return;
      setPendingAttempt(attempt);
      await submitAttempt(attempt, token);
    } catch (cause) { console.error("DSH captain order conversation attempt could not be saved", cause); setError("تعذر حفظ محاولة الرسالة بأمان؛ لم تُرسل."); }
    finally { setBusy(false); }
  }

  async function sendPrivateMedia(sourceUri: string, kind: "image" | "audio" | "video", contentType: string, transcript = "") {
    if (!correctOwner || busy || !attemptStorageReady || pendingAttempt || !selectedRecipients.length || state.kind !== "ready" || !state.value.canSend) return;
    setBusy(true);setError("");
    try {
      const original=new File(sourceUri);
      const cap=kind==="image"?3145728:kind==="video"?6*1024*1024:1572864;
      if (!original.exists || !original.size || original.size>cap) throw new Error("MEDIA_TOO_LARGE");
      const actorID=conversationActorID();
      if (!actorID || actorID!==loadedActorID || !isCurrentActor(actorID)) throw new Error("ACTOR_MISMATCH");
      const extension=kind==="image"?".jpg":kind==="video"?(contentType==="video/webm"?".webm":".mp4"):Platform.OS==="ios"?".m4a":".3gp";
      const local=new File(Paths.document, "order-attachment-"+Crypto.randomUUID()+extension);
      original.copy(local);
      const label=kind==="image"?"صورة مرفقة":kind==="audio"?"رسالة صوتية"+(transcript?" ("+transcript+")":""):transcript.trim();

      const attempt=createOrderConversationMessageAttempt(actorID,orderId,label,
        "conversation_"+Crypto.randomUUID(),"conversation_corr_"+Crypto.randomUUID(),
        selectedRecipients,{kind,contentType,fileUri:local.uri});
      await SecureStore.setItemAsync(orderConversationMessageAttemptStorageKey(role,actorID,orderId),JSON.stringify(attempt));
      if (!isCurrentActor(actorID)) return;
      setPendingAttempt(attempt);
      const token=await getUsableIdentityAccessToken();
      await submitAttempt(attempt,token);
    } catch (cause) {
      console.error("Private conversation media send preparation failed",cause);
      setError("تعذر إرسال المرفق. تحقق من نوعه وحجمه ثم أعد المحاولة.");
    } finally {setBusy(false);}
  }

  async function pickPhoto(fromCamera: boolean) {
    try {
      const ImagePicker=await import("expo-image-picker");
      if (fromCamera) {
        const permission=await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {setError("يجب السماح باستخدام الكاميرا.");return;}
      }
      const result=fromCamera
        ? await ImagePicker.launchCameraAsync({mediaTypes:["images"],quality:0.6,allowsEditing:true})
        : await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.6,allowsEditing:true});
      if (result.canceled || !result.assets?.[0]) return;
      const photo=result.assets[0];
      const mime=photo.mimeType || "image/jpeg";
      if (!["image/jpeg","image/png","image/webp"].includes(mime)) {setError("اختر صورة JPG أو PNG أو WebP.");return;}
      await sendPrivateMedia(photo.uri,"image",mime);
    } catch {setError("تعذر اختيار الصورة.");}
  }

  async function pickVideo(fromCamera:boolean){
    try {
      const ImagePicker=await import("expo-image-picker");
      if(fromCamera){
        const permission=await ImagePicker.requestCameraPermissionsAsync();
        if(!permission.granted){setError("يلزم السماح للكاميرا لتصوير الفيديو.");return;}
      }
      const selection=fromCamera
        ? await ImagePicker.launchCameraAsync({mediaTypes:["videos"],videoMaxDuration:15})
        : await ImagePicker.launchImageLibraryAsync({mediaTypes:["videos"],videoMaxDuration:15});
      const item=selection.assets?.[0];
      if(selection.canceled||!item)return;
      const mime=item.mimeType??(item.uri.toLowerCase().endsWith(".mp4")?"video/mp4":"");
      if(mime!=="video/mp4"&&mime!=="video/webm"){
        setError("يجب اختيار فيديو MP4 أو WebM مدعوم.");return;
      }
      await sendPrivateMedia(item.uri,"video",mime,"فيديو مرفق");
    } catch(cause) {console.error("Order video selection failed",cause);setError("تعذر اختيار الفيديو. تحقق من النوع والحجم.");}
  }

  async function retryPendingAttempt() {
    const attempt = pendingAttempt;
    if (!correctOwner || !attempt || !isCurrentActor(attempt.actorID) || busy || !attemptStorageReady) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const identity = currentIdentityState();
      if (identity.kind !== "authenticated" || identity.identity.subject.trim() !== attempt.actorID) throw new Error("CAPTAIN_SESSION_CHANGED");
      await submitAttempt(attempt, token);
    } catch (cause) { console.error("DSH captain order conversation recovery failed", cause); setError("تعذر التحقق من جلسة صاحب المحاولة. بقيت الرسالة محفوظة كما هي."); }
    finally { setBusy(false); }
  }
  async function markRead() { if (!correctOwner || busy || state.kind !== "ready" || state.value.unreadCount < 1) return; const last = state.value.messages.at(-1); if (!last) return; setBusy(true); setError(""); try { const token = await getUsableIdentityAccessToken(); if (!isCurrentActor(loadedActorID)) return; await client().markOrderConversationRead(token, orderId, { messageId: last.id }); await load(); } catch (cause) { console.error("DSH captain order conversation read-state write failed", cause); setError("تعذر تحديث حالة القراءة."); } finally { setBusy(false); } }
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const recipientOptions = [
    { role: "client" as const, label: "العميل" },
    { role: "partner" as const, label: "المتجر" },
    { role: "operator" as const, label: "العمليات" },
  ];
  useEffect(() => {
    if (!correctOwner || state.kind !== "ready" || !state.value.unreadCount || busy) return;
    const last = state.value.messages.at(-1);
    if (!last) return;
    const key = loadedActorID + ":" + orderId + ":" + last.id;
    if (autoReadReceiptAttempt.current === key) return;
    autoReadReceiptAttempt.current = key;
    void markReadRef.current();
  }, [correctOwner, state, busy, loadedActorID, orderId]);

  if (!activeActorID || (loadedActorID && !correctOwner)) return <BthwaniSurface tone="base" style={styles.surface} accessibilityLabel="محادثة الطلب"><Text style={styles.muted}>{activeActorID ? "جارٍ التحقق من محادثة الحساب الحالي…" : "سجّل الدخول لقراءة محادثة الطلب."}</Text></BthwaniSurface>;
  return <BthwaniSurface tone="base" style={styles.surface} accessibilityLabel="محادثة مهمة التوصيل">
    {state.kind==="ready"&&state.value.unreadCount>0?<Text style={styles.unread}>{state.value.unreadCount} غير مقروءة</Text>:null}
    {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة المحادثة…</Text></View> : null}
    {state.kind === "error" ? <View style={styles.state}><Text style={styles.error}>تعذر قراءة المحادثة.</Text><BthwaniButton label="إعادة المحاولة" onPress={() => void load()} variant="secondary" />{pendingAttempt ? <BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /> : null}</View> : null}
    {state.kind === "ready" ? <>
      {<View style={{flex:1,minHeight:120}}>{!state.value.messages.length ? <Text style={styles.muted}>ابدأ المحادثة حول هذا الطلب.</Text> : <ScrollView style={styles.messageScroll} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">{state.value.messages.map((message) => message.mediaKind==="audio" ? <OrderConversationMediaMessage key={message.id} orderId={orderId} messageId={message.id} mediaKind="audio" mine={message.mine} sender={message.mine?"أنت":senderLabel(message.senderRole)} createdAt={message.createdAt} readAt={message.readAt} caption={message.body}/> : <View key={message.id} style={[styles.message, message.mine ? styles.mine : null]}><Text style={styles.sender}>{message.mine ? "أنت" : senderLabel(message.senderRole)}</Text><Text style={styles.body}>{message.body}</Text><OrderConversationMediaMessage orderId={orderId} messageId={message.id} mediaKind={message.mediaKind} /><Text style={styles.time}>{new Date(message.createdAt).toLocaleString("ar-YE")}</Text></View>)}</ScrollView>}</View>}
      {pendingAttempt ? <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>المحاولة محفوظة لهذا الحساب والطلب. سنتحقق من نتيجتها قبل إعادة الإرسال.</Text><BthwaniButton busy={busy} disabled={busy || !attemptStorageReady} label="استعادة إرسال الرسالة المحفوظة" onPress={() => void retryPendingAttempt()} /></View> : state.value.canSend ? <BthwaniOrderChatComposer
  recipients={recipientOptions} selected={selectedRecipients}
  onToggleRecipient={(value)=>{const target=recipientOptions.find(item=>item.role===value)?.role;if(!target)return;setSelectedRecipients(current=>current.includes(target)?current.filter(role=>role!==target):[...current,target]);}}
  onSelectAll={()=>setSelectedRecipients(recipientOptions.map(item=>item.role))}
  body={body} onChangeText={setBody} onSend={()=>void send()}
  onGallery={()=>void pickPhoto(false)} onCamera={()=>void pickPhoto(true)}
  onVoice={()=>setShowAudioControls(true)}
  onVideo={()=>Alert.alert("إضافة فيديو","اختر المصدر",[
    {text:"الكاميرا",onPress:()=>void pickVideo(true)},
    {text:"المعرض",onPress:()=>void pickVideo(false)},
    {text:"إلغاء",style:"cancel"},
  ])}
  disabled={busy || !attemptStorageReady || Boolean(pendingAttempt)}
  audioControls={showAudioControls ? <Suspense fallback={<ActivityIndicator color={theme.brandAction} size="small"/>}><AudioRecorderControls disabled={busy}
     onRecorded={(uri,mime,duration)=>sendPrivateMedia(uri,"audio",mime,Math.floor(duration/60)+":"+String(duration%60).padStart(2,"0"))} onClose={()=>setShowAudioControls(false)} /></Suspense>:null}
/> : <Text style={styles.muted}>أُغلقت المحادثة للكتابة، ويمكنك قراءة سجلها فقط.</Text>}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </BthwaniSurface>;
}
function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({ surface: { flex:1, gap: spacing[3], padding: 0 }, header: { alignItems: "flex-start", flexDirection: "row", gap: spacing[2], justifyContent: "space-between" }, title: { ...typography.titleSm, color: theme.color }, muted: { ...typography.bodySm, color: theme.colorMuted }, unread: { ...typography.label, color: theme.interactiveText }, messageScroll:{flex:1,minHeight:0}, messages: { gap: spacing[2], paddingBottom:16 }, message: { alignSelf: "flex-start", backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[1], maxWidth: "92%", padding: spacing[3] }, mine: { alignSelf: "flex-end", backgroundColor: theme.actionSoft }, sender: { ...typography.label, color: theme.interactiveText }, body: { ...typography.body, color: theme.color }, time: { ...typography.caption, color: theme.colorMuted }, input: { ...typography.body, backgroundColor: theme.background, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, color: theme.color, minHeight: 72, padding: spacing[3] }, state: { alignItems: "center", gap: spacing[2], padding: spacing[3] }, error: { ...typography.bodySm, color: theme.warning } }); }
