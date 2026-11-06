"use client";

import { type CommerceVertical, type CommercialStoreType, createDshMobileClient, type CreateJoiningCaseRequest, type JoiningCaseResponse, joiningCaseStateLabel, type ServiceCity, type StoreFulfillmentMode } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { BthwaniMapCoordinate, BthwaniMapProps } from "@bthwani/design-system/native/map";
import { toAsciiDigits } from "@bthwani/design-system";
import { normalizeYemenPhoneE164 } from "@bthwani/identity/phone";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentProspectSession, loginProspect, logoutProspect, prospectAccessToken, registerProspect, requestProspectRegistration, restoreProspectSession, subscribeProspectSession } from "../../bootstrap/applicant-identity";
import { listActiveServiceCities, listCatalogVerticals, listCommercialStoreTypes } from "./store-readback-client";
import { JoiningCaseCorrection } from "./joining-case-correction";

const MODES:readonly {id:StoreFulfillmentMode;label:string}[]=[
 {id:"BTHWANI_CAPTAIN",label:"توصيل بثواني"},
 {id:"PARTNER_CAPTAIN",label:"توصيل المتجر"},
 {id:"CUSTOMER_PICKUP",label:"استلام العميل من المتجر"},
];
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
 const styles=useMemo(()=>StyleSheet.create({
  root:{flex:1,backgroundColor:theme.background},
  inner:{flexGrow:1,paddingHorizontal:16,paddingVertical:24,alignItems:"center",gap:16},
  hero:{width:"100%",maxWidth:600,alignItems:"center",paddingTop:10,gap:8,marginBottom:3},
  brand:{flexDirection:"row-reverse",alignItems:"center",gap:9,marginBottom:5},
  brandMark:{width:36,height:36,borderRadius:12,backgroundColor:theme.actionBackground,alignItems:"center",justifyContent:"center"},
  brandMarkText:{fontSize:21,fontWeight:"800" as const,color:theme.onAction},
  brandName:{fontSize:16,fontWeight:"700" as const,color:theme.color},
  heading:{fontSize:25,fontWeight:"800" as const,color:theme.color,textAlign:"center" as const,writingDirection:"rtl" as const},
  intro:{fontSize:14,color:theme.colorMuted,textAlign:"center" as const,lineHeight:23,maxWidth:510,writingDirection:"rtl" as const},
  formCard:{width:"100%",maxWidth:600,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:22,padding:20,gap:16,
   shadowColor:theme.shadowColor,shadowOffset:{width:0,height:8},shadowOpacity:0.08,shadowRadius:20,elevation:3},
  content:{gap:14},
  cardTitle:{fontSize:19,fontWeight:"700" as const,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  text:{fontSize:14,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  muted:{fontSize:13,color:theme.colorMuted,textAlign:"right" as const,lineHeight:21,writingDirection:"rtl" as const},
  label:{fontSize:13,fontWeight:"600" as const,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  input:{backgroundColor:theme.surfaceInset,borderWidth:1,borderColor:theme.borderColor,borderRadius:12,paddingHorizontal:13,paddingVertical:11,
   color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const,minHeight:48,fontSize:15},
  choiceRow:{flexDirection:"row-reverse",flexWrap:"wrap" as const,justifyContent:"flex-start" as const,gap:8},
  choice:{borderWidth:1,borderColor:theme.borderColor,borderRadius:12,paddingHorizontal:14,paddingVertical:11,backgroundColor:theme.surfaceInset,minHeight:43,minWidth:90,justifyContent:"center" as const},
  selected:{borderColor:theme.actionBackground,backgroundColor:theme.surfaceRaised,borderWidth:2},
  choiceText:{fontSize:13,color:theme.color,textAlign:"center" as const,writingDirection:"rtl" as const},
  selectedText:{fontWeight:"700" as const,color:theme.color},
  segment:{flexDirection:"row-reverse",borderRadius:14,padding:4,backgroundColor:theme.surfaceInset,gap:6},
  segmentButton:{flex:1,alignItems:"center" as const,justifyContent:"center" as const,paddingVertical:12,borderRadius:11},
  segmentSelected:{backgroundColor:theme.surface,borderColor:theme.actionBackground,borderWidth:1},
  segmentLabel:{fontSize:13,color:theme.colorMuted,textAlign:"center" as const},
  segmentLabelSelected:{color:theme.color,fontWeight:"700" as const},
  stepPill:{alignSelf:"flex-end" as const,borderRadius:20,backgroundColor:theme.surfaceInset,paddingHorizontal:12,paddingVertical:6},
  stepLabel:{fontSize:12,color:theme.color,fontWeight:"600" as const},
  section:{gap:10,paddingVertical:8},
  statusPanel:{backgroundColor:theme.surfaceInset,borderRadius:14,padding:14,gap:7},
  statusTitle:{fontSize:16,fontWeight:"700" as const,color:theme.color,textAlign:"right" as const},
  notice:{color:theme.color,textAlign:"right" as const,backgroundColor:theme.surfaceRaised,borderRadius:12,padding:12,fontSize:13},
  error:{color:theme.dangerText,backgroundColor:theme.dangerSoft,borderRadius:12,padding:12,fontSize:13,textAlign:"right" as const,writingDirection:"rtl" as const},
  footer:{width:"100%",maxWidth:600,gap:8,alignItems:"center" as const,paddingBottom:8},
  footerText:{fontSize:12,color:theme.colorMuted,textAlign:"center" as const,lineHeight:20},
 }),[theme]);
 const [session,setSession]=useState(currentProspectSession());
 const [restoring,setRestoring]=useState(true);
 const [mode,setMode]=useState<"login"|"register">("register");
 const [phone,setPhone]=useState("");
 const [verifiedContactPhone,setVerifiedContactPhone]=useState("");
 const [manualContactFallback,setManualContactFallback]=useState(false);
 const [password,setPassword]=useState("");
 const [passwordConfirmation,setPasswordConfirmation]=useState("");
 const [code,setCode]=useState("");
 const [proofRequested,setProofRequested]=useState(false);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [caseValue,setCaseValue]=useState<JoiningCaseResponse|null>(null);
 const [hasRead,setHasRead]=useState(false);
 const [intakeStep,setIntakeStep]=useState<"basics"|"details">("basics");
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
   if(scopeRef.current&&scopeRef.current!==nextScope){
    submissionEpochRef.current+=1;setBusy(false);
    setCaseValue(null);setHasRead(false);setIntakeStep("basics");setLoading(false);
    setVerifiedContactPhone("");setManualContactFallback(false);setPhone("");
    setOwnerName("");setStoreName("");setAddress("");setProofNumber("");setLat("");setLng("");
    setError("");setNotice("");setPassword("");setPasswordConfirmation("");setCode("");setProofRequested(false);
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
 useEffect(()=>{if(authenticated){void load()}else{setCaseValue(null);setHasRead(false);setIntakeStep("basics")}},[authenticated,load]);
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
  if(busy||!phone.trim()||!password)return;
  setBusy(true);setError("");setNotice("");
  try{
   if(mode==="register"){
    if(!proofRequested){throw new Error("يجب طلب رمز التحقق أولاً")}
    if(password!==passwordConfirmation)throw new Error("تأكيد كلمة المرور لا يطابق كلمة المرور.");
    await registerProspect(phone.trim(),toAsciiDigits(code.trim()),password);
   }else{await loginProspect(phone.trim(),password)}
  }catch(cause){setError(cause instanceof Error?cause.message:"تعذر تسجيل الدخول")}finally{setBusy(false)}
 }
 async function requestProof(){
  if(busy || !phone.trim())return;
  setBusy(true);setError("");
  try{await requestProspectRegistration(phone.trim());setProofRequested(true);setNotice("أدخل رمز التحقق المرسل إلى رقمك.")}catch(cause){setError(cause instanceof Error?cause.message:"تعذر طلب الرمز")}finally{setBusy(false)}
 }
 async function submit(){
  if(busy||!sameSession())return;
  const submissionEpoch=++submissionEpochRef.current;
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
   const id=currentProspectSession();
   if(id.kind!=="authenticated")throw new Error("IDENTITY_REQUIRED");
   const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify([id.identity.subject,input]));
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
   <Text style={styles.heading}>طلب الانضمام إلى بثواني</Text>
   <Text style={styles.intro}>سجّل برقم جوالك، وأضف بيانات متجرك بخطوات بسيطة. نراجع الطلب قبل تفعيل إدارة المتجر.</Text>
  </View>
  <View style={styles.formCard}>
  {restoring||loading?<ActivityIndicator accessibilityLabel="جارٍ التحقق من بيانات الطلب"/>:null}
  {!authenticated&&!restoring?<View style={styles.content}>
   <Text style={styles.cardTitle}>ابدأ الآن</Text>
   <Text style={styles.muted}>لديك حساب عميل بثواني؟ استخدم الرقم نفسه، لا تحتاج حسابًا جديدًا.</Text>
   <View style={styles.segment} accessibilityRole="radiogroup">
    {([{id:"register",label:"حساب جديد"},{id:"login",label:"لدي حساب"}] as const).map(item=>
     <Pressable key={item.id} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:mode===item.id,disabled:busy}} onPress={()=>{setMode(item.id);setProofRequested(false);setCode("");setPassword("");setPasswordConfirmation("");setError("")}} style={[styles.segmentButton,mode===item.id&&styles.segmentSelected]}>
      <Text style={[styles.segmentLabel,mode===item.id&&styles.segmentLabelSelected]}>{item.label}</Text>
     </Pressable>)}
   </View>
   {field("رقم الجوال",phone,(next)=>{setPhone(next);setProofRequested(false);setCode("")},false,"phone-pad")}
   {mode==="register"?<BthwaniButton label={proofRequested?"إعادة إرسال رمز التحقق":"إرسال رمز التحقق"} onPress={()=>void requestProof()} disabled={busy}/>:null}
   {mode==="register"&&proofRequested?field("رمز التحقق",code,setCode,false,"numeric"):null}
   {mode==="login"||proofRequested?field("كلمة المرور",password,setPassword,true):null}
   {mode==="register"&&proofRequested?field("تأكيد كلمة المرور",passwordConfirmation,setPasswordConfirmation,true):null}
   <BthwaniButton label={busy?"جارٍ التحقق…":mode==="register"?"تأكيد الرقم والمتابعة":"الدخول إلى طلبي"} onPress={()=>void authenticate()} disabled={busy||(mode==="register"&&!proofRequested)}/>
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
   <View style={styles.stepPill}><Text style={styles.stepLabel}>{intakeStep==="basics"?"الخطوة ١ من ٢":"الخطوة ٢ من ٢"}</Text></View>
   {intakeStep==="basics"?<>
   <Text style={styles.cardTitle}>عرّفنا بمتجرك</Text>
   <Text style={styles.muted}>بيانات أساسية لإرسال طلبك إلى قسم الشراكات.</Text>
   {manualContactFallback?field("رقم الهاتف المرتبط بحسابك",phone,setPhone,false,"phone-pad"):<View style={{gap:4}}><Text style={styles.text}>رقم جوالك الموثق</Text><Text selectable style={styles.text}>{verifiedContactPhone||"جارٍ التحقق من رقم الحساب"}</Text></View>}
   <Text style={styles.muted}>{manualContactFallback?"أدخل الرقم الذي سجلت به الدخول؛ سيطابقه النظام مع هويتك.":"يُستخدم رقم حسابك الموثق تلقائيًا، دون إدخاله مرة ثانية."}</Text>
   {field("الاسم الكامل لصاحب النشاط",ownerName,setOwnerName)}
   {field("اسم النشاط والمتجر",storeName,setStoreName)}
   {field("عنوان المتجر",address,setAddress)}
   {registrySelect("city","مدينة الخدمة",cities.map(c=>({id:c.id,label:c.displayNameAr})),city,setCity)}
   {registrySelect("vertical","المجال التجاري",verticals.map(v=>({id:v.id,label:v.nameAr})),vertical,setVertical)}
   {registrySelect("storeType","نوع المتجر",types.filter(t=>t.verticalId===vertical).map(t=>({id:t.id,label:t.nameAr})),storeType,setStoreType)}
   <BthwaniButton label="متابعة إلى الموقع والإثبات" disabled={busy||loading} onPress={()=>{
    if(!/^\+[1-9]\d{7,14}$/.test(manualContactFallback?normalizeYemenPhoneE164(phone):verifiedContactPhone)||ownerName.trim().length<2||storeName.trim().length<2||address.trim().length<4||!city||!vertical||!storeType||!types.some(t=>t.id===storeType&&t.verticalId===vertical)){
     setError("أدخل رقم هاتف حسابك واسم المالك والنشاط والعنوان، وحدد مدينة الخدمة والمجال ونوع المتجر.");return;
    }
    setError("");setIntakeStep("details");
   }}/>
   </>:<>
   <Text style={styles.cardTitle}>أكمل الموقع والإثبات</Text>
   <BthwaniButton label="العودة إلى معلومات النشاط" variant="secondary" onPress={()=>{setError("");setIntakeStep("basics")}} disabled={busy}/>
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
   <BthwaniButton label="إرسال طلب انضمام الشريك" disabled={busy} onPress={()=>void submit()}/>
   </>}
  </View>:null}
  {notice?<Text accessibilityRole="text" style={styles.notice}>{notice}</Text>:null}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>
  <View style={styles.footer}>
   {authenticated?<BthwaniButton label="تسجيل الخروج من حساب المتقدم" variant="secondary" onPress={()=>void logoutProspect()} disabled={busy}/>:null}
   <BthwaniButton label="العودة لتسجيل دخول الشريك" onPress={()=>router.replace("/")} variant="secondary"/>
   <Text style={styles.footerText}>بياناتك محفوظة ضمن طلب الانضمام، ولا يُنشر المتجر قبل استكمال الاعتماد والجاهزية.</Text>
  </View>
 </ScrollView>;
}
