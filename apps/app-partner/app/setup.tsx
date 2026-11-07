import { createDshMobileClient, type CommerceVertical, type CommercialStoreType, type ServiceCity, type StoreFulfillmentMode } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { BthwaniMapCoordinate, BthwaniMapProps } from "@bthwani/design-system/native/map";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken, restoreIdentitySession, subscribeIdentitySession } from "../src/bootstrap/identity";

type Step = 0|1|2|3;
const labels=["هوية المتجر","نوع النشاط","الموقع والتواصل","المراجعة"] as const;
const service=()=>createDshMobileClient(process.env.EXPO_PUBLIC_DSH_API_URL||"");

function ascii(v:string){
 return v.replace(/[٠-٩۰-۹]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)>=0?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
}
function errorText(e:unknown){
 if(e&&typeof e==="object"&&"status" in e){
  const status=(e as {status?:number}).status;
  if(status===409)return "متجرك موجود بالفعل. افتح لوحة التحكم أو أعد قراءة المتاجر.";
  if(status===401||status===403)return "انتهت صلاحية الدخول أو الحساب غير مخوّل. سجّل الدخول مجددًا.";
 }
 return "تعذر حفظ المتجر الآن. تحقق من اتصال الخدمة وحاول مجددًا دون إدخال متجر جديد.";
}
export default function PartnerStoreSetup(){
 const router=useRouter();
 const theme=useAppearanceTheme();
 const {width}=useWindowDimensions();
 const [actor,setActor]=useState(currentIdentityState());
 const [checking,setChecking]=useState(true);
 const [busy,setBusy]=useState(false);
 const [saved,setSaved]=useState("");
 const [error,setError]=useState("");
 const [step,setStep]=useState<Step>(0);
 const [name,setName]=useState("");
 const [address,setAddress]=useState("");
 const [city,setCity]=useState("");
 const [vertical,setVertical]=useState("");
 const [storeType,setStoreType]=useState("");
 const [cities,setCities]=useState<readonly ServiceCity[]>([]);
 const [verticals,setVerticals]=useState<readonly CommerceVertical[]>([]);
 const [types,setTypes]=useState<readonly CommercialStoreType[]>([]);
 const [modes,setModes]=useState<StoreFulfillmentMode[]>(["BTHWANI_CAPTAIN"]);
 const [lat,setLat]=useState("");
 const [lng,setLng]=useState("");
 const [MapComponent,setMapComponent]=useState<ComponentType<BthwaniMapProps>|null>(null);
 const [mapShown,setMapShown]=useState(false);
 const [manualLocation,setManualLocation]=useState(false);
 const mobile=width<720;
 const selected=useMemo<BthwaniMapCoordinate|null>(()=>{
  const a=Number(ascii(lat)),b=Number(ascii(lng));
  if(!lat.trim()||!lng.trim()||!Number.isFinite(a)||!Number.isFinite(b)||a < -90||a >90||b < -180||b >180)return null;
  return {latitude:a,longitude:b};
 },[lat,lng]);
 const scope=actor.kind==="authenticated"&&actor.identity.role==="partner"?actor.identity.subject+":"+actor.identity.sessionId:"";

 const load=useCallback(async()=>{
  setChecking(true);setError("");
  try{
   const session=currentIdentityState();
   if(session.kind!=="authenticated"){
    const restored=await restoreIdentitySession();
    if(restored.kind!=="authenticated"){router.replace("/" as Href);return;}
   }
   const token=await getUsableIdentityAccessToken();
   const page=await service().listPartnerAccessibleStores(token,1);
   if(page.stores.length>0){router.replace("/orders" as Href);return;}
   const [availableCities,availableVerticals]=await Promise.all([service().listActiveServiceCities(),service().listCatalogVerticals()]);
   setCities(availableCities);setVerticals(availableVerticals);
   if(availableCities.length===1)setCity(availableCities[0]!.id);
   if(availableVerticals.length===1)setVertical(availableVerticals[0]!.id);
  }catch(e){setError(errorText(e))}
  finally{setChecking(false)}
 },[router]);
 useEffect(()=>{
  const unsubscribe=subscribeIdentitySession(setActor);
  void load();
  return unsubscribe;
 },[load]);
 useEffect(()=>{
  if(!vertical){setTypes([]);setStoreType("");return;}
  let active=true;
  setStoreType("");
  void service().listCommercialStoreTypes(vertical).then(values=>{
   if(!active)return;
   setTypes(values.filter(x=>x.active&&x.verticalId===vertical));
   if(values.filter(x=>x.active&&x.verticalId===vertical).length===1)setStoreType(values.find(x=>x.active&&x.verticalId===vertical)!.id);
  }).catch(()=>{if(active)setError("تعذر تحميل أنواع المتاجر. أعد المحاولة.")});
  return ()=>{active=false};
 },[vertical]);
 useEffect(()=>{if(actor.kind==="signed_out"&&scope==="")return;},[actor,scope]);

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
  if(step===0&&name.trim().length<2){setError("أدخل اسم متجرك.");return;}
  if(step===1&&(!city||!vertical||!storeType||!types.some(t=>t.id===storeType&&t.verticalId===vertical))){setError("اختر مدينة الخدمة والمجال ونوع المتجر.");return;}
  if(step===2&&(!selected||address.trim().length<4||modes.length===0)){setError("حدد العنوان والموقع وطريقة التوصيل.");return;}
  setStep(Math.min(step+1,3) as Step);
 }
 async function save(){
  if(busy||!scope||!selected||!name.trim()||!city||!vertical||!storeType||address.trim().length<4||modes.length===0)return;
  setBusy(true);setError("");
  const starting=scope;
  try{
   const token=await getUsableIdentityAccessToken();
   const current=currentIdentityState();
   if(current.kind!=="authenticated"||current.identity.subject+":"+current.identity.sessionId!==starting)throw Error("SESSION_CHANGED");
   const result=await service().createPartnerFirstStore(token,{
    name:name.trim(),serviceCityId:city,primaryVerticalId:vertical,commercialStoreTypeId:storeType,
    addressText:address.trim(),latitude:selected.latitude,longitude:selected.longitude,fulfillmentModes:modes,
   });
   const after=currentIdentityState();
   if(after.kind!=="authenticated"||after.identity.subject+":"+after.identity.sessionId!==starting)return;
   const confirmed=await service().listPartnerAccessibleStores(token,25);
   if(!confirmed.stores.some(store=>store.id===result.storeId&&store.owned))throw Error("STORE_READBACK_MISMATCH");
   setSaved(result.storeId);
  }catch(e){setError(errorText(e))}
  finally{setBusy(false)}
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
   {checking?<ActivityIndicator accessibilityLabel="التحقق من المتجر"/>:null}
   {!checking&&!saved?<View style={{gap:15}}>
    <View style={s.steps}>
     {labels.map((label,index)=><View key={label} style={[s.step,index===step&&s.active]}><Text style={s.small}>{index<step?"✓ ":""}{label}</Text></View>)}
    </View>
    {step===0?<View style={{gap:10}}>
     <Text style={s.title}>هوية المتجر</Text>
     <Text style={s.small}>الاسم والبريد الشخصي ليسا شرطًا لإنشاء الحساب. ابدأ باسم متجرك فقط.</Text>
     <TextInput accessibilityLabel="اسم المتجر" value={name} onChangeText={setName} editable={!busy} placeholder="اكتب اسم المتجر" placeholderTextColor={theme.colorMuted} style={s.field}/>
    </View>:null}
    {step===1?<View style={{gap:8}}>
     {choose("مدينة الخدمة",cities.map(x=>({id:x.id,label:x.displayNameAr})),city,setCity)}
     {choose("المجال التجاري",verticals.filter(x=>x.active).map(x=>({id:x.id,label:x.nameAr})),vertical,setVertical)}
     {choose("نوع المتجر",types.map(x=>({id:x.id,label:x.nameAr})),storeType,setStoreType)}
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
     {([["BTHWANI_CAPTAIN","توصيل بثواني"],["PARTNER_CAPTAIN","مندوب المتجر"],["CUSTOMER_PICKUP","استلام من المتجر"]] as const).map(([id,label])=><Pressable key={id} accessibilityRole="checkbox" accessibilityState={{checked:modes.includes(id)}} disabled={busy} style={[s.option,modes.includes(id)&&s.chosen]} onPress={()=>setModes(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}><Text style={s.text}>{modes.includes(id)?"✓  ":""}{label}</Text></Pressable>)}
    </View>:null}
    {step===3?<View style={{gap:10}}>
     <Text style={s.title}>مراجعة المتجر</Text>
     <Text style={s.text}>المتجر: {name}</Text>
     <Text style={s.text}>المدينة: {cities.find(c=>c.id===city)?.displayNameAr}</Text>
     <Text style={s.text}>المجال: {verticals.find(v=>v.id===vertical)?.nameAr}</Text>
     <Text style={s.text}>النوع: {types.find(t=>t.id===storeType)?.nameAr}</Text>
     <Text style={s.text}>العنوان: {address}</Text>
     <Text style={s.small}>سينشأ المتجر غير منشور. بعد ذلك يمكنك تجهيز الصور والكتالوج والاتفاق التجاري قبل ظهوره للعملاء.</Text>
    </View>:null}
    {step<3?<BthwaniButton label="التالي" onPress={advance} disabled={busy}/>:<BthwaniButton label="إنشاء المتجر" onPress={()=>void save()} disabled={busy}/>}
    {step>0?<BthwaniButton label="السابق" variant="secondary" disabled={busy} onPress={()=>{setError("");setStep((step-1) as Step)}}/>:null}
   </View>:null}
   {saved?<View style={{gap:14}}>
    <Text style={s.title}>تم إنشاء متجرك</Text>
    <Text style={s.small}>المتجر محفوظ وغير منشور حاليًا. يمكنك الدخول إلى لوحة الإدارة وإكمال جاهزية النشر.</Text>
    <BthwaniButton label="فتح لوحة إدارة المتجر" onPress={()=>router.replace("/orders" as Href)}/>
   </View>:null}
   {error?<View style={{gap:8}}><Text accessibilityRole="alert" style={s.error}>{error}</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={()=>void load()}/></View>:null}
  </View>
 </ScrollView>;
}
