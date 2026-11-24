import { type CustomerAddress, type CustomerAddressChange, DshPublicError, isCustomerAddressId, validCustomerAddressChange } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ServiceCityScope from "../location/service-city-scope";
import { serviceCityLabel } from "../location/serviceability";
import { resolvePublicStoreOrigin } from "../stores/public-store-origin";
import AddressEditor from "./address-editor";
import { readVerifiedAddress, readVerifiedAddresses, verifyAddressSession, writeVerifiedAddress } from "./address-transport";

type Draft = { id:string; expectedVersion:number; cityId:string; label:string; details:string; latitude:string; longitude:string };
type ReadState = {actor:string;items:CustomerAddress[];next?:string|undefined};
type Pending = {actor:string;id:string;change:CustomerAddressChange};
const toDraft = (a:CustomerAddress):Draft => ({id:a.id,expectedVersion:a.version,cityId:a.cityId,label:a.label,details:a.details,
  latitude:String(a.latitude),longitude:String(a.longitude)});
const fresh = ():Draft => ({id:`addr-${randomUUID().replaceAll("-","")}`,expectedVersion:0,cityId:"",label:"",details:"",latitude:"",longitude:""});
function toChange(d:Draft):CustomerAddressChange {
  return {cityId:d.cityId,label:d.label.trim(),details:d.details.trim(),
    latitude:d.latitude.trim()?Number(d.latitude):NaN,longitude:d.longitude.trim()?Number(d.longitude):NaN,expectedVersion:d.expectedVersion};
}

