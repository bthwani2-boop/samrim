import { createDshMobileClient, type CommerceVertical, type CommercialStoreType, type ServiceCity, type StoreFulfillmentMode, type StoreJoiningOption } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { BthwaniMapCoordinate, BthwaniMapProps } from "@bthwani/design-system/native/map";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";
import { firstStoreFulfillmentLabel, firstStoreModesForRelation, firstStoreRelationCanEnroll, type FirstStoreRelation } from "../src/features/partner-onboarding/first-store-relation-choice";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope";
import { readPartnerSetupDraft, rememberPartnerSetupDraft, clearPartnerSetupDraft } from "../src/features/partner-onboarding/partner-setup-draft";

type Step = 0|1|2|3;
type StoreRelationModel = FirstStoreRelation;
const labels=["هوية المتجر","نوع النشاط","الموقع والتواصل","المراجعة"] as const;
const service=()=>createDshMobileClient(process.env.EXPO_PUBLIC_DSH_API_URL||"");

function ascii(v:string){
 return v.replace(/[٠-٩۰-۹]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)>=0?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
}
function errorText(e:unknown,action:"read"|"save"="save"){
 if(e&&typeof e==="object"&&"status" in e){
  const status=(e as {status?:number}).status;
  if(status===409){
   const code="code" in e?(e as {code?:unknown}).code:undefined;
   return code==="STORE_JOINING_CLOSED"?"هذا النوع من المتاجر غير متاح للانضمام حاليًا. حدّث الخيارات وحاول مجددًا.":"متجرك موجود بالفعل أو تغيرت سياسة الانضمام. حدّث الصفحة واقرأ المتاجر.";
  }
  if(status===401||status===403)return "انتهت صلاحية الدخول أو الحساب غير مخوّل. سجّل الدخول مجددًا.";
 }
 return action==="read"?"تعذر تحميل بيانات إعداد المتجر. تحقق من اتصال الخدمة ثم أعد المحاولة.":"تعذر حفظ المتجر الآن. تحقق من اتصال الخدمة وحاول مجددًا دون إدخال متجر جديد.";
}
export default function PartnerStoreSetup(){
 const router=useRouter();
 const [actor,setActor]=useState(currentIdentityState);
 const scope=partnerSetupSessionKey(actor);
 const lastScope=useRef(scope);
 useEffect(()=>subscribeIdentitySession(next=>{
  const nextScope=partnerSetupSessionKey(next);
  if(nextScope!==lastScope.current)clearPartnerSetupDraft(lastScope.current);
  lastScope.current=nextScope;
  setActor(next);
 }),[]);
 useEffect(()=>{
  if(scope)return;
  let active=true;
  void restoreIdentitySession().then(next=>{
   if(!active)return;
   setActor(next);
   if(!partnerSetupSessionKey(next))router.replace("/" as Href);
  }).catch(()=>{if(active)router.replace("/" as Href);});
  return ()=>{active=false;};
 },[router,scope]);
 if(!scope)return <ActivityIndicator accessibilityLabel="التحقق من حساب الشريك"/>;
 // Remount the entire wizard on actor/session changes; no previous owner's form survives.
 return <PartnerStoreSetupForm key={scope} scope={scope}/>;
}

