import type { CustomerAddress, DeliveryServiceability } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { readVerifiedAddresses, readVerifiedDeliveryServiceability, verifyAddressSession } from "../addresses/address-transport";
import { serviceCityLabel } from "../location/serviceability";

type Page = {items:CustomerAddress[];next:string|undefined};
export default function DeliveryAddressReview({actorId,storeId}:Readonly<{actorId:string;storeId:string}>) {
  const {theme}=useMobileAppearance();
  const [page,setPage]=useState<Page|null>(null);
  const [selection,setSelection]=useState<CustomerAddress|null>(null);
  const [result,setResult]=useState<DeliveryServiceability|null>(null);
  const [error,setError]=useState(false);
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(0);
  const scope=useRef<AbortController|null>(null);
  const request=useRef<AbortController|null>(null);
  const expiry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const expiresAt=useRef<number|undefined>(undefined);
  const clear=useCallback(()=>{
    scope.current?.abort();scope.current=null;request.current?.abort();request.current=null;
    clearTimeout(expiry.current);expiry.current=undefined;expiresAt.current=undefined;
    setPage(null);setSelection(null);setResult(null);setBusy(false);setError(false);
  },[]);
  const acceptExpiry=useCallback((deadline:number)=>{
    const limit=Math.min(expiresAt.current??deadline,deadline);
    if(!Number.isFinite(limit)||limit<=Date.now()){clear();setError(true);return false;}
    expiresAt.current=limit;
    clearTimeout(expiry.current);
    expiry.current=setTimeout(()=>{clear();setError(true);},Math.min(2147483647,limit-Date.now()));
    return true;
  },[clear]);
  const reload=useCallback(()=>{clear();setRetry(v=>v+1);},[clear]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry requests a new owner snapshot.
  useFocusEffect(useCallback(()=>{
    clear();
    const controller=new AbortController();scope.current=controller;
    void readVerifiedAddresses(controller.signal,actorId).then(value=>{
      if(controller.signal.aborted)return;
      if(value.page.actorId!==actorId){clear();setError(true);return;}
      if(!acceptExpiry(value.expiresAt))return;
      setPage({items:value.page.items,next:value.page.nextCursor});
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    const timer=setInterval(()=>{
      if(controller.signal.aborted)return;
      void verifyAddressSession(controller.signal,actorId).catch(()=>{
        if(!controller.signal.aborted){clear();setError(true);}
      });
    },15000);
    return ()=>{clearInterval(timer);clear();};
  },[actorId,storeId,acceptExpiry,clear,retry]));
  useEffect(()=>{
    if(Platform.OS==="web"){
      const visibility=()=>{if(document.visibilityState==="hidden")clear();else reload();};
      window.addEventListener("blur",clear);window.addEventListener("focus",reload);
      document.addEventListener("visibilitychange",visibility);
      return ()=>{window.removeEventListener("blur",clear);window.removeEventListener("focus",reload);document.removeEventListener("visibilitychange",visibility);};
    }
    const listener=AppState.addEventListener("change",state=>{if(state==="active")reload();else clear();});
    return ()=>listener.remove();
  },[clear,reload]);
  async function select(address:CustomerAddress){
    if(!scope.current||scope.current.signal.aborted||expiresAt.current===undefined)return;
    if(expiresAt.current<=Date.now()){clear();setError(true);return;}
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setSelection(address);setResult(null);setError(false);setBusy(true);
    try {
      const value=await readVerifiedDeliveryServiceability(actorId,storeId,address.id,controller.signal);
      if(controller.signal.aborted||request.current!==controller)return;
      if(expiresAt.current===undefined||expiresAt.current<=Date.now()||
        value.actorId!==actorId||value.storeId!==storeId||value.addressId!==address.id||
        (value.evidence&&(value.evidence.addressVersion!==address.version||value.evidence.addressCityId!==address.cityId))){clear();setError(true);return;}
      setResult(value);
    }catch{if(!controller.signal.aborted&&request.current===controller){clear();setError(true);}}
    finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  async function more(){
    if(!page?.next||!scope.current||request.current||expiresAt.current===undefined)return;
    if(expiresAt.current<=Date.now()){clear();setError(true);return;}
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const value=await readVerifiedAddresses(controller.signal,actorId,page.next);
      if(!controller.signal.aborted&&request.current===controller){
        if(value.page.actorId!==actorId){clear();setError(true);return;}
        if(!acceptExpiry(value.expiresAt))return;
        setPage({items:[...page.items,...value.page.items],next:value.page.nextCursor});
      }
    }catch{if(!controller.signal.aborted){clear();setError(true);}}
    finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  const action={minHeight:44,padding:10,borderWidth:1,borderColor:theme.borderColor,borderRadius:8,justifyContent:"center" as const};
  const current=result?.addressId===selection?.id&&result?.actorId===actorId&&result?.storeId===storeId?result:null;
  const evidence=current?.evidence;
  const metres=new Intl.NumberFormat("ar-YE",{maximumFractionDigits:2});
  return <View testID="checkout-address-review" style={{gap:8}}>
    <Text style={{color:theme.color,fontWeight:"700"}}>عنوان التوصيل — التحقق الجغرافي</Text>
    <Link href="/addresses" style={{color:theme.interactiveText}}>إدارة عناويني</Link>
    {error?<Text accessibilityRole="alert" style={{color:theme.warningText}}>تعذّر التحقق من العنوان. أعد قراءة العناوين.</Text>:null}
    {!page&&!error?<Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ قراءة العناوين الخاصة من DSH.</Text>:null}
    {page?.items.length===0?<Text style={{color:theme.colorSecondary}}>لا توجد عناوين مسجلة.</Text>:null}
    {page?.items.map(address=><Pressable key={address.id} accessibilityRole="button" accessibilityState={{selected:selection?.id===address.id}}
      onPress={()=>void select(address)} style={{...action,backgroundColor:selection?.id===address.id?theme.actionSoft:theme.surface}}>
      <Text style={{color:theme.color}}>{address.label} · {serviceCityLabel(address.cityId)}</Text>
    </Pressable>)}
    {page?.next?<Pressable accessibilityRole="button" disabled={busy} style={action} onPress={()=>void more()}><Text style={{color:theme.interactiveText}}>المزيد من العناوين</Text></Pressable>:null}
    {busy&&selection?<Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ التحقق الجغرافي لدى DSH.</Text>:null}
    {current?<Text testID="checkout-address-serviceability" accessibilityLiveRegion="polite" style={{color:current.status==="SERVICEABLE"?theme.color:theme.warningText}}>
      {current.status==="SERVICEABLE"?"العنوان ضمن النطاق الجغرافي وفق السياسة الحالية.":current.status==="UNSERVICEABLE"
        ?evidence&&evidence.storeCityId!==evidence.addressCityId?"مدينة المتجر تختلف عن مدينة عنوان التوصيل.":"المسافة الجغرافية تتجاوز نطاق المدينة الحالي."
        :"لا تتوفر أدلة كافية لاعتماد نطاق الخدمة."}
    </Text>:null}
    {current&&selection?<Link href={{pathname:"/addresses/[id]",params:{id:selection.id}}}
      style={{color:theme.interactiveText}}>تعديل العنوان المحدد</Link>:null}
    {evidence?<View testID="checkout-address-evidence" style={{gap:4}}>
      <Text style={{color:theme.colorSecondary}}>مدينة المتجر: {serviceCityLabel(evidence.storeCityId)} · مدينة العنوان: {serviceCityLabel(evidence.addressCityId)}</Text>
      <Text style={{color:theme.colorSecondary}}>المسافة الجغرافية التقريبية: {metres.format(evidence.distanceMetres)} متر</Text>
      <Text style={{color:theme.colorSecondary}}>نطاق المدينة: {metres.format(evidence.radiusMetres)} متر</Text>
      <Text style={{color:theme.colorSecondary}}>نسخة السياسة: {evidence.policyVersion}</Text>
    </View>:null}
    <Pressable accessibilityRole="button" style={action} onPress={reload}><Text style={{color:theme.interactiveText}}>إعادة التحقق من العناوين</Text></Pressable>
    <Text style={{color:theme.colorSecondary}}>هذا التقييم لا يعتمد طريقة التوصيل أو رسومها أو تأكيد الطلب، ويعاد التحقق عند التأكيد.</Text>
  </View>;
}