export default function AddressesScreen() {
  const { theme }=useMobileAppearance();
  const {id}=useLocalSearchParams<{id?:string}>();
  const [view,setView]=useState<ReadState|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [message,setMessage]=useState("");
  const [retry,setRetry]=useState(0);
  const [busy,setBusy]=useState(false);
  const [map,setMap]=useState(false);
  const active=useRef<AbortController|null>(null);
  const scope=useRef<AbortController|null>(null);
  const expires=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const clear=useCallback(()=>{
    scope.current?.abort();scope.current=null;active.current?.abort();active.current=null;
    clearTimeout(expires.current);setView(null);setDraft(null);setPending(null);setMap(false);setBusy(false);
  },[]);
  const reload=useCallback(()=>{clear();setRetry(v=>v+1);},[clear]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately refreshes private owner state.
  useFocusEffect(useCallback(()=>{
    clear();setMessage("");
    const controller=new AbortController();
    scope.current=controller;
    void readVerifiedAddresses(controller.signal).then(async result=>{
      if(controller.signal.aborted)return;
      let selected=result.page.items.find(address=>address.id===id);
      let expiresAt=result.expiresAt;
      let unavailable=false;
      if(id!==undefined&&!selected){
        unavailable=typeof id!=="string"||!isCustomerAddressId(id);
        if(!unavailable){
          try{
            const lookup=await readVerifiedAddress(controller.signal,result.page.actorId,id);
            selected=lookup.address;
            expiresAt=Math.min(expiresAt,lookup.expiresAt);
          }catch(error){
            if(!(error instanceof DshPublicError)||error.status!==404)throw error;
            unavailable=true;
          }
        }
      }
      if(controller.signal.aborted)return;
      if(expiresAt<=Date.now())throw new DshPublicError(401,"UNAUTHORIZED");
      setView({actor:result.page.actorId,items:result.page.items,next:result.page.nextCursor});
      if(selected)setDraft(toDraft(selected));
      if(unavailable)setMessage("هذا العنوان غير متاح في حسابك.");
      expires.current=setTimeout(reload,Math.max(0,Math.min(2147483647,expiresAt-Date.now())));
    }).catch(()=>{
      if(!controller.signal.aborted)setMessage("تعذّر التحقق من عناوين حسابك. تحقق من الدخول والاتصال ثم أعد المحاولة.");
    });
    return clear;
  },[clear,reload,retry,id]));
  useEffect(()=>{
    if(Platform.OS==="web"){
      const visibility=()=>{if(document.visibilityState==="hidden")clear();else reload();};
      window.addEventListener("blur",clear);window.addEventListener("focus",reload);
      document.addEventListener("visibilitychange",visibility);
      return ()=>{window.removeEventListener("blur",clear);window.removeEventListener("focus",reload);document.removeEventListener("visibilitychange",visibility);};
    }
    const sub=AppState.addEventListener("change",state=>{if(state==="active")reload();else clear();});
    return ()=>sub.remove();
  },[clear,reload]);
  useEffect(()=>{
    if(!view)return;
    const controller=scope.current;
    if(!controller)return;
    let checking=false;
    const timer=setInterval(()=>{
      if(checking||active.current||controller.signal.aborted)return;
      checking=true;
      void verifyAddressSession(controller.signal,view.actor).catch(()=>{
        if(!controller.signal.aborted){clear();setMessage("تعذّر التحقق من الجلسة. أعد التحقق من الحساب.");}
      }).finally(()=>{checking=false;});
    },15000);
    return ()=>clearInterval(timer);
  },[view,clear]);
  const button={minHeight:44,borderWidth:1,borderColor:theme.borderColor,borderRadius:10,padding:12,justifyContent:"center" as const};
  const input={...button,color:theme.color,textAlign:"auto" as const};
  async function more() {
    if(!view?.next||active.current)return;
    const c=new AbortController();active.current=c;setBusy(true);
    try{
      const result=await readVerifiedAddresses(c.signal,view.actor,view.next);
      if(c.signal.aborted)return;
      setView(old=>old?.actor===view.actor&&old.next===view.next?{actor:old.actor,items:[...old.items,...result.page.items],next:result.page.nextCursor}:old);
    }catch{if(!c.signal.aborted){clear();setMessage("تعذّرت قراءة العناوين؛ أعد التحقق.");}}
    finally{if(active.current===c){active.current=null;setBusy(false);}}
  }
  async function save() {
    if(!view||!draft||active.current)return;
    const command=pending??{actor:view.actor,id:draft.id,change:toChange(draft)};
    if(command.actor!==view.actor||!validCustomerAddressChange(command.change)){setMessage("تحقق من المدينة واسم العنوان وتفاصيله والإحداثيات.");return;}
    const c=new AbortController();active.current=c;setBusy(true);setPending(command);setMessage("");
    try{
      await writeVerifiedAddress(command.actor,command.id,command.change,c.signal);
      if(c.signal.aborted)return;
      reload();
    }catch(e){
      if(c.signal.aborted)return;
      if(e instanceof DshPublicError&&[400,404,409].includes(e.status)){
        setPending(null);setMessage(e.status===409?"تغيّر العنوان لدى DSH. أعد قراءة العناوين قبل تعديل جديد.":"رفض DSH البيانات أو المدينة المختارة.");
        if(e.status===409){setDraft(null);setView(null);}
      }else {
        try{
          await verifyAddressSession(c.signal,command.actor);
          if(!c.signal.aborted)setMessage("لم تتأكد نتيجة الحفظ. أعد إرسال نفس العملية أو أعد قراءة العناوين للتحقق.");
        }catch{if(!c.signal.aborted){clear();setMessage("لم تتأكد نتيجة الحفظ. أعد التحقق من الحساب ثم اقرأ العناوين.");}}
      }
    }finally{if(active.current===c){active.current=null;setBusy(false);}}
  }
  const field=(name:keyof Pick<Draft,"label"|"details"|"latitude"|"longitude">,label:string,limit:number)=>
    draft?<TextInput key={name} accessibilityLabel={label} placeholder={label} placeholderTextColor={theme.colorSecondary}
      value={draft[name]} maxLength={limit} editable={!busy&&!pending} onChangeText={value=>setDraft(old=>old?{...old,[name]:value}:null)}
      style={input}/>:null;
  return <SafeAreaView style={{flex:1,backgroundColor:theme.background}}>
    <ScrollView contentContainerStyle={{padding:16,gap:12,maxWidth:720,width:"100%",alignSelf:"center"}}>
      <Text accessibilityRole="header" style={{fontSize:25,fontWeight:"700",color:theme.color}}>عناويني</Text>
      <Text style={{color:theme.colorSecondary}}>عناوينك الخاصة محفوظة لدى DSH. حفظ الموقع لا يعني أنه مؤهل للتوصيل.</Text>
      <Pressable accessibilityRole="button" onPress={reload} style={button}><Text style={{color:theme.interactiveText}}>تحديث العناوين</Text></Pressable>
      {message?<Text accessibilityRole="alert" style={{color:theme.warningText}}>{message}</Text>:null}
      {!view?<Link href={{ pathname: "/login", params: { returnTo: "/addresses" } }} style={{color:theme.interactiveText}}>التحقق من الحساب</Link>:<>
        {view.items.length===0?<Text style={{color:theme.color}}>لا توجد عناوين مسجلة.</Text>:view.items.map(a=><Pressable key={a.id} accessibilityRole="button"
          disabled={busy||!!pending} style={button} onPress={()=>{setDraft(toDraft(a));setMap(false);}}>
          <Text style={{color:theme.color,fontWeight:"700"}}>{a.label}</Text><Text style={{color:theme.colorSecondary}}>{serviceCityLabel(a.cityId)} · {a.details}</Text>
        </Pressable>)}
        {view.next?<Pressable accessibilityRole="button" disabled={busy||!!pending} style={button} onPress={()=>void more()}><Text style={{color:theme.interactiveText}}>المزيد من العناوين</Text></Pressable>:null}
        <Pressable accessibilityRole="button" disabled={busy||!!pending} style={button} onPress={()=>{setDraft(fresh());setMap(false);}}><Text style={{color:theme.interactiveText}}>إضافة عنوان</Text></Pressable>
        {draft?<View key={draft.id} style={{gap:10}}>
          <Text style={{color:theme.color,fontWeight:"700"}}>{draft.expectedVersion?"تعديل العنوان":"عنوان جديد"}</Text>
          <Text style={{color:theme.color}}>مدينة الخدمة</Text>
          {draft.cityId?<Text style={{color:theme.colorSecondary}}>المدينة المختارة: {serviceCityLabel(draft.cityId)}</Text>:null}
          <ServiceCityScope origin={resolvePublicStoreOrigin()} currentCity={draft.cityId} disabled={busy||!!pending}
            onApply={city=>setDraft(old=>old?{...old,cityId:city}:null)}/>
          {field("label","اسم العنوان",80)}{field("details","تفاصيل الوصول",300)}
          {field("latitude","خط العرض",24)}{field("longitude","خط الطول",24)}
          {!pending?<Pressable testID="address-location-open" accessibilityRole="button" accessibilityState={{expanded:map}} disabled={busy} style={button} onPress={()=>setMap(v=>!v)}><Text style={{color:theme.interactiveText}}>{map?"إغلاق محدد الموقع":Platform.OS==="web"?"تحديد الموقع الحالي":"اختيار الموقع على الخريطة"}</Text></Pressable>:null}
          {map&&!pending?<View style={Platform.OS==="web"?undefined:{height:460}}><AddressEditor onSelect={pin=>{setDraft(old=>old?{...old,latitude:String(pin.latitude),longitude:String(pin.longitude)}:null);setMap(false);}}/></View>:null}
          <Pressable accessibilityRole="button" disabled={busy||!validCustomerAddressChange(toChange(draft))} style={button} onPress={()=>void save()}>
            <Text style={{color:theme.interactiveText}}>{busy?"جارٍ التحقق…":pending?"إعادة نفس الحفظ":"حفظ لدى DSH"}</Text>
          </Pressable>
        </View>:null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
