"use client";

import { type CommerceVertical, type CommercialStoreType, createDshMobileClient, type CreateJoiningCaseRequest, type JoiningCaseResponse, joiningCaseStateLabel, type ServiceCity, type StoreFulfillmentMode } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { BthwaniMapCoordinate, BthwaniMapProps } from "@bthwani/design-system/native/map";
import { normalizeYemenPhoneE164, toAsciiDigits } from "@bthwani/design-system";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { currentProspectSession, loginProspect, logoutProspect, prospectAccessToken, registerProspect, requestProspectRegistration, restoreProspectSession, subscribeProspectSession } from "../../bootstrap/applicant-identity";
import { listActiveServiceCities, listCatalogVerticals, listCommercialStoreTypes } from "./store-readback-client";

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
  inner:{padding:20,gap:12},
  heading:{fontSize:23,fontWeight:"700" as const,color:theme.color,textAlign:"right" as const},
  text:{fontSize:15,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const},
  muted:{fontSize:13,color:theme.colorMuted,textAlign:"right" as const},
  input:{borderWidth:1,borderColor:theme.borderColor,borderRadius:10,padding:12,color:theme.color,textAlign:"right" as const,writingDirection:"rtl" as const,minHeight:48},
  choice:{borderWidth:1,borderColor:theme.borderColor,borderRadius:10,padding:10},
  selected:{borderColor:theme.actionBackground,borderWidth:2},
 }),[theme]);
 const [session,setSession]=useState(currentProspectSession());
 const [restoring,setRestoring]=useState(true);
 const [mode,setMode]=useState<"login"|"register">("register");
 const [phone,setPhone]=useState("");
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
 const [proofNumber,setProofNumber]=useState("");
 const [modes,setModes]=useState<StoreFulfillmentMode[]>(["BTHWANI_CAPTAIN"]);
 const selectedOrigin=useMemo<BthwaniMapCoordinate|null>(()=>{
  if(!lat.trim()||!lng.trim())return null;
  const latitude=Number(toAsciiDigits(lat));const longitude=Number(toAsciiDigits(lng));
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180?{latitude,longitude}:null;
 },[lat,lng]);

 useEffect(()=>{
  let active=true;
  const un=subscribeProspectSession(value=>{if(active)setSession(value)});
  void restoreProspectSession().catch(()=>{if(active)setError("تعذر استعادة جلسة المتقدم، أعد المحاولة.")}).finally(()=>{if(active)setRestoring(false)});
  return()=>{active=false;un()};
 },[]);
 const authenticated=session.kind==="authenticated";
 const load=useCallback(async()=>{
  if(!authenticated)return;
  setLoading(true);setError("");
  try{
   const token=await prospectAccessToken();
   const result=await api().readSelfServiceJoiningApplication(token);
   if(result.case.origin!=="self_service")throw new Error("CASE_ORIGIN_MISMATCH");
   setCaseValue(result);
  }catch(cause){
   if(cause && typeof cause==="object" && (cause as {status?:number}).status===404){setCaseValue(null);setHasRead(true);}
   else {setHasRead(false);setError(details(cause));}
  }finally{setLoading(false)}
 },[authenticated]);
 useEffect(()=>{if(authenticated){void load()}else{setCaseValue(null);setHasRead(false);setIntakeStep("basics")}},[authenticated,load]);
 useEffect(()=>{
  if(!authenticated || caseValue)return;
  let active=true;
  void Promise.all([listActiveServiceCities(),listCatalogVerticals()]).then(([a,b])=>{if(active){setCities(a);setVerticals(b)}}).catch(()=>{if(active)setError("تعذر قراءة المدن والمجالات. تحقق من الاتصال.")});
  return()=>{active=false};
 },[authenticated,caseValue]);
 useEffect(()=>{
  if(!vertical){setTypes([]);setStoreType("");return}
  let active=true;
  setStoreType("");
  void listCommercialStoreTypes(vertical).then(result=>{if(active)setTypes(result)}).catch(()=>{if(active)setError("تعذر تحميل أنواع المتاجر")});
  return()=>{active=false};
 },[vertical]);

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
  if(busy)return;
  setError("");setNotice("");
  const latitude=Number(toAsciiDigits(lat));const longitude=Number(toAsciiDigits(lng));
  if(!/^\+[1-9]\d{7,14}$/.test(normalizeYemenPhoneE164(phone))||!ownerName.trim()||!storeName.trim()||!address.trim()||!city||!vertical||!storeType||!proofNumber.trim()||modes.length===0||
     !lat.trim()||!lng.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)){
   setError("أكمل البيانات الأساسية واختر المدينة والمجال ونوع المتجر وطريقة التوصيل وحدد موقعه.");return;
  }
  const input:CreateJoiningCaseRequest={
   contactPhoneE164:normalizeYemenPhoneE164(phone),ownerFullName:ownerName.trim(),businessName:storeName.trim(),firstStoreName:storeName.trim(),
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
   if(result.case.origin!=="self_service")throw new Error("CASE_ORIGIN_MISMATCH");
   const read=await api().readSelfServiceJoiningApplication(token);
   if(read.case.id!==result.case.id)throw new Error("CASE_READBACK_MISMATCH");
   setCaseValue(read);setNotice("سُجل طلب الانضمام؛ سيُراجع قسم الشركاء بياناتك قبل منح صلاحيات المتجر.");
  }catch(cause){await load();setError(details(cause))}
  finally{setBusy(false)}
 }
 const field=(label:string,value:string,set:(value:string)=>void,secure=false,keyboard:"default"|"phone-pad"|"numeric"|"numbers-and-punctuation"="default")=>
  <View style={{gap:4}}><Text style={styles.text}>{label}</Text><TextInput accessibilityLabel={label} style={styles.input} value={value} onChangeText={set} editable={!busy} keyboardType={keyboard} secureTextEntry={secure} autoCapitalize="none"/></View>;
 const select=<T extends string>(label:string,items:readonly {id:T;label:string}[],value:T,set:(id:T)=>void)=>
  <View style={{gap:5}}><Text style={styles.text}>{label}</Text><View style={{gap:5}}>{items.map(item=><Pressable accessibilityRole="radio" accessibilityState={{checked:value===item.id,disabled:busy}} key={item.id} onPress={()=>set(item.id)} disabled={busy} style={[styles.choice,value===item.id&&styles.selected]}><Text style={styles.text}>{item.label}</Text></Pressable>)}</View></View>;
 return <ScrollView style={styles.root} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
  <Text style={styles.heading}>طلب الانضمام إلى بثواني</Text>
  <Text style={styles.muted}>يمكن التقديم دون ميداني. يُتحقق من هاتفك أولاً؛ ولا يمنح الطلب صلاحية إدارة متجر حتى موافقة قسم الشركاء.</Text>
  <BthwaniButton label="العودة لتسجيل دخول الشريك" onPress={()=>router.back()} variant="secondary"/>
  {restoring||loading?<ActivityIndicator accessibilityLabel="جارٍ التحقق من بيانات الطلب"/>:null}
  {!authenticated&&!restoring?<View style={{gap:10}}>
   {select("لدي حساب موثق أم أريد التسجيل؟",[{id:"register" as const,label:"تسجيل رقم جديد"},{id:"login" as const,label:"الدخول بحساب موجود"}],mode,(next)=>{setMode(next);setProofRequested(false);setCode("");setError("");})}
   {field("رقم الهاتف",phone,(next)=>{setPhone(next);setProofRequested(false);setCode("");},false,"phone-pad")}
   {mode==="register"?<><BthwaniButton label="إرسال رمز التحقق" onPress={()=>void requestProof()} disabled={busy}/>{proofRequested?field("رمز التحقق",code,setCode,false,"numeric"):null}</>:null}
   {field("كلمة المرور",password,setPassword,true)}
   {mode==="register"?field("تأكيد كلمة المرور",passwordConfirmation,setPasswordConfirmation,true):null}
   <BthwaniButton label={busy?"جارٍ التحقق…":mode==="register"?"إثبات رقم الهاتف والمتابعة":"دخول المتقدم"} onPress={()=>void authenticate()} disabled={busy|| (mode==="register"&&!proofRequested)}/>
  </View>:null}
  {authenticated&&!caseValue&&!hasRead&&!loading?<View style={{gap:8}}><Text accessibilityRole="alert" style={styles.muted}>تعذر التحقق من وجود طلب سابق. لن يتاح إنشاء طلب آخر قبل قراءة حالتك من المنصة.</Text><BthwaniButton label="إعادة التحقق من طلب الانضمام" variant="secondary" onPress={()=>void load()} disabled={busy}/></View>:null}
  {authenticated&&caseValue?<View style={{gap:9}}>
   <Text style={styles.heading}>طلبك الحالي</Text>
   <Text style={styles.text}>المتجر: {caseValue.case.firstStoreName}</Text>
   <Text style={styles.text}>الحالة: {joiningCaseStateLabel(caseValue.case.state)}</Text>
   {caseValue.case.state==="needs_correction"?<>
    <Text accessibilityRole="alert" style={styles.muted}>أُعيد طلبك للتصحيح. سجّل الدخول إلى حساب الشريك المرتبط برقمك، وراجع الملاحظات وأعد تقديم البيانات من شاشة الانضمام.</Text>
    {caseValue.case.correctionReason?<Text style={styles.text}>سبب التصحيح: {caseValue.case.correctionReason}</Text>:null}
    <BthwaniButton label="الانتقال إلى حساب الشريك لتصحيح الطلب" onPress={()=>router.back()} />
   </>:caseValue.case.state==="approved"?<>
    <Text style={styles.muted}>اعتمد قسم الشركاء طلبك. ادخل إلى حساب الشريك بنفس رقم الهاتف، ثم أكمل بيانات المتجر والكتالوج والاتفاق التجاري قبل طلب النشر.</Text>
    <BthwaniButton label="الانتقال إلى حساب الشريك لإكمال المتجر" onPress={()=>router.back()} />
   </>:caseValue.case.state==="submitted"?<Text style={styles.muted}>طلبك قيد مراجعة قسم الشركاء. لا ترسل طلبًا ثانيًا؛ ستظهر هنا حالة المراجعة والتصحيح عند تحديثها.</Text>
   :<Text style={styles.muted}>طلبك محفوظ كمسودة وينتظر خطوة قبول أولية من قسم الشركاء. لا يلزم تسجيل طلب جديد.</Text>}
   <BthwaniButton label="تحديث حالة الطلب" variant="secondary" onPress={()=>void load()} disabled={loading}/>
  </View>:null}
  {authenticated&&!caseValue&&hasRead&&!loading?<View style={{gap:11}}>
   {intakeStep==="basics"?<>
   <Text style={styles.heading}>الخطوة ١ من ٢ · معلومات النشاط</Text>
   <Text style={styles.muted}>أدخل بيانات صاحب النشاط والمتجر؛ يمكنك مراجعتها قبل الإرسال.</Text>
   {field("رقم الهاتف المرتبط بحسابك",phone,setPhone,false,"phone-pad")}
   <Text style={styles.muted}>اكتب نفس الرقم الذي سجلت به الدخول؛ ستتحقق Identity من تطابقه قبل إنشاء الطلب.</Text>
   {field("الاسم الكامل لصاحب النشاط",ownerName,setOwnerName)}
   {field("اسم النشاط والمتجر",storeName,setStoreName)}
   {field("عنوان المتجر",address,setAddress)}
   {select("مدينة الخدمة",cities.map(c=>({id:c.id,label:c.displayNameAr})),city,setCity)}
   {select("المجال التجاري",verticals.map(v=>({id:v.id,label:v.nameAr})),vertical,setVertical)}
   {select("نوع المتجر",types.map(t=>({id:t.id,label:t.nameAr})),storeType,setStoreType)}
   <BthwaniButton label="متابعة إلى الموقع والإثبات" disabled={busy||loading} onPress={()=>{
    if(!/^\+[1-9]\d{7,14}$/.test(normalizeYemenPhoneE164(phone))||ownerName.trim().length<2||storeName.trim().length<2||address.trim().length<4||!city||!vertical||!storeType){
     setError("أدخل رقم هاتف حسابك واسم المالك والنشاط والعنوان، وحدد مدينة الخدمة والمجال ونوع المتجر.");return;
    }
    setError("");setIntakeStep("details");
   }}/>
   </>:<>
   <Text style={styles.heading}>الخطوة ٢ من ٢ · الموقع والإثبات</Text>
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
   {select("نوع إثبات النشاط",PROOFS,proofType,setProofType)}
   {field("رقم وثيقة الإثبات",proofNumber,setProofNumber)}
   <View style={{gap:6}}><Text style={styles.text}>أوضاع التوصيل</Text>{MODES.map(m=><Pressable key={m.id} disabled={busy} accessibilityRole="checkbox" accessibilityState={{checked:modes.includes(m.id),disabled:busy}} style={[styles.choice,modes.includes(m.id)&&styles.selected]} onPress={()=>setModes(old=>old.includes(m.id)?old.filter(x=>x!==m.id):[...old,m.id])}><Text style={styles.text}>{modes.includes(m.id)?"✓ ":""}{m.label}</Text></Pressable>)}</View>
   <BthwaniButton label="إرسال طلب انضمام الشريك" disabled={busy} onPress={()=>void submit()}/>
   </>}
  </View>:null}
  {authenticated?<BthwaniButton label="الخروج من حساب المتقدم" variant="secondary" onPress={()=>void logoutProspect()} disabled={busy}/>:null}
  {notice?<Text accessibilityRole="text" style={styles.muted}>{notice}</Text>:null}
  {error?<Text accessibilityRole="alert" style={styles.text}>{error}</Text>:null}
 </ScrollView>;
}
