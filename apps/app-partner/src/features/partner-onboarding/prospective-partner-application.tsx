import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import { identityErrorMessage, limitPasswordInput, validatePasswordInputShape, type TokenPair } from "@bthwani/identity";
import { BthwaniButton, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import {
  currentProspectSession, loginProspect, registerDirectPartnerFromVerifiedAccount,
  registerProspect, requestProspectRegistration, restoreProspectSession, subscribeProspectSession,
} from "../../bootstrap/applicant-identity";
import {
  adoptDirectPartnerIdentity, currentIdentityState, loginManagedIdentity,
  recoverManagedIdentity, requestManagedRecovery, restoreIdentitySession,
  subscribeIdentitySession,
} from "../../bootstrap/identity";

function ascii(input:string){return input.replace(/[٠-٩۰-۹]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)>=0?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c)))}

export function ProspectivePartnerApplication() {
 const router=useRouter();
 const theme=useAppearanceTheme();
 const {width}=useWindowDimensions();
 const [partner,setPartner]=useState(currentIdentityState());
 const [prospect,setProspect]=useState(currentProspectSession());
 const [restoring,setRestoring]=useState(true);
 const [mode,setMode]=useState<"register"|"login"|"recover">("register");
 const [phone,setPhone]=useState("");
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState("");
 const [code,setCode]=useState("");
 const [codeSent,setCodeSent]=useState(false);
 const [visible,setVisible]=useState(false);
 const [confirmVisible,setConfirmVisible]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const mobile=width<720;
 const normalized=normalizeYemenPhoneE164(phone);
 const validPhone=/^\+[1-9]\d{7,14}$/.test(normalized);
 const passwordValid=mode==="login"?password.length>0:validatePasswordInputShape(password,confirm).valid;
 const canSubmit=validPhone&&(mode==="recover"&&!codeSent||passwordValid);
 const isPartner=partner.kind==="authenticated";
 const isVerifiedClient=prospect.kind==="authenticated";
 const styles=useMemo(()=>({
  root:{flex:1,backgroundColor:theme.background},
  content:{flexGrow:1,alignItems:"center" as const,paddingHorizontal:16,paddingTop:46,paddingBottom:30,gap:17},
  header:{width:"100%" as const,maxWidth:630,alignItems:"center" as const,gap:7},
  title:{color:theme.color,fontSize:23,fontWeight:"700" as const,textAlign:"center" as const},
  subtitle:{color:theme.colorMuted,fontSize:14,textAlign:"center" as const,lineHeight:23},
  card:{width:"100%" as const,maxWidth:630,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:22,padding:mobile?18:25,gap:15},
  heading:{color:theme.color,fontSize:19,fontWeight:"700" as const,textAlign:"right" as const},
  label:{color:theme.color,fontSize:13,fontWeight:"600" as const,textAlign:"right" as const},
  fields:{flexDirection:mobile?"column" as const:"row" as const,gap:13},
  field:{flex:mobile?undefined:1,flexDirection:"column" as const,gap:6,minWidth:0},
  input:{backgroundColor:theme.surfaceInset,color:theme.color,borderWidth:1,borderColor:theme.borderColor,borderRadius:11,paddingHorizontal:12,paddingVertical:12,textAlign:"right" as const,writingDirection:"rtl" as const,fontSize:15},
  password:{backgroundColor:theme.surfaceInset,borderWidth:1,borderColor:theme.borderColor,borderRadius:11,flexDirection:"row" as const,alignItems:"center" as const,paddingLeft:5},
  passwordInput:{flex:1,minWidth:0,color:theme.color,paddingHorizontal:12,paddingVertical:12,textAlign:"right" as const,fontSize:15},
  small:{color:theme.colorMuted,fontSize:12,textAlign:"right" as const,lineHeight:20},
  error:{color:theme.dangerText,backgroundColor:theme.dangerSoft,padding:12,borderRadius:10,textAlign:"right" as const},
  link:{color:theme.actionBackground,fontSize:14,fontWeight:"600" as const,textAlign:"center" as const},
 }),[theme,mobile]);

 useEffect(()=>{
  let active=true;
  const offPartner=subscribeIdentitySession(next=>{if(active)setPartner(next)});
  const offClient=subscribeProspectSession(next=>{if(active)setProspect(next)});
  void Promise.allSettled([restoreIdentitySession(),restoreProspectSession()]).finally(()=>{if(active)setRestoring(false)});
  return()=>{active=false;offPartner();offClient()};
 },[]);
 useEffect(()=>{if(isPartner)router.replace("/setup" as Href)},[isPartner,router]);

 function switchMode(next:"register"|"login"|"recover"){
  setMode(next);setError("");setNotice("");setCode("");setCodeSent(false);
  setPassword("");setConfirm("");setVisible(false);setConfirmVisible(false);
 }
 async function enterPartner(pair:TokenPair){
  await adoptDirectPartnerIdentity(pair);
  router.replace("/setup" as Href);
 }
 async function activateVerifiedAccount(){
  try {
   const pair=await registerDirectPartnerFromVerifiedAccount();
   await enterPartner(pair);
  }catch(cause){
   if(cause && typeof cause==="object" && "status" in cause && (cause as {status?:number}).status===409 && password){
    // A previous successful role admission can outlive an interrupted response.
    await loginManagedIdentity(normalized,password);router.replace("/setup" as Href);
    return;
   }
   throw cause;
  }
 }
 async function submit(){
  if(busy||!canSubmit||isPartner)return;
  setBusy(true);setError("");setNotice("");
  try{
   if(mode==="register"){
    if(!codeSent){
     await requestProspectRegistration(normalized);
     setCode("");setCodeSent(true);setNotice("أدخل رمز التحقق لإكمال إنشاء حساب الشريك.");
    }else{
     if(!/^\d{6}$/.test(ascii(code))) {setError("أدخل رمز التحقق المكوّن من 6 أرقام.");return;}
     await registerProspect(normalized,ascii(code),password);
     await activateVerifiedAccount();
    }
   }else if(mode==="login"){
    try { await loginManagedIdentity(normalized,password);router.replace("/setup" as Href); }
    catch(cause){
     // A customer identity can become a Partner with the same verified phone.
     if(!cause||typeof cause!=="object"||!("status" in cause)||![401,404].includes((cause as {status:number}).status))throw cause;
     await loginProspect(normalized,password);
     await activateVerifiedAccount();
    }
   }else{
    if(!codeSent){await requestManagedRecovery(normalized);setCode("");setCodeSent(true);setNotice("أدخل رمز الاستعادة المرسل إلى جوالك.");}
    else{
     if(!/^\d{6}$/.test(ascii(code))){setError("أدخل رمز الاستعادة المكوّن من 6 أرقام.");return;}
     await recoverManagedIdentity(normalized,ascii(code),password);
     switchMode("login");setNotice("تم تحديث كلمة المرور. سجّل الدخول بكلمتك الجديدة.");
    }
   }
  }catch(cause){setError(identityErrorMessage(cause,mode==="login"?"login":mode==="recover"?"recovery":"general"))}
  finally{setBusy(false)}
 }
 const textField=(label:string,value:string,change:(value:string)=>void,keyboard:"default"|"phone-pad"|"numeric"="default")=><View style={styles.field}>
  <Text style={styles.label}>{label}</Text>
  <TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy}
   keyboardType={keyboard} autoCapitalize="none" style={styles.input}/>
 </View>;
 const passwordField=(label:string,value:string,change:(value:string)=>void,shown:boolean,toggle:()=>void)=><View style={styles.field}>
  <Text style={styles.label}>{label}</Text>
  <View style={styles.password}>
   <BthwaniIconButton icon={shown?"eye-off":"eye"} label={(shown?"إخفاء ":"إظهار ")+label} onPress={toggle} disabled={busy} size={40} tone="soft"/>
   <TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy}
    autoCapitalize="none" autoCorrect={false} spellCheck={false}
    autoComplete={mode==="login"?"current-password":"new-password"} secureTextEntry={!shown} style={styles.passwordInput}/>
  </View>
 </View>;
 const buttonLabel=mode==="recover"?(codeSent?"تغيير كلمة المرور":"إرسال رمز الاستعادة")
  :mode==="login"?"تسجيل الدخول":codeSent?"تأكيد الجوال والدخول":"إنشاء حساب";
 return <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <View style={styles.header}>
   <Text style={styles.title}>بثواني للشركاء</Text>
   <Text style={styles.subtitle}>أنشئ حسابك وابدأ إعداد متجرك مباشرة.</Text>
  </View>
  <View style={styles.card}>
   {restoring?<ActivityIndicator accessibilityLabel="استعادة الجلسة"/>:null}
   <Text style={styles.heading}>{mode==="register"?"إنشاء حساب شريك":mode==="login"?"تسجيل الدخول":"استعادة كلمة المرور"}</Text>
   {isVerifiedClient&&!isPartner&&!restoring?<View style={{gap:10}}>
    <Text style={styles.small}>حسابك موثّق. يمكنك الدخول إلى حساب الشريك دون إعادة التحقق من الجوال.</Text>
    <BthwaniButton label="متابعة إلى إعداد متجري" onPress={()=>{if(busy)return;setBusy(true);setError("");void activateVerifiedAccount().catch(cause=>setError(identityErrorMessage(cause))).finally(()=>setBusy(false))}} disabled={busy}/>
   </View>:null}
   {!isPartner&&!restoring&&!isVerifiedClient?<View style={{gap:15}}>
    <View style={styles.fields}>
     {textField("رقم الجوال",phone,v=>{setPhone(v);setCodeSent(false);setCode("")},"phone-pad")}
     {mode!=="recover"||codeSent?passwordField(mode==="recover"?"كلمة المرور الجديدة":"كلمة المرور",password,mode==="login"?setPassword:v=>setPassword(limitPasswordInput(v)),visible,()=>setVisible(v=>!v)):null}
    </View>
    {mode==="register"||mode==="recover"&&codeSent?passwordField("تأكيد كلمة المرور",confirm,v=>setConfirm(limitPasswordInput(v)),confirmVisible,()=>setConfirmVisible(v=>!v)):null}
    {mode==="register"?<Text style={styles.small}>كلمة المرور 8 أحرف بالضبط. الاسم وبيانات المتجر تُستكمل بعد الدخول.</Text>:null}
    {codeSent?textField("رمز التحقق",code,v=>setCode(ascii(v).replace(/\D/g,"").slice(0,6)),"numeric"):null}
    {mode!=="login"&&confirm.length>0&&!validatePasswordInputShape(password,confirm).valid?<Text accessibilityRole="alert" style={styles.error}>تحقق من كلمة المرور وتأكيدها؛ يجب أن تتطابقا وتكونا 8 أحرف.</Text>:null}
    <BthwaniButton label={buttonLabel} onPress={()=>void submit()} disabled={busy||!canSubmit||Boolean(codeSent&&!/^\d{6}$/.test(ascii(code)))}/>
    {mode==="register"&&codeSent?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setCodeSent(false);setCode("")}}><Text style={styles.link}>إعادة طلب رمز التحقق</Text></Pressable>:null}
    {mode==="register"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>switchMode("login")}><Text style={styles.link}>لديك حساب؟ تسجيل الدخول</Text></Pressable>:null}
    {mode==="login"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>switchMode("register")}><Text style={styles.link}>ليس لديك حساب؟ إنشاء حساب</Text></Pressable>:null}
    {mode==="login"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>switchMode("recover")}><Text style={styles.link}>نسيت كلمة المرور؟</Text></Pressable>:null}
    {mode==="recover"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>switchMode("login")}><Text style={styles.link}>العودة لتسجيل الدخول</Text></Pressable>:null}
   </View>:null}
   {notice?<Text accessibilityLiveRegion="polite" style={styles.small}>{notice}</Text>:null}
   {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>
 </ScrollView>;
}
