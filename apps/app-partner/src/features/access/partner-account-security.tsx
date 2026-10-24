import { typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { requestManagedRecovery, recoverManagedIdentity } from "../../bootstrap/identity";

type Phase="request"|"confirm"|"complete";

export function PartnerAccountSecurity() {
  const theme=useAppearanceTheme();
  const router=useRouter();
  const styles=useMemo(()=>StyleSheet.create({
    root:{borderWidth:1,borderColor:theme.borderColor,borderRadius:12,padding:11,backgroundColor:theme.surface,gap:8},
    title:{...typography.bodyStrong,color:theme.color,fontWeight:"800"},
    hint:{...typography.caption,color:theme.colorMuted},
    field:{backgroundColor:theme.surfaceRaised,borderWidth:1,borderColor:theme.borderColor,borderRadius:9,minHeight:44,paddingHorizontal:12,color:theme.color},
    error:{...typography.caption,color:theme.warning},
  }),[theme]);
  const [phase,setPhase]=useState<Phase>("request");
  const [phone,setPhone]=useState("");
  const [code,setCode]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const request=async()=>{
    if(busy)return;
    const normalized=phone.replace(/[\s()-]/g,"").trim();
    if(!/^\+?[0-9]{8,16}$/.test(normalized)){setError("تحقق من رقم هاتف الحساب.");return;}
    setBusy(true);setError("");
    try{await requestManagedRecovery(normalized);setPhone(normalized);setPhase("confirm");}
    catch{setError("تعذر إرسال الرمز. تحقق من الاتصال وحاول مجددًا.");}
    finally{setBusy(false);}
  };
  const confirm=async()=>{
    if(busy)return;
    if(!/^\d{4,8}$/.test(code.trim())){setError("أدخل رمز التحقق المرسل إليك.");return;}
    if(password.length<10||password.length>128){setError("كلمة المرور يجب أن تكون من 10 إلى 128 حرفًا.");return;}
    setBusy(true);setError("");
    try{await recoverManagedIdentity(phone,code.trim(),password);setPassword("");setCode("");setPhase("complete");}
    catch{setError("تعذر التحقق أو إعادة التعيين. تحقق من الرمز وأعد المحاولة.");}
    finally{setBusy(false);}
  };

  return <View style={styles.root} accessibilityLabel="أمان الحساب">
    <Text style={styles.title}>إعادة تعيين كلمة المرور</Text>
    {phase==="complete"?<>
      <Text style={styles.hint}>تم تحديث كلمة المرور. استخدمها عند تسجيل الدخول.</Text>
      <BthwaniButton label="تسجيل الدخول" onPress={()=>router.replace("/?returnTo=/more" as Href)}/>
    </>:phase==="request"?<>
      <Text style={styles.hint}>أدخل هاتف حسابك لاستلام رمز التحقق.</Text>
      <TextInput accessibilityLabel="رقم هاتف الحساب" style={styles.field} value={phone} onChangeText={setPhone} placeholder="رقم الهاتف" placeholderTextColor={theme.colorMuted} keyboardType="phone-pad" autoComplete="tel" textAlign="left"/>
      <BthwaniButton label="إرسال الرمز" disabled={busy} busy={busy} onPress={()=>void request()}/>
    </>:<>
      <Text style={styles.hint}>أدخل الرمز وكلمة المرور الجديدة.</Text>
      <TextInput accessibilityLabel="رمز التحقق" style={styles.field} value={code} onChangeText={setCode} placeholder="رمز التحقق" placeholderTextColor={theme.colorMuted} keyboardType="number-pad" autoComplete="one-time-code"/>
      <TextInput accessibilityLabel="كلمة المرور الجديدة" style={styles.field} value={password} onChangeText={setPassword} placeholder="كلمة المرور الجديدة" placeholderTextColor={theme.colorMuted} secureTextEntry autoCapitalize="none" autoComplete="new-password"/>
      <BthwaniButton label="تأكيد كلمة المرور" disabled={busy} busy={busy} onPress={()=>void confirm()}/>
      <BthwaniButton label="تعديل رقم الهاتف" variant="secondary" disabled={busy} onPress={()=>{setPhase("request");setCode("");setPassword("");}}/>
    </>}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>;
}
