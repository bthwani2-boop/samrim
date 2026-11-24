import type { CustomerAddress, DeliveryServiceability } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { readVerifiedAddresses, readVerifiedDeliveryServiceability, verifyAddressSession } from "../addresses/address-transport";

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
  const clear=useCallback(()=>{
    scope.current?.abort();scope.current=null;request.current?.abort();request.current=null;
    clearTimeout(expiry.current);setPage(null);setSelection(null);setResult(null);setBusy(false);setError(false);
  },[]);
  const reload=useCallback(()=>{clear();setRetry(v=>v+1);},[clear]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry requests a new owner snapshot.
  useFocusEffect(useCallback(()=>{
    clear();
    const controller=new AbortController();scope.current=controller;
    void readVerifiedAddresses(controller.signal,actorId).then(value=>{
      if(controller.signal.aborted)return;
      setPage({items:value.page.items,next:value.page.nextCursor});
      expiry.current=setTimeout(clear,Math.max(0,Math.min(2147483647,value.expiresAt-Date.now())));
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    const timer=setInterval(()=>{
      if(controller.signal.aborted)return;
      void verifyAddressSession(controller.signal,actorId).catch(()=>{
        if(!controller.signal.aborted){clear();setError(true);}
      });
    },15000);
    return ()=>{clearInterval(timer);clear();};
  },[actorId,clear,retry]));
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
    if(!scope.current||scope.current.signal.aborted)return;
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setSelection(address);setResult(null);setError(false);setBusy(true);
    try {
      const value=await readVerifiedDeliveryServiceability(actorId,storeId,address.id,controller.signal);
      if(controller.signal.aborted||request.current!==controller)return;
      if(value.evidence&&value.evidence.addressVersion!==address.version){clear();setError(true);return;}
      setResult(value);
    }catch{if(!controller.signal.aborted&&request.current===controller){clear();setError(true);}}
    finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  async function more(){
    if(!page?.next||!scope.current||request.current)return;
    const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const value=await readVerifiedAddresses(controller.signal,actorId,page.next);
      if(!controller.signal.aborted&&request.current===controller){
        setPage({items:[...page.items,...value.page.items],next:value.page.nextCursor});
      }
    }catch{if(!controller.signal.aborted){clear();setError(true);}}
    finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  const action={minHeight:44,padding:10,borderWidth:1,borderColor:theme.borderColor,borderRadius:8,justifyContent:"center" as const};
  const current=result?.addressId===selection?.id&&result?.actorId===actorId&&result?.storeId===storeId?result:null;
  return <View testID="checkout-address-review" style={{gap:8}}>
    <Text style={{color:theme.color,fontWeight:"700"}}>عنوان التوصيل — التحقق الجغرافي</Text>
    <Link href="/addresses" style={{color:theme.interactiveText}}>إدارة عناويني</Link>
    {error?<Text accessibilityRole="alert" style={{color:theme.warningText}}>تعذّر التحقق من العنوان. أعد قراءة العناوين.</Text>:null}
    {!page&&!error?<Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ قراءة العناوين الخاصة من DSH.</Text>:null}
    {page?.items.length===0?<Text style={{color:theme.colorSecondary}}>لا توجد عناوين مسجلة.</Text>:null}
    {page?.items.map(address=><Pressable key={address.id} accessibilityRole="button" accessibilityState={{selected:selection?.id===address.id}}
      onPress={()=>void select(address)} style={{...action,backgroundColor:selection?.id===address.id?theme.actionSoft:theme.surface}}>
      <Text style={{color:theme.color}}>{address.label} · {address.cityId}</Text>
    </Pressable>)}
    {page?.next?<Pressable accessibilityRole="button" disabled={busy} style={action} onPress={()=>void more()}><Text style={{color:theme.interactiveText}}>المزيد من العناوين</Text></Pressable>:null}
    {busy&&selection?<Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ التحقق الجغرافي لدى DSH.</Text>:null}
    {current?<Text testID="checkout-address-serviceability" accessibilityLiveRegion="polite" style={{color:current.status==="SERVICEABLE"?theme.color:theme.warningText}}>
      {current.status==="SERVICEABLE"?"العنوان ضمن النطاق الجغرافي وفق السياسة الحالية.":current.status==="UNSERVICEABLE"?"العنوان خارج نطاق الخدمة الحالي.":"لا تتوفر أدلة كافية لاعتماد نطاق الخدمة."}
    </Text>:null}
    <Pressable accessibilityRole="button" style={action} onPress={reload}><Text style={{color:theme.interactiveText}}>إعادة التحقق من العناوين</Text></Pressable>
    <Text style={{color:theme.colorSecondary}}>هذا التقييم لا يعتمد طريقة التوصيل أو رسومها أو تأكيد الطلب، ويعاد التحقق عند التأكيد.</Text>
  </View>;
}
