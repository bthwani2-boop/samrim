import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type ClientShareKind, type ClientShareMessage, clientShareMessageLabel, createDshMobileClient } from "@bthwani/dsh";
import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import * as Clipboard from "expo-clipboard";
import { Contact } from "expo-contacts";
import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { clientSessionKey } from "../access/client-session-scope";

export type ClientShareTarget = Readonly<{ kind: ClientShareKind; id: string; title: string; link: string }>;

function clientShareSessionKey(): string {
  return clientSessionKey(currentIdentityState());
}

function clientShareTargetKey(target: ClientShareTarget | null): string {
  return target ? JSON.stringify([target.kind, target.id, target.link]) : "";
}

function clientShareRequestKey(actorID: string, target: ClientShareTarget, recipientPhoneE164: string, messageCode: ClientShareMessage): string {
  return JSON.stringify([actorID, target.kind, target.id, recipientPhoneE164, messageCode]);
}

function isLocalPreviewLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}

export function ClientShareSheet({ target, onClose }: { target: ClientShareTarget | null; onClose: () => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [sessionKey, setSessionKey] = useState(clientShareSessionKey);
  const sessionKeyRef = useRef(sessionKey);
  const targetKey = clientShareTargetKey(target);
  const targetKeyRef = useRef(targetKey);
  const activeSession = sessionKey.length > 0 && clientShareSessionKey() === sessionKey;
  const activeScope = activeSession && targetKey ? JSON.stringify([sessionKey, targetKey]) : "";
  const [inputScope, setInputScope] = useState(activeScope);
  const [phone, setPhone] = useState("");
  const [messageCode, setMessageCode] = useState<ClientShareMessage>("LOOK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [successScope, setSuccessScope] = useState("");
  const requestSequence = useRef(0);
  const sendingRef = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const visiblePhone = activeScope && inputScope === activeScope ? phone : "";
  const visibleMessageCode = activeScope && inputScope === activeScope ? messageCode : "LOOK";
  const phoneValid = /^\+967[0-9]{9}$/.test(normalizeYemenPhoneE164(visiblePhone));
  const identity = currentIdentityState();
  const visibleRequestKey = activeScope && target && phoneValid && identity.kind === "authenticated"
    ? clientShareRequestKey(identity.identity.subject.trim(), target, normalizeYemenPhoneE164(visiblePhone), visibleMessageCode)
    : "";
  const success = Boolean(visibleRequestKey && successScope === JSON.stringify([activeScope, visibleRequestKey]));
  const localPreview = Boolean(target && isLocalPreviewLink(target.link));

  useEffect(() => subscribeIdentitySession(() => {
    const next = clientShareSessionKey();
    if (next === sessionKeyRef.current) return;
    sessionKeyRef.current = next;
    requestSequence.current += 1;
    sendingRef.current = false;
    setSessionKey(next);
    setInputScope("");
    setPhone("");
    setMessageCode("LOOK");
    setError("");
    setSuccessScope("");
    setBusy(false);
  }), []);

  useEffect(() => {
    targetKeyRef.current = targetKey;
    requestSequence.current += 1;
    sendingRef.current = false;
    setInputScope("");
    setPhone("");
    setMessageCode("LOOK");
    setError("");
    setSuccessScope("");
    setBusy(false);
  }, [targetKey]);

  useEffect(() => () => {
    requestSequence.current += 1;
    sendingRef.current = false;
  }, []);

  function resetAndClose() {
    if (sendingRef.current) return;
    requestSequence.current += 1;
    setInputScope("");
    setPhone("");
    setMessageCode("LOOK");
    setError("");
    setSuccessScope("");
    onClose();
  }

  async function send() {
    if (!target || !activeScope || !phoneValid || busy || sendingRef.current || success) return;
    const identity = currentIdentityState();
    if (identity.kind !== "authenticated" || clientShareSessionKey() !== sessionKey) return;
    const actorID = identity.identity.subject.trim();
    const recipientPhoneE164 = normalizeYemenPhoneE164(visiblePhone);
    const contentKind = target.kind;
    const contentId = target.id;
    const message = visibleMessageCode;
    const key = clientShareRequestKey(actorID, target, recipientPhoneE164, message);
    const sequence = ++requestSequence.current;
    const isCurrent = () => sequence === requestSequence.current && clientShareSessionKey() === sessionKey && targetKeyRef.current === targetKey;
    const idempotencyKey = attempts.current.get(key) ?? Crypto.randomUUID();
    attempts.current.set(key, idempotencyKey);
    sendingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!isCurrent()) return;
      const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
      const response = await createDshMobileClient(baseUrl).sendClientShare(token, {
        recipientPhoneE164, contentKind, contentId, messageCode: message,
      }, idempotencyKey);
      if (!isCurrent()) return;
      if (!response.accepted) throw new Error("SHARE_NOT_ACCEPTED");
      attempts.current.delete(key);
      setSuccessScope(JSON.stringify([activeScope, key]));
    } catch (cause) {
      if (!isCurrent()) return;
      const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
      if (code === "RATE_LIMITED" || code === "INVALID_INPUT" || code === "IDEMPOTENCY_CONFLICT") attempts.current.delete(key);
      setError(code === "RATE_LIMITED" ? "وصلت إلى حد المشاركات. جرّب لاحقًا." : code === "INVALID_INPUT" ? "المحتوى لم يعد متاحًا للمشاركة أو البيانات غير صحيحة." : "لم نتأكد من إرسال المشاركة. أعد المحاولة دون تكرار الطلب.");
    } finally {
      if (isCurrent()) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function chooseContact() {
    if (!activeScope || busy || sendingRef.current) return;
    const sequence = requestSequence.current;
    const isCurrent = () => sequence === requestSequence.current && clientShareSessionKey() === sessionKey && targetKeyRef.current === targetKey;
    try {
      const selected = await Contact.presentPicker();
      if (!isCurrent() || !selected) return;
      const phones = await selected.getPhones();
      if (!isCurrent()) return;
      const number = phones.find((item) => item.number?.trim())?.number;
      if (!number) { setError("جهة الاتصال المختارة ليس لديها رقم هاتف."); return; }
      setInputScope(activeScope);
      setPhone(normalizeYemenPhoneE164(number));
      setError("");
    } catch {
      if (isCurrent()) setError("تعذر فتح جهات الاتصال. يمكنك كتابة الرقم يدويًا.");
    }
  }
  async function copyLink() {
    if (!target) return;
    const requestTargetKey = targetKey;
    try {
      await Clipboard.setStringAsync(target.link);
      if (targetKeyRef.current === requestTargetKey) setError("");
    } catch {
      if (targetKeyRef.current === requestTargetKey) setError("تعذر نسخ الرابط.");
    }
  }
  async function shareOutside() {
    if (!target) return;
    const requestTargetKey = targetKey;
    try { await Share.share({ message: `${target.title}\n${target.link}`, title: target.title }); }
    catch { if (targetKeyRef.current === requestTargetKey) setError("تعذرت المشاركة الخارجية. جرّب مجددًا."); }
  }

  return <Modal visible={Boolean(target)} transparent animationType="slide" onRequestClose={resetAndClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="إغلاق المشاركة" style={StyleSheet.absoluteFill} onPress={resetAndClose} />
      <View accessibilityLabel="مشاركة المحتوى داخل بثواني" style={styles.panel}>
        <View style={styles.heading}>
          <Text style={styles.title}>شارك داخل بثواني</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={resetAndClose}><Text style={styles.close}>إغلاق</Text></Pressable>
        </View>
        <View style={styles.target}><Text style={styles.contentTitle} numberOfLines={2}>{target?.title}</Text></View>
        {success ? <>
          <Text accessibilityRole="alert" style={styles.notice}>تم استلام طلب المشاركة. ستصل داخل بثواني إذا كان الرقم مرتبطًا بحساب مؤهل للاستلام.</Text>
          <BthwaniButton label="تم" onPress={resetAndClose}/>
        </> : <>
          <Text style={styles.label}>رقم الصديق أو القريب</Text>
          <TextInput style={styles.input} value={visiblePhone} editable={Boolean(activeScope) && !busy} onChangeText={(value)=>{if(sendingRef.current)return;setInputScope(activeScope);setPhone(value);setError("");}} keyboardType="phone-pad" autoComplete="tel" maxLength={20} placeholder="77xxxxxxx" placeholderTextColor={theme.colorMuted} accessibilityLabel="رقم الهاتف المسجل في بثواني" />
          <Pressable accessibilityRole="button" disabled={busy || !activeScope} onPress={() => void chooseContact()} style={styles.outside}><Text style={styles.outsideText}>اختيار رقم من جهات الاتصال</Text></Pressable>
          <Text style={styles.label}>رسالة قصيرة</Text>
          <View style={styles.chips}>
            {(["LOOK","LIKE","OFFER","TRY"] as const).map((code)=><Pressable key={code} disabled={busy || !activeScope} accessibilityRole="button" accessibilityState={{ selected: visibleMessageCode===code }} onPress={()=>{if(sendingRef.current)return;setInputScope(activeScope);setMessageCode(code);setError("");}} style={[styles.chip, visibleMessageCode===code && styles.selected]}>
              <Text style={[styles.chipText,visibleMessageCode===code && styles.selectedText]}>{clientShareMessageLabel(code)}</Text>
            </Pressable>)}
          </View>
          {activeScope && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <BthwaniButton label="إرسال المشاركة" busy={busy} disabled={!phoneValid || !activeScope || busy} onPress={()=>void send()} />
          {localPreview ? <Text style={styles.notice}>رابط معاينة محلي يعمل على جهاز التطوير فقط، وليس رابطًا عامًا للمشاركة الخارجية.</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => void copyLink()} style={styles.outside}><Text style={styles.outsideText}>{localPreview ? "نسخ رابط المعاينة المحلية" : "نسخ رابط المحتوى"}</Text></Pressable>
          {!localPreview ? <Pressable accessibilityRole="button" onPress={()=>void shareOutside()} style={styles.outside}><Text style={styles.outsideText}>مشاركة عبر تطبيق آخر</Text></Pressable> : null}
        </>}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) { return StyleSheet.create({
  backdrop: { flex:1, justifyContent:"flex-end", backgroundColor:"rgba(0,0,0,0.55)" },
  panel:{backgroundColor:theme.surface,borderTopLeftRadius:radius.xl,borderTopRightRadius:radius.xl,padding:spacing[4],paddingBottom:spacing[6],gap:spacing[3],borderColor:theme.borderColor,borderWidth:borders.hairline},
  heading:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  title:{...typography.titleLg,color:theme.color},close:{...typography.bodySm,color:theme.interactiveText},
  target:{padding:spacing[3],backgroundColor:theme.surfaceInset,borderRadius:radius.md},
  contentTitle:{...typography.bodyStrong,color:theme.color},label:{...typography.bodyStrong,color:theme.color},
  input:{...typography.body,backgroundColor:theme.surfaceInset,color:theme.color,borderColor:theme.borderColor,borderWidth:borders.hairline,borderRadius:radius.md,minHeight:48,paddingHorizontal:spacing[3],textAlign:"right"},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:spacing[2]},chip:{paddingHorizontal:spacing[3],paddingVertical:spacing[2],backgroundColor:theme.surfaceInset,borderRadius:radius.round,borderWidth:borders.hairline,borderColor:theme.borderColor},
  selected:{backgroundColor:theme.actionSoft,borderColor:theme.interactiveText},chipText:{...typography.bodySm,color:theme.colorMuted},selectedText:{color:theme.interactiveText},
  notice:{...typography.body,color:theme.color},error:{...typography.bodySm,color:theme.danger},
  outside:{padding:spacing[2],alignItems:"center"},outsideText:{...typography.bodySm,color:theme.interactiveText},
}); }
