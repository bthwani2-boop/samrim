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
type Retained = {actor:string;routeId:string|undefined;draft:Draft;pending:Pending|null};
function committed(address:CustomerAddress,command:Pending):boolean {
  const c=command.change;
  return address.id===command.id&&address.version===c.expectedVersion+1&&address.cityId===c.cityId&&address.label===c.label&&address.details===c.details&&address.latitude===c.latitude&&address.longitude===c.longitude;
}
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
  const retained=useRef<Retained|null>(null);
  const discardOnDenial=useCallback((error:unknown)=>{
    if(error instanceof DshPublicError&&[401,403].includes(error.status))retained.current=null;
  },[]);
  const clear=useCallback(()=>{
    scope.current?.abort();scope.current=null;active.current?.abort();active.current=null;
    clearTimeout(expires.current);setView(null);setDraft(null);setPending(null);setMap(false);setBusy(false);
  },[]);
  const reload=useCallback(()=>{clear();setRetry(v=>v+1);},[clear]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately refreshes private owner state.
  useFocusEffect(useCallback(()=>{
    clear();setMessage("");
    if(retained.current?.routeId!==id)retained.current=null;
    const controller=new AbortController();
    scope.current=controller;
    void readVerifiedAddresses(controller.signal).then(async result=>{
      if(controller.signal.aborted)return;
      if(retained.current&&retained.current.actor!==result.page.actorId)retained.current=null;
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
      const saved=retained.current;
      if(saved){
        let owner=result.page.items.find(address=>address.id===saved.draft.id);
        if(!owner){
          try{
            const lookup=await readVerifiedAddress(controller.signal,result.page.actorId,saved.draft.id);
            owner=lookup.address;expiresAt=Math.min(expiresAt,lookup.expiresAt);
          }catch(error){if(!(error instanceof DshPublicError)||error.status!==404)throw error;}
        }
        if(controller.signal.aborted)return;
        if(expiresAt<=Date.now())throw new DshPublicError(503,"OWNER_UNAVAILABLE");
        if(saved.pending&&owner&&committed(owner,saved.pending)){
          retained.current=null;setMessage("تم التحقق من حفظ العنوان لدى DSH.");
          if(id===owner.id)selected=owner;
        }else if(owner?owner.version===saved.draft.expectedVersion:saved.draft.expectedVersion===0){
          setDraft(saved.draft);setPending(saved.pending);
        }else{
          retained.current=null;setMessage("تغيّر العنوان لدى DSH؛ أعد إدخال التعديلات على النسخة الحالية.");
        }
      }
      if(expiresAt<=Date.now())throw new DshPublicError(503,"OWNER_UNAVAILABLE");
      setView({actor:result.page.actorId,items:result.page.items,next:result.page.nextCursor});
      if(!retained.current&&selected)setDraft(toDraft(selected));
      if(unavailable)setMessage("هذا العنوان غير متاح في حسابك.");
      expires.current=setTimeout(reload,Math.max(0,Math.min(2147483647,expiresAt-Date.now())));
    }).catch(error=>{
      if(!controller.signal.aborted){discardOnDenial(error);setMessage("تعذّر التحقق من عناوين حسابك. تحقق من الدخول والاتصال ثم أعد المحاولة.");}
    });
    return clear;
  },[clear,reload,retry,id,discardOnDenial]));
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
      void verifyAddressSession(controller.signal,view.actor).catch(error=>{
        if(!controller.signal.aborted){discardOnDenial(error);clear();setMessage("تعذّر التحقق من الجلسة. أعد التحقق من الحساب.");}
      }).finally(()=>{checking=false;});
    },15000);
    return ()=>clearInterval(timer);
  },[view,clear,discardOnDenial]);
  function updateDraft(update:(old:Draft|null)=>Draft|null){
    if(!view||!scope.current||scope.current.signal.aborted||active.current||pending)return;
    const previous=retained.current?.actor===view.actor&&retained.current.routeId===id?retained.current.draft:draft;
    const next=update(previous);
    retained.current=next?{actor:view.actor,routeId:id,draft:next,pending:null}:null;
    setDraft(next);
  }
  const button={minHeight:44,borderWidth:1,borderColor:theme.borderColor,borderRadius:10,padding:12,justifyContent:"center" as const};
  const input={...button,color:theme.color,textAlign:"auto" as const};
  async function more() {
    if(!view?.next||active.current)return;
    const c=new AbortController();active.current=c;setBusy(true);
    try{
      const result=await readVerifiedAddresses(c.signal,view.actor,view.next);
      if(c.signal.aborted)return;
      setView(old=>old?.actor===view.actor&&old.next===view.next?{actor:old.actor,items:[...old.items,...result.page.items],next:result.page.nextCursor}:old);
    }catch(error){if(!c.signal.aborted){discardOnDenial(error);clear();setMessage("تعذّرت قراءة العناوين؛ أعد التحقق.");}}
    finally{if(active.current===c){active.current=null;setBusy(false);}}
  }
  async function save() {
    if(!view||!draft||active.current)return;
    const command=pending??{actor:view.actor,id:draft.id,change:toChange(draft)};
    if(command.actor!==view.actor||!validCustomerAddressChange(command.change)){setMessage("تحقق من المدينة واسم العنوان وتفاصيله والإحداثيات.");return;}
    retained.current={actor:view.actor,routeId:id,draft,pending:command};
    const c=new AbortController();active.current=c;setBusy(true);setPending(command);setMessage("");
    try{
      await writeVerifiedAddress(command.actor,command.id,command.change,c.signal);
      if(c.signal.aborted)return;
      retained.current=null;reload();
    }catch(e){
      if(c.signal.aborted)return;
      if(e instanceof DshPublicError&&[400,404,409].includes(e.status)){
        setPending(null);setMessage(e.status===409?"تغيّر العنوان لدى DSH. أعد قراءة العناوين قبل تعديل جديد.":"رفض DSH البيانات أو المدينة المختارة.");
        if(e.status===409){retained.current=null;clear();}
        else retained.current={actor:view.actor,routeId:id,draft,pending:null};
      }else {
        try{
          await verifyAddressSession(c.signal,command.actor);
          if(!c.signal.aborted)setMessage("لم تتأكد نتيجة الحفظ. أعد إرسال نفس العملية أو أعد قراءة العناوين للتحقق.");
        }catch(error){if(!c.signal.aborted){discardOnDenial(error);clear();setMessage("لم تتأكد نتيجة الحفظ. أعد التحقق من الحساب ثم اقرأ العناوين.");}}
      }
    }finally{if(active.current===c){active.current=null;setBusy(false);}}
  }
  const field=(name:keyof Pick<Draft,"label"|"details"|"latitude"|"longitude">,label:string,limit:number)=>
    draft?<TextInput key={name} accessibilityLabel={label} placeholder={label} placeholderTextColor={theme.colorSecondary}
      value={draft[name]} maxLength={limit} editable={!busy&&!pending} onChangeText={value=>updateDraft(old=>old?{...old,[name]:value}:null)}
      style={input}/>:null;
  return <SafeAreaView style={{flex:1,backgroundColor:theme.background}}>
    <ScrollView contentContainerStyle={{padding:16,gap:12,maxWidth:720,width:"100%",alignSelf:"center"}}>
      <Text accessibilityRole="header" style={{fontSize:25,fontWeight:"700",color:theme.color}}>عناويني</Text>
      <Text style={{color:theme.colorSecondary}}>عناوينك الخاصة محفوظة لدى DSH. حفظ الموقع لا يعني أنه مؤهل للتوصيل.</Text>
      <Pressable accessibilityRole="button" onPress={reload} style={button}><Text style={{color:theme.interactiveText}}>تحديث العناوين</Text></Pressable>
      {message?<Text accessibilityRole="alert" style={{color:theme.warningText}}>{message}</Text>:null}
      {!view?<Link href={{ pathname: "/login", params: { returnTo: "/addresses" } }} style={{color:theme.interactiveText}}>التحقق من الحساب</Link>:<>
        {view.items.length===0?<Text style={{color:theme.color}}>لا توجد عناوين مسجلة.</Text>:view.items.map(a=><Pressable key={a.id} accessibilityRole="button"
          disabled={busy||!!pending} style={button} onPress={()=>{updateDraft(()=>toDraft(a));setMap(false);}}>
          <Text style={{color:theme.color,fontWeight:"700"}}>{a.label}</Text><Text style={{color:theme.colorSecondary}}>{serviceCityLabel(a.cityId)} · {a.details}</Text>
        </Pressable>)}
        {view.next?<Pressable accessibilityRole="button" disabled={busy||!!pending} style={button} onPress={()=>void more()}><Text style={{color:theme.interactiveText}}>المزيد من العناوين</Text></Pressable>:null}
        <Pressable accessibilityRole="button" disabled={busy||!!pending} style={button} onPress={()=>{updateDraft(()=>fresh());setMap(false);}}><Text style={{color:theme.interactiveText}}>إضافة عنوان</Text></Pressable>
        {draft?<View key={draft.id} style={{gap:10}}>
          <Text style={{color:theme.color,fontWeight:"700"}}>{draft.expectedVersion?"تعديل العنوان":"عنوان جديد"}</Text>
          <Text style={{color:theme.color}}>مدينة الخدمة</Text>
          {draft.cityId?<Text style={{color:theme.colorSecondary}}>المدينة المختارة: {serviceCityLabel(draft.cityId)}</Text>:null}
          <ServiceCityScope origin={resolvePublicStoreOrigin()} currentCity={draft.cityId} disabled={busy||!!pending}
            onApply={city=>updateDraft(old=>old?{...old,cityId:city}:null)}/>
          {field("label","اسم العنوان",80)}{field("details","تفاصيل الوصول",300)}
          {field("latitude","خط العرض",24)}{field("longitude","خط الطول",24)}
          {!pending?<Pressable testID="address-location-open" accessibilityRole="button" accessibilityState={{expanded:map}} disabled={busy} style={button} onPress={()=>setMap(v=>!v)}><Text style={{color:theme.interactiveText}}>{map?"إغلاق محدد الموقع":Platform.OS==="web"?"تحديد الموقع الحالي":"اختيار الموقع على الخريطة"}</Text></Pressable>:null}
          {map&&!pending?<View style={Platform.OS==="web"?undefined:{height:460}}><AddressEditor onSelect={pin=>{updateDraft(old=>old?{...old,latitude:String(pin.latitude),longitude:String(pin.longitude)}:null);setMap(false);}}/></View>:null}
          <Pressable accessibilityRole="button" disabled={busy||!validCustomerAddressChange(toChange(draft))} style={button} onPress={()=>void save()}>
            <Text style={{color:theme.interactiveText}}>{busy?"جارٍ التحقق…":pending?"إعادة نفس الحفظ":"حفظ لدى DSH"}</Text>
          </Pressable>
        </View>:null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
