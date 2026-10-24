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
    card:{borderWidth:1,borderColor:theme.borderColor,borderRadius:12,padding:12,gap:9,backgroundColor:theme.surface},
    heading:{...typography.bodyStrong,color:theme.color},
    note:{...typography.caption,color:theme.colorMuted},
    input:{backgroundColor:theme.surfaceRaised,borderWidth:1,borderColor:theme.borderColor,borderRadius:9,minHeight:46,paddingHorizontal:12,color:theme.color},
    error:{...typography.caption,color:theme.warning},
  }),[theme]);
  const [phase,setPhase]=useState<Phase>("request");
  const [phone,setPhone]=useState("");
  const [code,setCode]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function requestCode(){
    if(busy)return;
    const number=phone.replace(/[\s()-]/g,"").trim();
    if(!/^\+?[0-9]{8,16}$/.test(number)){setError("أدخل رقم هاتف الحساب الصحيح.");return;}
    setBusy(true);setError("");
    try{await requestManagedRecovery(number);setPhone(number);setPhase("confirm");}
    catch{setError("تعذر طلب استعادة الحساب. تحقق من البيانات والاتصال.");}
    finally{setBusy(false);}
  }
  async function confirm(){
    if(busy)return;
    if(!/^\d{4,8}$/.test(code.trim())){setError("أدخل رمز التحقق المرسل إليك.");return;}
    if(password.length<10||password.length>128){setError("استخدم كلمة مرور من 10 إلى 128 حرفًا.");return;}
    setBusy(true);setError("");
    try{
      await recoverManagedIdentity(phone,code.trim(),password);
      setPassword("");setCode("");setPhase("complete");
    }catch{setError("تعذر التحقق أو إعادة التعيين. تأكد من الرمز وحاول مجددًا.");}
    finally{setBusy(false);}
  }
  return <View style={styles.card} accessibilityLabel="أمان الحساب">
    <Text style={styles.heading}>أمان الحساب</Text>
    {phase==="complete"?<>
      <Text style={styles.note}>تم تحديث كلمة المرور. سجّل الدخول مجددًا بكلمة المرور الجديدة.</Text>
      <BthwaniButton label="تسجيل الدخول" onPress={()=>router.replace("/?returnTo=/more" as Href)}/>
    </>:<>
      <Text style={styles.note}>إعادة تعيين كلمة المرور عبر رقم الهاتف ورمز التحقق. قد يُطلب منك تسجيل الدخول مجددًا.</Text>
      {phase==="request"?<>
        <TextInput accessibilityLabel="هاتف الحساب" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textAlign="left" placeholder="رقم هاتف الحساب" placeholderTextColor={theme.colorMuted} style={styles.input}/>
        <BthwaniButton label={busy?"جارٍ إرسال الرمز":"إرسال رمز التحقق"} disabled={busy} busy={busy} onPress={()=>void requestCode()}/>
      </>:<>
        <TextInput accessibilityLabel="رمز التحقق" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" style={styles.input} placeholder="رمز التحقق" placeholderTextColor={theme.colorMuted}/>
        <TextInput accessibilityLabel="كلمة المرور الجديدة" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" style={styles.input} placeholder="كلمة المرور الجديدة" placeholderTextColor={theme.colorMuted}/>
        <BthwaniButton label={busy?"جارٍ التحقق":"تأكيد كلمة المرور الجديدة"} disabled={busy} busy={busy} onPress={()=>void confirm()}/>
        <BthwaniButton label="تعديل رقم الهاتف" variant="secondary" disabled={busy} onPress={()=>{setPhase("request");setCode("");setPassword("");}}/>
      </>}
    </>}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>;
}
