import { borders, radius, type resolveTheme, spacing, typography } from "@bthwani/design-system";
import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { clientShareMessageLabel, createDshMobileClient, type ClientShareKind, type ClientShareMessage } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { Contact } from "expo-contacts";
import * as Clipboard from "expo-clipboard";
import { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

export type ClientShareTarget = Readonly<{ kind: ClientShareKind; id: string; title: string; link: string }>;

export function ClientShareSheet({ target, onClose }: { target: ClientShareTarget | null; onClose: () => void }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [phone, setPhone] = useState("");
  const [messageCode, setMessageCode] = useState<ClientShareMessage>("LOOK");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const idempotencyKey = useRef("");
  const phoneValid = /^\+967[0-9]{9}$/.test(normalizeYemenPhoneE164(phone));

  function resetAndClose() {
    if (busy) return;
    setPhone(""); setMessageCode("LOOK"); setError(""); setSuccess(false); idempotencyKey.current = "";
    onClose();
  }
  async function send() {
    if (!target || busy || !phoneValid) return;
    if (!idempotencyKey.current) idempotencyKey.current = Crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const baseUrl = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!baseUrl) throw new Error("DSH_BASE_URL_REQUIRED");
      await createDshMobileClient(baseUrl).sendClientShare(token, {
        recipientPhoneE164: phone, contentKind: target.kind, contentId: target.id, messageCode,
      }, idempotencyKey.current);
      setSuccess(true);
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
      setError(code === "RATE_LIMITED" ? "وصلت إلى حد المشاركات. جرّب لاحقًا." : code === "INVALID_INPUT" ? "المحتوى لم يعد متاحًا للمشاركة أو البيانات غير صحيحة." : "لم نتأكد من إرسال المشاركة. أعد المحاولة دون تكرار الطلب.");
    } finally { setBusy(false); }
  }
  async function chooseContact() {
    try {
      const selected = await Contact.presentPicker();
      if (!selected) return;
      const phones = await selected.getPhones();
      const number = phones.find((item) => item.number?.trim())?.number;
      if (!number) { setError("جهة الاتصال المختارة ليس لديها رقم هاتف."); return; }
      setPhone(normalizeYemenPhoneE164(number));
      idempotencyKey.current = "";
      setError("");
    } catch { setError("تعذر فتح جهات الاتصال. يمكنك كتابة الرقم يدويًا."); }
  }
  async function copyLink() {
    if (!target) return;
    try { await Clipboard.setStringAsync(target.link); setError(""); }
    catch { setError("تعذر نسخ الرابط."); }
  }
  async function shareOutside() {
    if (!target) return;
    try { await Share.share({ message: `${target.title}\n${target.link}`, title: target.title }); }
    catch { setError("تعذرت المشاركة الخارجية. جرّب مجددًا."); }
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
          <TextInput style={styles.input} value={phone} onChangeText={(value)=>{setPhone(value);idempotencyKey.current="";}} keyboardType="phone-pad" autoComplete="tel" maxLength={20} placeholder="77xxxxxxx" placeholderTextColor={theme.colorMuted} accessibilityLabel="رقم الهاتف المسجل في بثواني" />
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void chooseContact()} style={styles.outside}><Text style={styles.outsideText}>اختيار رقم من جهات الاتصال</Text></Pressable>
          <Text style={styles.label}>رسالة قصيرة</Text>
          <View style={styles.chips}>
            {(["LOOK","LIKE","OFFER","TRY"] as const).map((code)=><Pressable key={code} accessibilityRole="button" accessibilityState={{ selected: messageCode===code }} onPress={()=>{setMessageCode(code);idempotencyKey.current="";}} style={[styles.chip, messageCode===code && styles.selected]}>
              <Text style={[styles.chipText,messageCode===code && styles.selectedText]}>{clientShareMessageLabel(code)}</Text>
            </Pressable>)}
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <BthwaniButton label="إرسال المشاركة" busy={busy} disabled={!phoneValid || busy} onPress={()=>void send()} />
          <Pressable accessibilityRole="button" onPress={() => void copyLink()} style={styles.outside}><Text style={styles.outsideText}>نسخ رابط المحتوى</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={()=>void shareOutside()} style={styles.outside}><Text style={styles.outsideText}>مشاركة عبر تطبيق آخر</Text></Pressable>
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
