"use client";

import { type CommerceVertical, type CommercialStoreType, createDshMobileClient, type CreateJoiningCaseRequest, type JoiningCaseResponse, joiningCaseStateLabel, type ServiceCity, type StoreFulfillmentMode } from "@bthwani/dsh";
import { BthwaniButton, BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { BthwaniMapCoordinate, BthwaniMapProps } from "@bthwani/design-system/native/map";
import { toAsciiDigits } from "@bthwani/design-system";
import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import { identityErrorMessage, limitPasswordInput, validatePasswordInputShape } from "@bthwani/identity";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { currentProspectSession, loginProspect, logoutProspect, prospectAccessToken, recoverProspect, registerProspect, requestProspectRecovery, requestProspectRegistration, restoreProspectSession, subscribeProspectSession } from "../../bootstrap/applicant-identity";
import { listActiveServiceCities, listCatalogVerticals, listCommercialStoreTypes } from "./store-readback-client";
import { JoiningCaseCorrection } from "./joining-case-correction";

const MODES:readonly {id:StoreFulfillmentMode;label:string}[]=[
 {id:"BTHWANI_CAPTAIN",label:"توصيل بثواني"},
 {id:"PARTNER_CAPTAIN",label:"توصيل المتجر"},
 {id:"CUSTOMER_PICKUP",label:"استلام العميل من المتجر"},
];
const JOINING_STEPS=[{id:"identity",label:"هوية المتجر"},{id:"category",label:"نوع النشاط"},{id:"contact",label:"معلومات التواصل"},{id:"review",label:"مراجعة الطلب"}] as const;
type JoiningStep=(typeof JOINING_STEPS)[number]["id"];

const PROOFS:readonly {id:CreateJoiningCaseRequest["firstStoreProofType"];label:string}[]=[
 {id:"COMMERCIAL_REGISTRATION",label:"سجل تجاري"},
 {id:"IDENTITY_DOCUMENT",label:"بطاقة هوية"},
 {id:"PASSPORT",label:"جواز سفر"},
];
function details(error:unknown):string{
 const data=error && typeof error==="object"?error as {code?:string;status?:number}:null;
 if(data?.status===400)return "البيانات غير مكتملة أو لا تطابق متطلبات الخدمة؛ راجع العنوان والموقع والوثيقة والمدينة ونوع المتجر.";
 if(data?.status===401)return "انتهت صلاحية جلسة المتقدم؛ سجل الدخول مجددًا ثم اقرأ طلبك.";
 if(data?.status===409)return "يوجد طلب انضمام أو بيانات سابقة لهذا الرقم، اقرأ طلبك أولاً أو تواصل مع قسم الشركاء.";
 if(data?.status===403)return "هوية المتقدم أو رقم الهاتف لا يطابق الحساب الموثق.";
 if(data?.status===404)return "لم يعثر النظام على الطلب. تحقق من الاتصال ثم أعد المحاولة.";
 return "تعذر تأكيد العملية. اقرأ الحالة من الخدمة قبل تكرار الإرسال.";
}
function api(){
 const url=process.env.EXPO_PUBLIC_DSH_API_URL;
 if(!url)throw new Error("DSH_BASE_URL_REQUIRED");
 return createDshMobileClient(url,{cryptoRandomUUID:()=>Crypto.randomUUID()});
}
export function ProspectivePartnerApplication(){
 const theme=useAppearanceTheme();
 const router=useRouter();
 const {width:viewportWidth}=useWindowDimensions();
 const showColumns=viewportWidth>=720;
 const styles=useMemo(()=>StyleSheet.create({
  root:{flex:1,backgroundColor:theme.background},
  inner:{flexGrow:1,paddingHorizontal:16,paddingVertical:24,alignItems:"center",gap:16},
  hero:{width:"100%",maxWidth:680,alignItems:"center",paddingTop:10,gap:8,marginBottom:3},
  brand:{flexDirection:"row-reverse",alignItems:"center",gap:9,marginBottom:5},
  brandMark:{width:36,height:36,borderRadius:12,backgroundColor:theme.actionBackground,alignItems:"center",justifyContent:"center"},
  brandMarkText:{fontSize:21,fontWeight:"800" as const,color:theme.onAction},
  brandName:{fontSize:16,fontWeight:"700" as const,color:theme.color},
  heading:{fontSize:25,fontWeight:"800" as const,color:theme.color,textAlign:"center" as const,writingDirection:"rtl" as const},
  intro:{fontSize:14,color:theme.colorMuted,textAlign:"center" as const,lineHeight:23,maxWidth:510,writingDirection:"rtl" as const},
  formCard:{width:"100%",maxWidth:680,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:22,padding:20,gap:16,
   shadowColor:theme.shadowColor,shadowOffset:{width:0,height:8},shadowOpacity:0.08,shadowRadius:20,elevation:3},
  content:{gap:14},
  fieldRow:{flexDirection:"row" as const,alignItems:"flex-start" as const,gap:14},
  fieldColumn:{flexDirection:"column" as const},
  fieldCell:{flex:1,minWidth:0,width:"100%" as const},
  cardTitle:{fontSize:19,fontWeight:"700" as const,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  text:{fontSize:14,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  muted:{fontSize:13,color:theme.colorMuted,textAlign:"right" as const,lineHeight:21,writingDirection:"rtl" as const},
  label:{fontSize:13,fontWeight:"600" as const,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  passwordRow:{backgroundColor:theme.surfaceInset,borderWidth:1,borderColor:theme.borderColor,borderRadius:12,flexDirection:"row",alignItems:"center",paddingRight:6},
  passwordInput:{flex:1,minWidth:0,borderWidth:0,backgroundColor:"transparent" as const},
  input:{backgroundColor:theme.surfaceInset,borderWidth:1,borderColor:theme.borderColor,borderRadius:12,paddingHorizontal:13,paddingVertical:11,
   color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const,minHeight:48,fontSize:15},
  choiceRow:{flexDirection:"row-reverse",flexWrap:"wrap" as const,justifyContent:"flex-start" as const,gap:8},
  choice:{borderWidth:1,borderColor:theme.borderColor,borderRadius:12,paddingHorizontal:14,paddingVertical:11,backgroundColor:theme.surfaceInset,minHeight:43,minWidth:90,justifyContent:"center" as const},
  selected:{borderColor:theme.actionBackground,backgroundColor:theme.surfaceRaised,borderWidth:2},
  choiceText:{fontSize:13,color:theme.color,textAlign:"center" as const,writingDirection:"rtl" as const},
  selectedText:{fontWeight:"700" as const,color:theme.color},
  stepRow:{flexDirection:"row-reverse" as const,gap:5,marginBottom:4},
  stepItem:{flex:1,minWidth:0,alignItems:"center" as const,gap:5,paddingVertical:10,borderBottomWidth:3,borderBottomColor:theme.borderColor},
  stepCurrent:{borderBottomColor:theme.actionBackground},
  stepDone:{borderBottomColor:theme.colorMuted},
  stepCircle:{height:29,width:29,borderRadius:15,alignItems:"center" as const,justifyContent:"center" as const,backgroundColor:theme.surfaceInset},
  stepCircleCurrent:{backgroundColor:theme.actionBackground},
  stepCircleDone:{backgroundColor:theme.surfaceRaised},
  stepNumber:{fontSize:13,fontWeight:"700" as const,color:theme.colorMuted},
  stepNumberCurrent:{color:theme.onAction},
  stepNumberDone:{color:theme.color},
  stepName:{fontSize:11,fontWeight:"600" as const,color:theme.colorMuted,textAlign:"center" as const,writingDirection:"rtl" as const},
  stepNameCurrent:{color:theme.color},
  section:{gap:10,paddingVertical:8},
  statusPanel:{backgroundColor:theme.surfaceInset,borderRadius:14,padding:14,gap:7},
  statusTitle:{fontSize:16,fontWeight:"700" as const,color:theme.color,textAlign:"right" as const},
  notice:{color:theme.color,textAlign:"right" as const,backgroundColor:theme.surfaceRaised,borderRadius:12,padding:12,fontSize:13},
  error:{color:theme.dangerText,backgroundColor:theme.dangerSoft,borderRadius:12,padding:12,fontSize:13,textAlign:"right" as const,writingDirection:"rtl" as const},
  footer:{width:"100%",maxWidth:680,gap:8,alignItems:"center" as const,paddingBottom:8},
 }),[theme]);
 const [session,setSession]=useState(currentProspectSession());
 const [restoring,setRestoring]=useState(true);
 const [mode,setMode]=useState<"login"|"register"|"recover">("register");
 const [phone,setPhone]=useState("");
 const [verifiedContactPhone,setVerifiedContactPhone]=useState("");
 const [manualContactFallback,setManualContactFallback]=useState(false);
 const [password,setPassword]=useState("");
 const [passwordConfirmation,setPasswordConfirmation]=useState("");
 const [showPassword,setShowPassword]=useState(false);
 const [showPasswordConfirmation,setShowPasswordConfirmation]=useState(false);
 const [code,setCode]=useState("");
 const [proofRequested,setProofRequested]=useState(false);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [caseValue,setCaseValue]=useState<JoiningCaseResponse|null>(null);
 const [hasRead,setHasRead]=useState(false);
 const [intakeStep,setIntakeStep]=useState<JoiningStep>("identity");
 const [expandedRegistry,setExpandedRegistry]=useState<"city"|"vertical"|"storeType"|null>(null);
 const [cities,setCities]=useState<readonly ServiceCity[]>([]);
 const [verticals,setVerticals]=useState<readonly CommerceVertical[]>([]);
 const [types,setTypes]=useState<readonly CommercialStoreType[]>([]);
 const [city,setCity]=useState("");
 const [vertical,setVertical]=useState("");
 const [storeType,setStoreType]=useState("");
 const [ownerName,setOwnerName]=useState("");
 const [storeName,setStoreName]=useState("");
 const [address,setAddress]=useState("");
 const [lat,setLat]=useState("");
 const [lng,setLng]=useState("");
 const [showLocationMap,setShowLocationMap]=useState(false);
 const [MapComponent,setMapComponent]=useState<ComponentType<BthwaniMapProps>|null>(null);
 const [mapLoading,setMapLoading]=useState(false);
 const [mapError,setMapError]=useState("");
 const [manualCoordinateEntry,setManualCoordinateEntry]=useState(false);
 const [proofType,setProofType]=useState<CreateJoiningCaseRequest["firstStoreProofType"]>("IDENTITY_DOCUMENT");
 const [showProofChoices,setShowProofChoices]=useState(false);
 const [showFulfillmentChoices,setShowFulfillmentChoices]=useState(false);
 const [proofNumber,setProofNumber]=useState("");
 const [modes,setModes]=useState<StoreFulfillmentMode[]>(["BTHWANI_CAPTAIN"]);
 const phoneReady=/^\+[1-9]\d{7,14}$/.test(normalizeYemenPhoneE164(phone));
 const needsProof=mode!=="login";
 const passwordShape=mode==="login"?{valid:password.trim().length>0,code:undefined,message:undefined}:validatePasswordInputShape(password,passwordConfirmation);
 const canAuthenticate=phoneReady&&passwordShape.valid&&(!needsProof||(proofRequested&&/^\d{6}$/.test(toAsciiDigits(code).trim())));
 const selectedOrigin=useMemo<BthwaniMapCoordinate|null>(()=>{
  if(!lat.trim()||!lng.trim())return null;
  const latitude=Number(toAsciiDigits(lat));const longitude=Number(toAsciiDigits(lng));
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180?{latitude,longitude}:null;
 },[lat,lng]);

 const sessionScope=session.kind==="authenticated"?`${session.identity.subject}:${session.identity.sessionId}`:"";
 const scopeRef=useRef(sessionScope);
 const submissionEpochRef=useRef(0);
 const sameSession=useCallback(()=>{
  const current=currentProspectSession();
  return current.kind==="authenticated"&&`${current.identity.subject}:${current.identity.sessionId}`===sessionScope;
 },[sessionScope]);
 useEffect(()=>{
  let active=true;
  const un=subscribeProspectSession(value=>{
   if(!active)return;
   const nextScope=value.kind==="authenticated"?`${value.identity.subject}:${value.identity.sessionId}`:"";
   if(scopeRef.current!==nextScope){
    submissionEpochRef.current+=1;setBusy(false);
    setCaseValue(null);setHasRead(false);setIntakeStep("identity");setLoading(false);
    setVerifiedContactPhone("");setManualContactFallback(false);
    // Retain a freshly entered login phone only for the legacy DSH contact fallback.
    // Never retain it when logging out or switching between authenticated actors.
    if(scopeRef.current)setPhone("");
    setOwnerName("");setStoreName("");setAddress("");setProofNumber("");setLat("");setLng("");
    setError("");setNotice("");setPassword("");setPasswordConfirmation("");setShowPassword(false);setShowPasswordConfirmation(false);setCode("");setProofRequested(false);
   }
   scopeRef.current=nextScope;
   setSession(value);
  });
  void restoreProspectSession().catch(()=>{if(active)setError("تعذر استعادة جلسة المتقدم، أعد المحاولة.")}).finally(()=>{if(active)setRestoring(false)});
  return()=>{active=false;un()};
 },[]);
 const authenticated=session.kind==="authenticated";
 const load=useCallback(async()=>{
  if(!sessionScope||!sameSession())return;
  setLoading(true);setError("");
  try{
   const token=await prospectAccessToken();
   // During a rolling local upgrade the older DSH may not yet serve this
   // read-only contact endpoint. Preserve the existing verified-phone input
   // only for that exact 404; do not bypass actual identity errors.
   let contactPhone="";
   try{
    const contact=await api().readSelfServiceApplicantContact(token);
    contactPhone=contact.contactPhoneE164;
   }catch(cause){
    if(!(cause && typeof cause==="object" && (cause as {status?:number}).status===404))throw cause;
   }
   if(!sameSession())return;
   setVerifiedContactPhone(contactPhone);setManualContactFallback(!contactPhone);
   if(contactPhone)setPhone(contactPhone);
   const result=await api().readSelfServiceJoiningApplication(token);
   if(!sameSession())return;
   if(result.case.origin!=="self_service")throw new Error("CASE_ORIGIN_MISMATCH");
   setCaseValue(result);setHasRead(true);
  }catch(cause){
   if(!sameSession())return;
   if(cause && typeof cause==="object" && (cause as {status?:number}).status===404){setCaseValue(null);setHasRead(true);}
   else {setHasRead(false);setError(details(cause));}
  }finally{if(sameSession())setLoading(false)}
 },[sessionScope,sameSession]);
 useEffect(()=>{if(authenticated){void load()}else{setCaseValue(null);setHasRead(false);setIntakeStep("identity")}},[authenticated,load]);
 useEffect(()=>{
  if(!authenticated)return;
  let active=true;
  void Promise.all([listActiveServiceCities(),listCatalogVerticals()]).then(([a,b])=>{if(active){setCities(a);setVerticals(b)}}).catch(()=>{if(active)setError("تعذر قراءة المدن والمجالات. تحقق من الاتصال.")});
  return()=>{active=false};
 },[authenticated]);
 useEffect(()=>{
  if(!vertical){setTypes([]);setStoreType("");return}
  let active=true;
  setStoreType("");
  void listCommercialStoreTypes(vertical).then(result=>{if(active)setTypes(result)}).catch(()=>{if(active)setError("تعذر تحميل أنواع المتاجر")});
  return()=>{active=false};
 },[vertical]);
 // A sole active server option is unambiguous; multi-option registries always
 // require the applicant's explicit choice. The backend revalidates all IDs.
 useEffect(()=>{if(cities.length===1&&!city)setCity(cities[0]!.id)},[cities,city]);
 useEffect(()=>{if(verticals.length===1&&!vertical)setVertical(verticals[0]!.id)},[verticals,vertical]);
 useEffect(()=>{if(types.length===1&&types[0]!.verticalId===vertical&&!storeType)setStoreType(types[0]!.id)},[types,storeType,vertical]);

 async function toggleLocationMap(){
  if(showLocationMap){setShowLocationMap(false);return;}
  if(mapLoading)return;
  if(MapComponent){setShowLocationMap(true);return;}
  setMapLoading(true);setMapError("");
  try{
   // Native map availability depends on the installed Android binary.
   // Loading it only on demand keeps registration usable in older builds.
   const module=await import("@bthwani/design-system/native/map");
   setMapComponent(()=>module.BthwaniMap);
   setShowLocationMap(true);
  }catch{
   setShowLocationMap(false);
   setManualCoordinateEntry(true);
   setMapError("الخريطة غير متاحة في النسخة المثبتة. أدخل الإحداثيات يدويًا أو استخدم نسخة تدعم الخرائط.");
  }finally{setMapLoading(false)}
 }

 async function authenticate(){
  if(busy||!canAuthenticate)return;
  setBusy(true);setError("");setNotice("");
  try{
   const normalized=normalizeYemenPhoneE164(phone);
   if(mode==="register"){
    await registerProspect(normalized,toAsciiDigits(code.trim()),password);
   }else if(mode==="recover"){
    await recoverProspect(normalized,toAsciiDigits(code.trim()),password);
    setMode("login");setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");
    setNotice("تم تغيير كلمة المرور. سجّل دخولك بكلمة المرور الجديدة.");
   }else{
    await loginProspect(normalized,password);
   }
  }catch(cause){setError(identityErrorMessage(cause,mode==="login"?"login":mode==="recover"?"recovery":"general"))}
  finally{setBusy(false)}
 }
 async function requestProof(){
  if(busy||!phoneReady||mode==="login"||(mode==="register"&&!passwordShape.valid))return;
  setBusy(true);setError("");setNotice("");
  try{
   const normalized=normalizeYemenPhoneE164(phone);
   if(mode==="recover")await requestProspectRecovery(normalized);
   else await requestProspectRegistration(normalized);
   setCode("");setProofRequested(true);setNotice("أدخل رمز التحقق المرسل إلى رقمك.");
  }catch(cause){setError(identityErrorMessage(cause,mode==="recover"?"recovery":"general"))}
  finally{setBusy(false)}
 }
 async function submit(){
  const initiating=currentProspectSession();
  if(busy||initiating.kind!=="authenticated"||!sameSession())return;
  const initiatingScope=`${initiating.identity.subject}:${initiating.identity.sessionId}`;
  const submissionEpoch=++submissionEpochRef.current;
  const stillInitiating=()=>{
   const current=currentProspectSession();
   return submissionEpochRef.current===submissionEpoch&&sameSession()&&current.kind==="authenticated"&&
    `${current.identity.subject}:${current.identity.sessionId}`===initiatingScope;
  };
  const canonicalContact=manualContactFallback?normalizeYemenPhoneE164(phone):verifiedContactPhone;
  setError("");setNotice("");
  const latitude=Number(toAsciiDigits(lat));const longitude=Number(toAsciiDigits(lng));
  if(!/^\+[1-9]\d{7,14}$/.test(canonicalContact)||!ownerName.trim()||!storeName.trim()||!address.trim()||!city||!vertical||!storeType||!types.some(t=>t.id===storeType&&t.verticalId===vertical)||!proofNumber.trim()||modes.length===0||
     !lat.trim()||!lng.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)){
   setError("أكمل البيانات الأساسية واختر المدينة والمجال ونوع المتجر وطريقة التوصيل وحدد موقعه.");return;
  }
  const input:CreateJoiningCaseRequest={
   contactPhoneE164:canonicalContact,ownerFullName:ownerName.trim(),businessName:storeName.trim(),firstStoreName:storeName.trim(),
   walletProviderKey:"",firstStoreAddress:address.trim(),serviceCityId:city,firstStoreVerticalId:vertical,firstStoreCommercialTypeId:storeType,
   firstStoreLatitude:latitude,firstStoreLongitude:longitude,firstStoreWorkingHours:{intervals:[]},
   firstStoreProofType:proofType,firstStoreProofNumber:proofNumber.trim(),firstStoreFulfillmentModes:modes,
  };
  setBusy(true);
  try{
   const token=await prospectAccessToken();
   if(!stillInitiating())throw new Error("APPLICANT_SESSION_CHANGED");
   const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([initiating.identity.subject,input]));
   if(!stillInitiating())throw new Error("APPLICANT_SESSION_CHANGED");
   const key=`self_join_${digest}`;
   const result=await api().createSelfServiceJoiningApplication(token,input,key,`self_corr_${digest}`);
   if(!sameSession())return;
   if(result.case.origin!=="self_service")throw new Error("CASE_ORIGIN_MISMATCH");
   const read=await api().readSelfServiceJoiningApplication(token);
   if(!sameSession())return;
   if(read.case.id!==result.case.id)throw new Error("CASE_READBACK_MISMATCH");
   setCaseValue(read);setNotice("سُجل طلب الانضمام؛ سيُراجع قسم الشركاء بياناتك قبل منح صلاحيات المتجر.");
  }catch(cause){if(sameSession()){await load();if(sameSession())setError(details(cause))}}
  finally{if(submissionEpochRef.current===submissionEpoch)setBusy(false)}
 }
 const field=(label:string,value:string,set:(value:string)=>void,secure=false,keyboard:"default"|"phone-pad"|"numeric"|"numbers-and-punctuation"="default")=>
  <View style={{gap:6}}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={set} editable={!busy} keyboardType={keyboard} secureTextEntry={secure} autoCapitalize={secure||keyboard==="phone-pad"?"none":"sentences"}/></View>;
 const passwordField=(label:string,value:string,set:(value:string)=>void,visible:boolean,toggle:()=>void,loginPassword=false)=>
  <View style={{gap:6}}>
   <Text style={styles.label}>{label}</Text>
   <View style={styles.passwordRow}>
    <TextInput accessibilityLabel={label} autoComplete={loginPassword?"current-password":"new-password"} autoCapitalize="none" autoCorrect={false} spellCheck={false}
     style={[styles.input,styles.passwordInput]} value={value} onChangeText={next=>set(loginPassword?next:limitPasswordInput(next))}
     editable={!busy} secureTextEntry={!visible}/>
    <BthwaniIconButton icon={visible?"eye-off":"eye"} label={visible?"إخفاء "+label:"إظهار "+label} disabled={busy} onPress={toggle} size={40} tone="soft"/>
   </View>
  </View>;
 const select=<T extends string>(label:string,items:readonly {id:T;label:string}[],value:T,set:(id:T)=>void)=>
  <View style={{gap:8}}><Text style={styles.label}>{label}</Text><View style={styles.choiceRow}>{items.map(item=><Pressable accessibilityRole="radio" accessibilityState={{checked:value===item.id,disabled:busy}} key={item.id} onPress={()=>set(item.id)} disabled={busy} style={[styles.choice,value===item.id&&styles.selected]}><Text style={[styles.choiceText,value===item.id&&styles.selectedText]}>{item.label}</Text></Pressable>)}</View></View>;
 const registrySelect=<T extends string>(key:"city"|"vertical"|"storeType",label:string,items:readonly {id:T;label:string}[],value:T,set:(id:T)=>void)=>{
  const selected=items.find(item=>item.id===value);
  const expandable=items.length>1;
  return <View style={{gap:5}}>
   {expandable?<Pressable accessibilityRole="button" accessibilityState={{expanded:expandedRegistry===key,disabled:busy}} disabled={busy} onPress={()=>setExpandedRegistry(current=>current===key?null:key)} style={styles.choice}>
    <Text style={styles.text}>{label}: {selected?.label||"اضغط للاختيار"} {expandedRegistry===key?"▴":"▾"}</Text>
   </Pressable>:<Text style={styles.text}>{label}: {selected?.label||"لا توجد خيارات متاحة"}</Text>}
   {expandable&&expandedRegistry===key?<ScrollView style={{maxHeight:230}} nestedScrollEnabled keyboardShouldPersistTaps="handled">{select(label,items,value,next=>{set(next);setExpandedRegistry(null)})}</ScrollView>:null}
  </View>;
 };
 return <ScrollView style={styles.root} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
  <View style={styles.hero}>
   <View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandMarkText}>ب</Text></View><Text style={styles.brandName}>بثواني للشركاء</Text></View>
   <Text style={styles.heading}>{authenticated?"إعداد متجرك":"انضم إلى شركاء بثواني"}</Text>
   <Text style={styles.intro}>{authenticated?"أكمل بيانات متجرك، ثم أرسل طلب الانضمام للمراجعة.":"أنشئ حسابك أو ادخل بحسابك الحالي ثم أعدّ متجرك مباشرة."}</Text>
  </View>
  <View style={styles.formCard}>
  {restoring||loading?<ActivityIndicator accessibilityLabel="جارٍ التحقق من بيانات الطلب"/>:null}
  {!authenticated&&!restoring?<View style={styles.content}>
   <Text style={styles.cardTitle}>{mode==="register"?"بيانات الحساب":mode==="recover"?"استعادة كلمة المرور":"تسجيل الدخول"}</Text>
   <Text style={styles.muted}>{mode==="register"?"رقم الجوال وكلمة المرور فقط. أكمل اسمك وبيانات متجرك بعد الدخول.":mode==="recover"?"سنرسل رمزًا إلى جوالك الموثق.":"استخدم حساب بثواني الموجود لمتابعة طلب متجرك."}</Text>
   <View style={[styles.fieldRow,!showColumns&&styles.fieldColumn]}>
    <View style={styles.fieldCell}>
     {field("رقم الجوال",phone,(next)=>{setPhone(next);setProofRequested(false);setCode("")},false,"phone-pad")}
    </View>
    {mode!=="recover"?<View style={styles.fieldCell}>
     {passwordField("كلمة المرور",password,setPassword,showPassword,()=>setShowPassword(current=>!current),mode==="login")}
    </View>:null}
   </View>
   <Text style={styles.muted}>مثال: 777123456 · سيُستخدم الرقم للتحقق من الحساب.</Text>
   {mode==="register"?<>
    {passwordField("تأكيد كلمة المرور",passwordConfirmation,setPasswordConfirmation,showPasswordConfirmation,()=>setShowPasswordConfirmation(current=>!current))}
    <Text style={styles.muted}>كلمة المرور 8 أحرف بالضبط، وتأكيدها مطابق.</Text>
   </>:null}
   {mode==="recover"&&proofRequested?<>
    {passwordField("كلمة المرور الجديدة",password,setPassword,showPassword,()=>setShowPassword(current=>!current))}
    {passwordField("تأكيد كلمة المرور",passwordConfirmation,setPasswordConfirmation,showPasswordConfirmation,()=>setShowPasswordConfirmation(current=>!current))}
   </>:null}
   {passwordShape.code==="MISMATCH"&&Array.from(passwordConfirmation).length===8?<Text accessibilityRole="alert" style={styles.error}>كلمتا المرور غير متطابقتين. اضغط على رمز العين لمراجعة القيمتين.</Text>:null}
   {!passwordShape.valid&&(mode==="login"?password.length>0:passwordConfirmation.length>0)&&passwordShape.code!=="MISMATCH"?<Text style={styles.muted}>{passwordShape.message}</Text>:null}
   {needsProof&&passwordShape.valid&&passwordConfirmation.length>0?<Text style={styles.muted}>كلمتا المرور متطابقتان.</Text>:null}
   {needsProof&&proofRequested?<View style={{gap:8}}>
    <Text style={styles.muted}>أدخل رمز التحقق المرسل إلى جوالك لإكمال {mode==="register"?"إنشاء الحساب":"استعادة الحساب"}.</Text>
    {field("رمز التحقق",code,value=>setCode(toAsciiDigits(value).replace(/\D/g,"").slice(0,6)),false,"numeric")}
   </View>:null}
   {mode==="register"&&!proofRequested?<BthwaniButton label="إنشاء حساب" onPress={()=>void requestProof()} disabled={busy||!phoneReady||!passwordShape.valid}/>:null}
   {mode==="recover"&&!proofRequested?<BthwaniButton label="إرسال رمز الاستعادة" onPress={()=>void requestProof()} disabled={busy||!phoneReady}/>:null}
   {(mode==="login"||proofRequested)?<BthwaniButton label={busy?"جارٍ التحقق…":mode==="register"?"تأكيد الرقم وإنشاء الحساب":mode==="recover"?"تغيير كلمة المرور":"تسجيل الدخول"} onPress={()=>void authenticate()} disabled={busy||!canAuthenticate}/>:null}
   {needsProof&&proofRequested?<Pressable accessibilityRole="button" disabled={busy||!phoneReady||(mode==="register"&&!passwordShape.valid)} onPress={()=>void requestProof()}>
    <Text style={[styles.text,{color:theme.actionBackground,textAlign:"center"}]}>إعادة إرسال رمز التحقق</Text>
   </Pressable>:null}
   {mode==="register"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setMode("login");setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");setShowPassword(false);setShowPasswordConfirmation(false);setError("");setNotice("")}}><Text style={[styles.text,{color:theme.actionBackground,textAlign:"center"}]}>لديك حساب؟ تسجيل الدخول</Text></Pressable>:null}
   {mode==="login"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setMode("recover");setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");setShowPassword(false);setShowPasswordConfirmation(false);setError("");setNotice("")}}><Text style={[styles.text,{color:theme.actionBackground,textAlign:"center"}]}>نسيت كلمة المرور؟</Text></Pressable>:null}
   {mode==="login"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setMode("register");setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");setShowPassword(false);setShowPasswordConfirmation(false);setError("");setNotice("")}}><Text style={[styles.text,{color:theme.actionBackground,textAlign:"center"}]}>ليس لديك حساب؟ إنشاء حساب</Text></Pressable>:null}
   {mode==="recover"?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setMode("login");setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");setShowPassword(false);setShowPasswordConfirmation(false);setError("");setNotice("")}}><Text style={[styles.text,{color:theme.actionBackground,textAlign:"center"}]}>العودة لتسجيل الدخول</Text></Pressable>:null}
  </View>:null}
  {authenticated&&!caseValue&&!hasRead&&!loading?<View style={{gap:8}}><Text accessibilityRole="alert" style={styles.muted}>تعذر التحقق من وجود طلب سابق. لن يتاح إنشاء طلب آخر قبل قراءة حالتك من المنصة.</Text><BthwaniButton label="إعادة التحقق من طلب الانضمام" variant="secondary" onPress={()=>void load()} disabled={busy}/></View>:null}
  {authenticated&&caseValue?<View style={styles.content}>
   <Text style={styles.cardTitle}>متابعة طلبك</Text>
   <View style={styles.statusPanel}><Text style={styles.statusTitle}>{caseValue.case.firstStoreName}</Text><Text style={styles.muted}>حالة الطلب: {joiningCaseStateLabel(caseValue.case.state)}</Text></View>
   {caseValue.case.state==="needs_correction"?<>
    <Text accessibilityRole="alert" style={styles.muted}>أُعيد طلبك للتصحيح. عدّل بيانات طلبك هنا باستخدام حسابك الموثق نفسه؛ لا تحتاج إلى دور الشريك قبل اعتماد الطلب.</Text>
    {caseValue.case.correctionReason?<Text style={styles.text}>سبب التصحيح: {caseValue.case.correctionReason}</Text>:null}
    <JoiningCaseCorrection
     value={caseValue}
     cities={cities}
     onUpdated={next=>{if(!sameSession())return;setCaseValue(next);if(next.case.state==="submitted")setNotice("أُعيد إرسال بيانات المتجر إلى قسم الشركاء للمراجعة.")}}
     applicant
     readCorrection={async()=>api().readSelfServiceJoiningApplication(await prospectAccessToken())}
     submitCorrection={async(caseID,input,expectedVersion)=>{
      // Capture the initiating session before awaiting a token or digest.
      // A replacement account must never submit the previous account's form.
      const initial=currentProspectSession();
      if(initial.kind!=="authenticated"||!sameSession()||caseID!==caseValue.case.id)throw new Error("APPLICANT_IDENTITY_MISMATCH");
      const initialScope=`${initial.identity.subject}:${initial.identity.sessionId}`;
      const stillOriginal=()=>{
       const now=currentProspectSession();
       return sameSession()&&now.kind==="authenticated"&&`${now.identity.subject}:${now.identity.sessionId}`===initialScope;
      };
      const token=await prospectAccessToken();
      if(!stillOriginal())throw new Error("APPLICANT_SESSION_CHANGED");
      const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([initial.identity.subject,caseID,expectedVersion,input]));
      if(!stillOriginal())throw new Error("APPLICANT_SESSION_CHANGED");
      return api().correctSelfServiceJoiningApplication(token,input,expectedVersion,`applicant_correction_${digest.slice(0,40)}`,`applicant_corr_${digest.slice(0,40)}`);
     }}
    />
   </>:caseValue.case.state==="approved"?<>
    <Text style={styles.muted}>اعتمد قسم الشركاء طلبك. استخدم رقمك نفسه في دخول الشريك؛ إن كانت هذه أول مرة فاختر تفعيل الحساب برمز التحقق وتعيين كلمة مرور الشريك. بعدها أكمل تجهيز المتجر قبل طلب النشر.</Text>
    <BthwaniButton label="تفعيل حساب الشريك أو تسجيل الدخول" onPress={()=>router.replace("/")} />
   </>:caseValue.case.state==="submitted"?<Text style={styles.muted}>طلبك قيد مراجعة قسم الشركاء. لا ترسل طلبًا ثانيًا؛ ستظهر هنا حالة المراجعة والتصحيح عند تحديثها.</Text>
   :<Text style={styles.muted}>طلبك محفوظ كمسودة وينتظر خطوة قبول أولية من قسم الشركاء. لا يلزم تسجيل طلب جديد.</Text>}
   <BthwaniButton label="تحديث حالة الطلب" variant="secondary" onPress={()=>void load()} disabled={loading}/>
  </View>:null}
  {authenticated&&!caseValue&&hasRead&&!loading?<View style={styles.content}>
   <Text style={styles.cardTitle}>إعداد متجرك</Text>
   <Text style={styles.muted}>أكمل الخطوات بالترتيب. يمكن الرجوع لتعديل البيانات قبل إرسال طلب الانضمام.</Text>
   <View style={styles.stepRow} accessibilityLabel="خطوات إعداد المتجر">
    {JOINING_STEPS.map((step,index)=>{
     const current=JOINING_STEPS.findIndex(item=>item.id===intakeStep);
     const isActive=index===current;
     const isDone=index<current;
     return <View key={step.id} style={[styles.stepItem,isActive&&styles.stepCurrent,isDone&&styles.stepDone]}>
      <View style={[styles.stepCircle,isActive&&styles.stepCircleCurrent,isDone&&styles.stepCircleDone]}>
       <Text style={[styles.stepNumber,isActive&&styles.stepNumberCurrent,isDone&&styles.stepNumberDone]}>{isDone?"✓":index+1}</Text>
      </View>
      <Text style={[styles.stepName,isActive&&styles.stepNameCurrent]}>{step.label}</Text>
     </View>;
    })}
   </View>
   {intakeStep==="identity"?<>
    <Text style={styles.cardTitle}>هوية المتجر</Text>
    <Text style={styles.muted}>بيانات المتجر وصاحب النشاط، ولا تحتاج إلى إنشاء حساب آخر.</Text>
    {manualContactFallback?field("رقم الجوال المرتبط بحسابك",phone,setPhone,false,"phone-pad"):<View style={styles.statusPanel}><Text style={styles.label}>رقم الجوال الموثق</Text><Text selectable style={styles.text}>{verifiedContactPhone||"جارٍ التحقق من الحساب"}</Text></View>}
    {field("اسم المتجر",storeName,setStoreName)}
    {field("اسم صاحب النشاط",ownerName,setOwnerName)}
    <BthwaniButton label="التالي: نوع النشاط" disabled={busy||loading} onPress={()=>{
     const contact=manualContactFallback?normalizeYemenPhoneE164(phone):verifiedContactPhone;
     if(!/^\+[1-9]\d{7,14}$/.test(contact)||ownerName.trim().length<2||storeName.trim().length<2){
      setError("أدخل اسم المتجر واسم صاحبه، وتأكد من رقم الجوال المرتبط بحسابك.");return;
     }
     setError("");setIntakeStep("category");
    }}/>
   </>:null}
   {intakeStep==="category"?<>
    <Text style={styles.cardTitle}>نوع النشاط</Text>
    <Text style={styles.muted}>اختر المدينة والمجال التجاري المناسبين لمتجرك.</Text>
    {registrySelect("city","مدينة الخدمة",cities.map(c=>({id:c.id,label:c.displayNameAr})),city,setCity)}
    {registrySelect("vertical","المجال التجاري",verticals.map(v=>({id:v.id,label:v.nameAr})),vertical,setVertical)}
    {registrySelect("storeType","نوع المتجر",types.filter(t=>t.verticalId===vertical).map(t=>({id:t.id,label:t.nameAr})),storeType,setStoreType)}
    <BthwaniButton label="التالي: معلومات التواصل" disabled={busy||loading} onPress={()=>{
     if(!city||!vertical||!storeType||!types.some(t=>t.id===storeType&&t.verticalId===vertical)){
      setError("اختر مدينة الخدمة والمجال التجاري ونوع المتجر المناسب.");return;
     }
     setError("");setIntakeStep("contact");
    }}/>
    <BthwaniButton label="السابق" variant="secondary" onPress={()=>{setError("");setIntakeStep("identity")}} disabled={busy}/>
   </>:null}
   {intakeStep==="contact"?<>
    <Text style={styles.cardTitle}>معلومات التواصل والموقع</Text>
    <Text style={styles.muted}>العنوان وموقع المتجر مطلوبان لمراجعة طلبك؛ صور المتجر والكتالوج تُستكمل بعد الاعتماد.</Text>
    {field("عنوان المتجر",address,setAddress)}
   <View style={{gap:8}}>
    <Text style={styles.text}>موقع المتجر</Text>
    <Text style={styles.muted}>حدد موقع متجرك على الخريطة؛ لا حاجة لإدخال إحداثيات يدويًا. موقع المتجر ليس موقع هاتفك بالضرورة.</Text>
    <BthwaniButton label={mapLoading?"جارٍ تجهيز الخريطة":showLocationMap?"إخفاء الخريطة":"تحديد موقع المتجر على الخريطة"} variant="secondary" onPress={()=>void toggleLocationMap()} disabled={busy||mapLoading}/>
    {mapError?<Text accessibilityRole="alert" style={styles.muted}>{mapError}</Text>:null}
    {showLocationMap&&MapComponent?<MapComponent accessibilityLabel="خريطة تحديد موقع المتجر" selection={selectedOrigin} selectionTitle="موقع متجري" onSelectCoordinate={(point)=>{if(busy)return;setLat(String(point.latitude));setLng(String(point.longitude));setError("");}} height={280}/>:null}
    <BthwaniButton label={manualCoordinateEntry?"إخفاء إدخال الإحداثيات":"إدخال الإحداثيات يدويًا عند تعذر الخريطة"} variant="secondary" onPress={()=>setManualCoordinateEntry(value=>!value)} disabled={busy}/>
    {manualCoordinateEntry?<View style={{gap:8}}>{field("خط عرض المتجر",lat,setLat,false,"numbers-and-punctuation")}{field("خط طول المتجر",lng,setLng,false,"numbers-and-punctuation")}</View>:null}
    {selectedOrigin?<Text accessibilityLiveRegion="polite" style={styles.muted}>تم تحديد موقع المتجر. يمكنك تعديل النقطة قبل إرسال الطلب.</Text>:<Text style={styles.muted}>لم تحدد موقع المتجر بعد. اختر النقطة على الخريطة أو أدخل الإحداثيات عند تعذرها.</Text>}
    <Text style={styles.muted}>الموقع الدقيق مطلوب لمراجعة المتجر؛ أما الصور والكتالوج والاتفاق المالي فتُستكمل قبل النشر.</Text>
   </View>
   <Text style={styles.text}>نوع الإثبات: {PROOFS.find(item=>item.id===proofType)?.label}</Text>
   <BthwaniButton label={showProofChoices?"إخفاء الأنواع":"تغيير نوع الإثبات"} variant="secondary" onPress={()=>setShowProofChoices(value=>!value)} disabled={busy}/>
   {showProofChoices?select("نوع إثبات النشاط",PROOFS,proofType,setProofType):null}
   {field("رقم وثيقة الإثبات",proofNumber,setProofNumber)}
   <Text style={styles.text}>طريقة التوصيل: {modes.map(mode=>MODES.find(item=>item.id===mode)?.label||mode).join("، ")||"غير محددة"}</Text>
   <BthwaniButton label={showFulfillmentChoices?"إخفاء الخيارات":"تغيير طرق التوصيل والاستلام"} variant="secondary" onPress={()=>setShowFulfillmentChoices(value=>!value)} disabled={busy}/>
   {showFulfillmentChoices?<View style={{gap:6}}><Text style={styles.text}>اختر طريقة واحدة على الأقل</Text>{MODES.map(m=><Pressable key={m.id} disabled={busy} accessibilityRole="checkbox" accessibilityState={{checked:modes.includes(m.id),disabled:busy}} style={[styles.choice,modes.includes(m.id)&&styles.selected]} onPress={()=>setModes(old=>old.includes(m.id)?old.filter(x=>x!==m.id):[...old,m.id])}><Text style={styles.text}>{modes.includes(m.id)?"✓ ":""}{m.label}</Text></Pressable>)}</View>:null}

    <BthwaniButton label="مراجعة بيانات الطلب" disabled={busy||loading} onPress={()=>{
     if(address.trim().length<4||!selectedOrigin||!proofNumber.trim()||modes.length===0){
      setError("أدخل عنوان المتجر وحدد موقعه ورقم الوثيقة وطريقة التوصيل.");return;
     }
     setError("");setIntakeStep("review");
    }}/>
    <BthwaniButton label="السابق" variant="secondary" onPress={()=>{setError("");setIntakeStep("category")}} disabled={busy}/>
   </>:null}
   {intakeStep==="review"?<>
    <Text style={styles.cardTitle}>راجع طلب متجرك</Text>
    <Text style={styles.muted}>ستُرسل البيانات إلى قسم الشراكات للمراجعة، ولن يُنشر المتجر أو تُفعّل صلاحيات الشريك قبل الاعتماد.</Text>
    <View style={styles.statusPanel}>
     <Text style={styles.statusTitle}>هوية المتجر</Text>
     <Text style={styles.text}>اسم المتجر: {storeName.trim()}</Text>
     <Text style={styles.text}>صاحب النشاط: {ownerName.trim()}</Text>
     <BthwaniButton label="تعديل هوية المتجر" variant="secondary" onPress={()=>setIntakeStep("identity")} disabled={busy}/>
    </View>
    <View style={styles.statusPanel}>
     <Text style={styles.statusTitle}>نوع النشاط</Text>
     <Text style={styles.text}>{cities.find(x=>x.id===city)?.displayNameAr||city} · {verticals.find(x=>x.id===vertical)?.nameAr||vertical}</Text>
     <Text style={styles.text}>{types.find(x=>x.id===storeType)?.nameAr||storeType}</Text>
     <BthwaniButton label="تعديل نوع النشاط" variant="secondary" onPress={()=>setIntakeStep("category")} disabled={busy}/>
    </View>
    <View style={styles.statusPanel}>
     <Text style={styles.statusTitle}>معلومات التواصل والموقع</Text>
     <Text style={styles.text}>{address.trim()}</Text>
     <Text style={styles.text}>الموقع: {selectedOrigin?"محدد":"غير محدد"} · الإثبات: {PROOFS.find(x=>x.id===proofType)?.label}</Text>
     <Text style={styles.text}>التوصيل: {modes.map(x=>MODES.find(m=>m.id===x)?.label||x).join("، ")}</Text>
     <BthwaniButton label="تعديل معلومات التواصل" variant="secondary" onPress={()=>setIntakeStep("contact")} disabled={busy}/>
    </View>
    <BthwaniButton label="إرسال طلب الانضمام" disabled={busy||loading} onPress={()=>void submit()}/>
    <BthwaniButton label="السابق" variant="secondary" onPress={()=>setIntakeStep("contact")} disabled={busy}/>
   </>:null}
  </View>:null}
  {notice?<Text accessibilityRole="text" style={styles.notice}>{notice}</Text>:null}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>
  {authenticated?<View style={styles.footer}>
   {authenticated?<BthwaniButton label="تسجيل الخروج من حساب المتقدم" variant="secondary" onPress={()=>void logoutProspect()} disabled={busy}/>:null}
   <Text style={styles.muted}>إعداد المتجر لا يمنح صلاحيات الشريك قبل الاعتماد، ولا ينشر المتجر تلقائيًا.</Text>
  </View>:null}
 </ScrollView>;
}
