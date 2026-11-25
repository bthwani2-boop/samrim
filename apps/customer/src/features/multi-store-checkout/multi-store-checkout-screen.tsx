import { type CustomerCartDirectory, DshPublicError } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { readVerifiedCartDirectory, verifyCartDirectorySession } from "../cart/cart-directory-transport";

type Ready={page:CustomerCartDirectory;expiresAt:number;after?:string};
type State={kind:"loading"|"hidden"|"signed-out"|"unavailable"}|{kind:"ready";data:Ready};

export default function MultiStoreCheckoutScreen(){
  const {theme}=useMobileAppearance();
  const [state,setState]=useState<State>({kind:"loading"});
  const current=useRef<State>({kind:"loading"});
  const scope=useRef<AbortController|null>(null);
  const focused=useRef(false);
  const publish=useCallback((next:State)=>{current.current=next;setState(next);},[]);
  const clear=useCallback(()=>{
    scope.current?.abort();scope.current=null;publish({kind:"hidden"});
  },[publish]);
  const load=useCallback((after?:string,actor?:string)=>{
    if(!focused.current||(Platform.OS==="web"?document.visibilityState==="hidden":AppState.currentState!=="active"))return;
    scope.current?.abort();
    const controller=new AbortController();scope.current=controller;
    publish({kind:"loading"});
    const signal=controller.signal;
    const deadline=setTimeout(()=>{
      if(scope.current===controller&&!signal.aborted){controller.abort();publish({kind:"unavailable"});}
    },12000);
    void readVerifiedCartDirectory(signal,after,actor).then(result=>{
      if(scope.current!==controller||controller.signal.aborted)return;
      if(signal.aborted||result.expiresAt<=Date.now()){publish({kind:"unavailable"});return;}
      publish({kind:"ready",data:{page:result.value,expiresAt:result.expiresAt,...(after?{after}:{})}});
    }).catch(error=>{
      if(scope.current===controller&&!controller.signal.aborted)
        publish({kind:error instanceof DshPublicError&&error.status===401?"signed-out":"unavailable"});
    }).finally(()=>clearTimeout(deadline));
  },[publish]);
  useFocusEffect(useCallback(()=>{
    focused.current=true;load();
    return ()=>{focused.current=false;clear();};
  },[clear,load]));
  useEffect(()=>{
    const resume=()=>{if(focused.current)load();};
    if(Platform.OS==="web"){
      const visibility=()=>{if(document.visibilityState==="hidden")clear();else resume();};
      window.addEventListener("blur",clear);window.addEventListener("focus",resume);
      document.addEventListener("visibilitychange",visibility);
      return ()=>{window.removeEventListener("blur",clear);window.removeEventListener("focus",resume);document.removeEventListener("visibilitychange",visibility);};
    }
    const listener=AppState.addEventListener("change",value=>{if(value==="active")resume();else clear();});
    return ()=>listener.remove();
  },[clear,load]);
  useEffect(()=>{
    if(state.kind!=="ready")return;
    const controller=scope.current;
    if(!controller)return;
    const hide=()=>{if(scope.current===controller){clear();publish({kind:"signed-out"});}};
    const expiry=setTimeout(hide,Math.max(0,Math.min(2147483647,state.data.expiresAt-Date.now())));
    let checking=false;
    const check=setInterval(()=>{
      if(checking||controller.signal.aborted)return;
      checking=true;
      const deadline=setTimeout(hide,5000);
      void verifyCartDirectorySession(controller.signal,state.data.page.actorId).catch(hide).finally(()=>{clearTimeout(deadline);checking=false;});
    },15000);
    return ()=>{clearTimeout(expiry);clearInterval(check);};
  },[state,clear,publish]);
  const button={minHeight:44,padding:12,borderRadius:10,backgroundColor:theme.actionSoft,justifyContent:"center" as const};
  const next=()=>{
    if(state.kind==="ready"&&current.current===state&&scope.current&&!scope.current.signal.aborted&&state.data.expiresAt>Date.now()&&state.data.page.nextCursor)
      load(state.data.page.nextCursor,state.data.page.actorId);
  };
  return <SafeAreaView style={{flex:1,backgroundColor:theme.background}}>
    <ScrollView contentContainerStyle={{gap:16,padding:20,maxWidth:720,width:"100%",alignSelf:"center"}}>
      <Text accessibilityRole="header" style={{color:theme.color,fontSize:26,fontWeight:"700"}}>سلال التسوق المحفوظة</Text>
      <Text style={{color:theme.colorSecondary}}>راجع سلة كل متجر على حدة.</Text>
      {state.kind==="ready"?<>
        {state.data.page.carts.length===0?<Text accessibilityLiveRegion="polite" style={{color:theme.color}}>لا توجد سلال محفوظة في هذه الصفحة.</Text>:null}
        {state.data.page.carts.map(cart=><View key={cart.storeId} style={{backgroundColor:theme.surface,borderColor:theme.borderColor,borderWidth:1,borderRadius:12,padding:14,gap:8}}>
          <Text accessibilityRole="header" style={{color:theme.color,fontSize:18,fontWeight:"700"}}>{cart.storeName||"متجر غير متاح"}</Text>
          <Text style={{color:theme.colorSecondary}}>عدد الأصناف: {cart.lineCount}</Text>
          <Link href={{pathname:"/cart/[storeId]",params:{storeId:cart.storeId}}} asChild><Pressable accessibilityRole="link" style={button}>
            <Text style={{color:theme.interactiveText}}>مراجعة سلة المتجر</Text>
          </Pressable></Link>
        </View>)}
        {state.data.page.nextCursor?<Pressable accessibilityRole="button" onPress={next} style={button}><Text style={{color:theme.interactiveText}}>المزيد من السلال</Text></Pressable>:null}
        {state.data.after?<Pressable accessibilityRole="button" onPress={()=>load()} style={button}><Text style={{color:theme.interactiveText}}>العودة إلى البداية</Text></Pressable>:null}
      </>:state.kind==="signed-out"?<Link href="/login" style={{color:theme.interactiveText}}>سجّل الدخول لعرض سلالك</Link>:
        state.kind==="unavailable"?<><Text accessibilityRole="alert" style={{color:theme.color}}>تعذر التحقق من السلال.</Text>
          <Pressable accessibilityRole="button" onPress={()=>load()} style={button}><Text style={{color:theme.interactiveText}}>إعادة المحاولة</Text></Pressable></>:
          <Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ التحقق من السلال.</Text>}
      <Text testID="checkout-confirmation-unavailable" style={{color:theme.colorSecondary}}>تأكيد الطلب من عدة متاجر والدفع الموحّد غير متاحين حاليًا.</Text>
      <Link href="/stores" style={{color:theme.interactiveText}}>متابعة تصفح المتاجر</Link>
    </ScrollView>
  </SafeAreaView>;
}