function PartnerStoreSetupForm({scope}:Readonly<{scope:string}>){
 const router=useRouter();
 const theme=useAppearanceTheme();
 const {width}=useWindowDimensions();
 const restored=useMemo(()=>readPartnerSetupDraft(scope),[scope]);
 const [checking,setChecking]=useState(true);
 const [registryReady,setRegistryReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [saved,setSaved]=useState("");
 const [error,setError]=useState("");
 const [step,setStep]=useState<Step>(restored?.step??0);
 const [name,setName]=useState(restored?.name??"");
 const [relation,setRelation]=useState<StoreRelationModel|"">(restored?.relation??"");
 const [address,setAddress]=useState(restored?.address??"");
 const [city,setCity]=useState(restored?.city??"");
 const [vertical,setVertical]=useState(restored?.vertical??"");
 const [storeType,setStoreType]=useState(restored?.storeType??"");
 const [cities,setCities]=useState<readonly ServiceCity[]>([]);
 const [verticals,setVerticals]=useState<readonly CommerceVertical[]>([]);
 const [types,setTypes]=useState<readonly CommercialStoreType[]>([]);
 const [typesLoading,setTypesLoading]=useState(Boolean(restored?.vertical));
 const [typesError,setTypesError]=useState(false);
 const [typesRetry,setTypesRetry]=useState(0);
 const [joiningPolicies,setJoiningPolicies]=useState<readonly StoreJoiningOption[]>([]);
 const [modes,setModes]=useState<StoreFulfillmentMode[]>([...(restored?.modes??["BTHWANI_CAPTAIN"])]);
 const [lat,setLat]=useState(restored?.lat??"");
 const [lng,setLng]=useState(restored?.lng??"");
 const [MapComponent,setMapComponent]=useState<ComponentType<BthwaniMapProps>|null>(null);
 const [mapShown,setMapShown]=useState(false);
 const [manualLocation,setManualLocation]=useState(false);
 const mobile=width<720;
 useEffect(()=>{
  if(checking||!registryReady||saved||step===0)return;
  if(!firstStoreRelationCanEnroll(joiningPolicies,relation)){
   setStep(0);setError("نموذج المتجر لم يعد متاحًا؛ اختر نموذجًا متاحًا بعد تحديث السياسة.");return;
  }
  if(step>1&&(!cities.some(item=>item.id===city)||!verticals.some(item=>item.active&&item.id===vertical)
    ||(!typesLoading&&(typesError||!types.some(type=>type.id===storeType&&type.verticalId===vertical))))){
   setStep(1);setError("تغيرت خيارات نشاط متجرك. راجع المدينة والنشاط والنوع المتاحين ثم تابع.");
  }
 },[checking,registryReady,saved,step,joiningPolicies,relation,cities,city,verticals,vertical,typesLoading,typesError,types,storeType]);
 useEffect(()=>{
  // A temporary same-session form draft, never a DSH Store or publication record.
  if(checking||!registryReady||busy||saved)return;
  rememberPartnerSetupDraft(scope,{step,name,relation,address,city,vertical,storeType,modes,lat,lng});
 },[checking,registryReady,busy,saved,scope,step,name,relation,address,city,vertical,storeType,modes,lat,lng]);
 const selected=useMemo<BthwaniMapCoordinate|null>(()=>{
  const a=Number(ascii(lat)),b=Number(ascii(lng));
  if(!lat.trim()||!lng.trim()||!Number.isFinite(a)||!Number.isFinite(b)||a < -90||a >90||b < -180||b >180)return null;
  return {latitude:a,longitude:b};
 },[lat,lng]);

 const load=useCallback(async()=>{
  setChecking(true);setRegistryReady(false);setError("");
  try{
   if(partnerSetupSessionKey(currentIdentityState())!==scope)return;
   const token=await getUsableIdentityAccessToken();
   const page=await service().listPartnerAccessibleStores(token,1);
   if(partnerSetupSessionKey(currentIdentityState())!==scope)return;
   if(page.stores.length>0){clearPartnerSetupDraft(scope);router.replace("/more" as Href);return;}
   const [availableCities,availableVerticals,policyReadback]=await Promise.all([
    service().listActiveServiceCities(),
    service().listCatalogVerticals(),
    service().listStoreJoiningPolicies(),
   ]);
   if(partnerSetupSessionKey(currentIdentityState())!==scope)return;
   setJoiningPolicies(policyReadback.items);
   setRelation(current=>firstStoreRelationCanEnroll(policyReadback.items,current)?current:"");
   setCities(availableCities);setVerticals(availableVerticals);
   setCity(current=>availableCities.some(item=>item.id===current)?current:availableCities.length===1?availableCities[0]!.id:"");
   const activeVerticals=availableVerticals.filter(item=>item.active);
   setVertical(current=>activeVerticals.some(item=>item.id===current)?current:activeVerticals.length===1?activeVerticals[0]!.id:"");
   setRegistryReady(true);
  }catch(e){
   if(partnerSetupSessionKey(currentIdentityState())===scope)setError(errorText(e,"read"));
  }finally{
   if(partnerSetupSessionKey(currentIdentityState())===scope)setChecking(false);
  }
 },[router,scope]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{
  if(!vertical){setTypes([]);setStoreType("");setTypesError(false);setTypesLoading(false);return;}
  let active=true;
  setTypes([]);
  setTypesLoading(true);setTypesError(false);
  void service().listCommercialStoreTypes(vertical).then(values=>{
   if(!active)return;
   const available=values.filter(x=>x.active&&x.verticalId===vertical);
   setTypes(available);
   setStoreType(current=>available.some(type=>type.id===current)?current:available.length===1?available[0]!.id:"");
  }).catch(()=>{if(active)setTypesError(true)}).finally(()=>{if(active)setTypesLoading(false)});
  return ()=>{active=false};
 },[vertical,typesRetry]);

 async function showMap(){
  if(mapShown){setMapShown(false);return;}
  try{
   if(!MapComponent){
    const module=await import("@bthwani/design-system/native/map");
    setMapComponent(()=>module.BthwaniMap);
   }
   setMapShown(true);
  }catch{setManualLocation(true);setError("الخريطة غير متاحة على هذا الجهاز. أدخل موقع متجرك يدويًا.");}
 }
 function advance(){
  setError("");
  if(step===0&&(!firstStoreRelationCanEnroll(joiningPolicies,relation)||name.trim().length<2)){setError("اختر طريقة تشغيل متاحة حاليًا وأدخل اسم المتجر.");return;}
  if(step===1&&(!city||!vertical||!storeType||!types.some(t=>t.id===storeType&&t.verticalId===vertical))){setError("اختر مدينة الخدمة والمجال ونوع المتجر.");return;}
  if(step===2&&(!selected||address.trim().length<4||modes.length===0)){setError("حدد العنوان والموقع وطريقة التوصيل.");return;}
  setStep(Math.min(step+1,3) as Step);
 }
 async function save(){
  if(busy||!scope||!selected||!name.trim()||!relation||!city||!vertical||!storeType||address.trim().length<4||modes.length===0)return;
  if(!registryReady||!firstStoreRelationCanEnroll(joiningPolicies,relation)){
   setStep(0);setError("تعذر تأكيد إتاحة نموذج المتجر. حدّث الخيارات قبل الإنشاء.");return;
  }
  if(typesLoading||typesError||!types.some(type=>type.id===storeType&&type.verticalId===vertical)
   ||!cities.some(item=>item.id===city)||!verticals.some(item=>item.id===vertical&&item.active)){
   setStep(1);setError("تحقق من المدينة ونوع النشاط وأعد قراءة الخيارات قبل إنشاء المتجر.");return;
  }
  setBusy(true);setError("");
  const starting=scope;
  try{
   const token=await getUsableIdentityAccessToken();
   if(partnerSetupSessionKey(currentIdentityState())!==starting)throw Error("SESSION_CHANGED");
   const result=await service().createPartnerFirstStore(token,{
    name:name.trim(),relationModel:relation,serviceCityId:city,primaryVerticalId:vertical,commercialStoreTypeId:storeType,
    addressText:address.trim(),latitude:selected.latitude,longitude:selected.longitude,fulfillmentModes:modes,
   });
   if(result.relationModel!==relation)throw Error("STORE_RELATION_READBACK_MISMATCH");
   if(partnerSetupSessionKey(currentIdentityState())!==starting)return;
   const confirmed=await service().listPartnerAccessibleStores(token,25);
   if(partnerSetupSessionKey(currentIdentityState())!==starting)return;
   if(!confirmed.stores.some(store=>store.id===result.storeId&&store.owned))throw Error("STORE_READBACK_MISMATCH");
   clearPartnerSetupDraft(scope);
   setSaved(result.storeId);
  }catch(e){
   if(partnerSetupSessionKey(currentIdentityState())===starting)setError(errorText(e));
  }finally{
   if(partnerSetupSessionKey(currentIdentityState())===starting)setBusy(false);
  }
 }
 const s=useMemo(()=>({
  root:{flex:1,backgroundColor:theme.background},
  inner:{flexGrow:1,alignItems:"center" as const,padding:18,paddingTop:35,paddingBottom:45,gap:15},
  card:{width:"100%" as const,maxWidth:760,backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:20,padding:mobile?16:26,gap:15},
  heading:{color:theme.color,fontSize:21,fontWeight:"700" as const,textAlign:"right" as const},
  title:{color:theme.color,fontSize:17,fontWeight:"700" as const,textAlign:"right" as const},
  text:{color:theme.color,fontSize:14,textAlign:"right" as const,writingDirection:"rtl" as const},
  small:{color:theme.colorMuted,fontSize:13,textAlign:"right" as const,lineHeight:22},
  field:{backgroundColor:theme.surfaceInset,color:theme.color,borderRadius:11,borderWidth:1,borderColor:theme.borderColor,paddingHorizontal:12,paddingVertical:13,textAlign:"right" as const},
  option:{padding:12,borderRadius:10,borderWidth:1,borderColor:theme.borderColor,backgroundColor:theme.surfaceInset,marginVertical:3},
  chosen:{borderColor:theme.actionBackground,borderWidth:2},
  steps:{flexDirection:"row-reverse" as const,gap:5},
  step:{flex:1,paddingVertical:12,paddingHorizontal:4,borderBottomWidth:3,borderBottomColor:theme.borderColor,alignItems:"center" as const},
  active:{borderBottomColor:theme.actionBackground},
  error:{color:theme.dangerText,backgroundColor:theme.dangerSoft,borderRadius:10,padding:12,textAlign:"right" as const},
 }),[theme,mobile]);
 const choose=(label:string,options:readonly {id:string,label:string}[],value:string,change:(id:string)=>void)=><View style={{gap:5}}>
  <Text style={s.title}>{label}</Text>
  {options.length===0?<Text style={s.small}>لا توجد خيارات متاحة حاليًا.</Text>:options.map(item=><Pressable
   accessibilityRole="radio" accessibilityState={{checked:value===item.id}} key={item.id} disabled={busy}
   onPress={()=>change(item.id)} style={[s.option,value===item.id&&s.chosen]}>
    <Text style={s.text}>{value===item.id?"✓  ":""}{item.label}</Text>
   </Pressable>)}
 </View>;
 return <ScrollView style={s.root} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
  <View style={s.card}>
   <Text style={s.heading}>إعداد متجرك في بثواني</Text>
   <Text style={s.small}>يمكنك إنشاء المتجر بنفسك دون طلب انضمام أو انتظار موافقة لإنشاء الحساب.</Text>
   {restored&&!saved?<Text style={s.small} accessibilityRole="summary">استعدنا بيانات إعدادك غير المحفوظة في جلسة الدخول الحالية. نتحقق من إتاحة الخيارات مجددًا قبل الإنشاء.</Text>:null}
   {checking?<ActivityIndicator accessibilityLabel="التحقق من المتجر"/>:null}
   {!checking&&registryReady&&!saved?<View style={{gap:15}}>
    <View style={s.steps}>
     {labels.map((label,index)=><View key={label} style={[s.step,index===step&&s.active]}><Text style={s.small}>{index<step?"✓ ":""}{label}</Text></View>)}
    </View>
    {step===0?<View style={{gap:10}}>
     <Text style={s.title}>طريقة تشغيل المتجر</Text>
     {!joiningPolicies.some(policy=>policy.enrollmentEnabled)?<Text style={s.error}>إنشاء متاجر جديدة متوقف حاليًا. إذا كان لديك متجر قائم فادخل من لوحة متاجرك.</Text>:null}
     <Text style={s.small}>المتجر نفسه وصفحاته ومنتجاته. يمكنك اختيار شراكة بثواني أو متجر ويب خاص، دون إنشاء حساب آخر.</Text>
     {([["BTHWANI_PARTNER","انضم إلى بثواني","اعرض متجرك لعملاء بثواني بعد مراجعة الاتفاق والتفعيل."],["INDEPENDENT_STORE","أنشئ متجرك الخاص","متجر ويب مستقل؛ تتولى البيع والتوصيل والدفع بنفسك. نشر الرابط المباشر لا يزال قيد التجهيز."]] as const).filter(([id])=>firstStoreRelationCanEnroll(joiningPolicies,id)).map(([id,title,description])=><Pressable
       key={id} accessibilityRole="radio" accessibilityState={{checked:relation===id}} disabled={busy}
       style={[s.option,relation===id&&s.chosen]}
       onPress={()=>{setModes(current=>firstStoreModesForRelation(relation,id,current));setRelation(id);}}>
        <Text style={s.title}>{relation===id?"✓  ":""}{title}</Text>
        <Text style={s.small}>{description}</Text>
       </Pressable>)}
     <Text style={s.title}>هوية المتجر</Text>
     <Text style={s.small}>الاسم والبريد الشخصي ليسا شرطًا لإنشاء الحساب. ابدأ باسم متجرك فقط.</Text>
     <TextInput accessibilityLabel="اسم المتجر" value={name} onChangeText={setName} editable={!busy} placeholder="اكتب اسم المتجر" placeholderTextColor={theme.colorMuted} style={s.field}/>
    </View>:null}
    {step===1?<View style={{gap:8}}>
     {choose("مدينة الخدمة",cities.map(x=>({id:x.id,label:x.displayNameAr})),city,setCity)}
     {choose("المجال التجاري",verticals.filter(x=>x.active).map(x=>({id:x.id,label:x.nameAr})),vertical,setVertical)}
     {choose("نوع المتجر",types.map(x=>({id:x.id,label:x.nameAr})),storeType,setStoreType)}
     {typesLoading?<ActivityIndicator accessibilityLabel="تحميل أنواع المتاجر"/>:null}
     {typesError?<View style={{gap:8}}><Text accessibilityRole="alert" style={s.error}>تعذر تحميل أنواع المتاجر لهذا المجال. لم يتم حفظ اختيار غير مؤكد.</Text><BthwaniButton label="إعادة تحميل الأنواع" variant="secondary" disabled={busy} onPress={()=>setTypesRetry(n=>n+1)}/></View>:null}
    </View>:null}
    {step===2?<View style={{gap:12}}>
     <TextInput accessibilityLabel="عنوان المتجر" value={address} onChangeText={setAddress} editable={!busy} placeholder="الشارع، الحي، أقرب معلم" placeholderTextColor={theme.colorMuted} style={s.field}/>
     <BthwaniButton label={mapShown?"إخفاء الخريطة":"تحديد موقع المتجر على الخريطة"} variant="secondary" disabled={busy} onPress={()=>void showMap()}/>
     {mapShown&&MapComponent?<MapComponent height={270} accessibilityLabel="خريطة موقع المتجر" selection={selected} selectionTitle="موقع متجري" onSelectCoordinate={point=>{setLat(String(point.latitude));setLng(String(point.longitude))}}/>:null}
     <BthwaniButton label={manualLocation?"إخفاء الإحداثيات اليدوية":"إدخال الإحداثيات يدويًا"} variant="secondary" onPress={()=>setManualLocation(v=>!v)}/>
     {manualLocation?<View style={{gap:7}}>
      <TextInput accessibilityLabel="خط العرض" keyboardType="numbers-and-punctuation" value={lat} onChangeText={setLat} editable={!busy} placeholder="خط العرض" placeholderTextColor={theme.colorMuted} style={s.field}/>
      <TextInput accessibilityLabel="خط الطول" keyboardType="numbers-and-punctuation" value={lng} onChangeText={setLng} editable={!busy} placeholder="خط الطول" placeholderTextColor={theme.colorMuted} style={s.field}/>
     </View>:null}
     <Text style={s.small}>{selected?"تم تحديد موقع المتجر.":"حدد الموقع على الخريطة أو أدخل الإحداثيات."}</Text>
     <Text style={s.title}>طريقة تقديم الطلبات</Text>
     {([["BTHWANI_CAPTAIN","توصيل بثواني"],["PARTNER_CAPTAIN","مندوب المتجر"],["CUSTOMER_PICKUP","استلام من المتجر"]] as const).filter(([id])=>relation!=="INDEPENDENT_STORE"||id!=="BTHWANI_CAPTAIN").map(([id,label])=><Pressable key={id} accessibilityRole="checkbox" accessibilityState={{checked:modes.includes(id)}} disabled={busy} style={[s.option,modes.includes(id)&&s.chosen]} onPress={()=>setModes(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}><Text style={s.text}>{modes.includes(id)?"✓  ":""}{label}</Text></Pressable>)}
    </View>:null}
    {step===3?<View style={{gap:10}}>
     <Text style={s.title}>مراجعة المتجر</Text>
     <Text style={s.text}>المتجر: {name}</Text>
     <Text style={s.text}>النموذج: {relation==="INDEPENDENT_STORE"?"متجر ويب مستقل":"شريك بثواني"}</Text>
     <Text style={s.text}>المدينة: {cities.find(c=>c.id===city)?.displayNameAr}</Text>
     <Text style={s.text}>المجال: {verticals.find(v=>v.id===vertical)?.nameAr}</Text>
     <Text style={s.text}>النوع: {types.find(t=>t.id===storeType)?.nameAr}</Text>
     <Text style={s.text}>العنوان: {address}</Text>
     <Text style={s.text}>طرق تقديم الطلبات المختارة: {modes.map(firstStoreFulfillmentLabel).join("، ") || "لم تُحدّد"}</Text>
     <Text style={s.small}>{relation==="INDEPENDENT_STORE"?"سينشأ المتجر مستقلًا وغير منشور. ستتمكن من تجهيز المنتجات الآن، ونشر رابطه بعد اكتمال خدمة الاستضافة المباشرة وضوابطها؛ لا يوجد دفع أو توصيل بثواني.":"سينشأ المتجر غير منشور. بعد ذلك يمكنك تجهيز الصور والكتالوج والاتفاق التجاري قبل ظهوره في تطبيق العميل."}</Text>
    </View>:null}
    {step<3?<BthwaniButton label="التالي" onPress={advance} disabled={busy}/>:<BthwaniButton label="إنشاء المتجر" onPress={()=>void save()} disabled={busy}/>}
    {step>0?<BthwaniButton label="السابق" variant="secondary" disabled={busy} onPress={()=>{setError("");setStep((step-1) as Step)}}/>:null}
   </View>:null}
   {saved?<View style={{gap:14}}>
    <Text style={s.title}>تم إنشاء متجرك</Text>
    <Text style={s.small}>{relation==="INDEPENDENT_STORE"?"تم حفظ متجرك المستقل وغير المنشور. يمكنك إعداد المنتجات؛ لن يُفتح رابط الشراء المباشر قبل اعتماد ونشر خدمة المتاجر المستقلة.":"المتجر محفوظ وغير منشور حاليًا. يمكنك الدخول إلى لوحة الإدارة وإكمال جاهزية نشره في بثواني."}</Text>
    <BthwaniButton label="فتح لوحة إدارة المتجر" onPress={()=>router.replace("/more" as Href)}/>
   </View>:null}
   {error?<View style={{gap:8}}><Text accessibilityRole="alert" style={s.error}>{error}</Text><BthwaniButton label="تحديث بيانات الانضمام" variant="secondary" disabled={checking||busy} onPress={()=>void load()}/></View>:null}
  </View>
 </ScrollView>;
}
