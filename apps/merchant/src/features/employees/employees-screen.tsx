import { type EmployeeRecord, type EmployeeRegistration, validEmployeeRegistration } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useLayoutEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import MerchantCapabilityScreen from "../../components/merchant-capability-screen";
import { type PendingMerchantRegistration, parsePendingMerchantRegistration } from "../onboarding/merchant-registration-attempt";
import { readEmployeeDetail, readEmployees, saveEmployee } from "./employee-transport";

const secureOptions={keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY};
const digest=(value:string)=>digestStringAsync(CryptoDigestAlgorithm.SHA256,value);
const emptyDraft={displayName:"",department:"",jobTitle:"",startDate:""};
type Recovery={key:string;attempt:PendingMerchantRegistration|null};

async function storedAttempt(key:string) {
  const raw=Platform.OS==="web"?window.localStorage.getItem(key):await SecureStore.getItemAsync(key,secureOptions);
  const record=parsePendingMerchantRegistration(raw);
  if(raw!==null && !record)throw new Error("Invalid recovery metadata");
  return record;
}
async function persistAttempt(key:string,value:PendingMerchantRegistration|null) {
  if(Platform.OS==="web"){
    if(value)window.localStorage.setItem(key,JSON.stringify(value));
    else window.localStorage.removeItem(key);
  }else if(value)await SecureStore.setItemAsync(key,JSON.stringify(value),secureOptions);
  else await SecureStore.deleteItemAsync(key,secureOptions);
}
let queue=Promise.resolve();
function withAttemptLock<T>(key:string,action:()=>Promise<T>):Promise<T>{
  if(Platform.OS==="web"){
    if(!window.navigator.locks)return Promise.reject(new Error("Cross-tab recovery lock unavailable"));
    return window.navigator.locks.request(key,action);
  }
  const result=queue.then(action);
  queue=result.then(()=>undefined,()=>undefined);
  return result;
}
function MerchantEmployees({actorId,storeId}:Readonly<{actorId:string;storeId:string}>){
  const {theme}=useMobileAppearance();
  const [items,setItems]=useState<EmployeeRecord[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [detail,setDetail]=useState<Awaited<ReturnType<typeof readEmployeeDetail>>|null>(null);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [draft,setDraft]=useState(emptyDraft);
  const [recovery,setRecovery]=useState<Recovery|null>(null);
  const [pending,setPending]=useState<EmployeeRegistration|null>(null);
  const active=useRef<AbortController|null>(null);
  const scope=useRef<AbortController|null>(null);
  const activeWrite=useRef<AbortController|null>(null);
  const refreshAfterWrite=useRef(false);
  async function load(next?:string){
    if(active.current || !scope.current || scope.current.signal.aborted)return;
    const request=new AbortController();
    active.current=request;
    setBusy(true);
    setDetail(null);
    if(!next){setReady(false);setItems([]);setCursor(null);}
    try{
      const page=await readEmployees(actorId,storeId,request.signal,next);
      request.signal.throwIfAborted();
      setItems(previous=>next?[...previous,...page.items]:page.items);
      setCursor(page.nextCursor);setReady(true);
    }catch{
      if(!request.signal.aborted){setReady(false);setItems([]);setCursor(null);setMessage("تعذرت قراءة سجل الموظفين أو انتهت صلاحية المتجر.");}
    }finally{
      if(active.current===request){active.current=null;setBusy(false);}
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keyed scope owns all in-flight reads and recovery.
  useLayoutEffect(()=>{
    const controller=new AbortController();scope.current=controller;
    void load();
    const reload=()=>{
      if(controller.signal.aborted)return;
      setReady(false);setItems([]);setCursor(null);setDetail(null);
      // Never cancel a possibly committed registration just to refresh the directory.
      if(activeWrite.current){refreshAfterWrite.current=true;return;}
      active.current?.abort();active.current=null;
      setMessage("");void load();
    };
    const unsubscribe=Platform.OS==="web"
      ? (()=>{window.addEventListener("focus",reload);return()=>window.removeEventListener("focus",reload);})()
      : (()=>{const listener=AppState.addEventListener("change",status=>{if(status==="active")reload();});return()=>listener.remove();})();
    void (async()=>{
      try{
        const key="bthwani.merchant.employee-attempt."+await digest(JSON.stringify([actorId,"employee-registration"]));
        const attempt=await storedAttempt(key);
        if(!controller.signal.aborted)setRecovery({key,attempt});
      }catch{
        if(!controller.signal.aborted)setMessage("تعذرت قراءة سجل استرداد التسجيل.");
      }
    })();
    return()=>{
      unsubscribe();controller.abort();active.current?.abort();
      active.current=null;activeWrite.current=null;refreshAfterWrite.current=false;scope.current=null;
    };
  },[actorId,storeId]);
  async function openDetail(id:string){
    if(!ready||active.current||!scope.current||scope.current.signal.aborted)return;
    const request=new AbortController();active.current=request;setBusy(true);setDetail(null);setMessage("");
    try{
      const result=await readEmployeeDetail(actorId,storeId,id,request.signal);
      request.signal.throwIfAborted();setDetail(result);
    }catch{
      if(!request.signal.aborted){setDetail(null);setItems([]);setCursor(null);setReady(false);setMessage("تعذر التحقق من تفاصيل الموظف أو صلاحية المتجر. حدّث السجل.");}
    }finally{
      if(active.current===request){active.current=null;setBusy(false);}
    }
  }
  const proposed={operationId:"00000000-0000-4000-8000-000000000000",displayName:draft.displayName.trim(),
    department:draft.department.trim(),jobTitle:draft.jobTitle.trim(),startDate:draft.startDate.trim()};
  async function save(){
    if(!ready || !recovery || active.current || !scope.current || scope.current.signal.aborted || (!pending&&!validEmployeeRegistration(proposed)))return;
    const request=new AbortController();active.current=request;activeWrite.current=request;setBusy(true);setMessage("");setDetail(null);
    const values=pending??proposed;
    try{
      const fingerprint=await digest(JSON.stringify([values.displayName,values.department,values.jobTitle,values.startDate]));
      const claimed=await withAttemptLock(recovery.key,async()=>{
        request.signal.throwIfAborted();
        const old=await storedAttempt(recovery.key);
        if(recovery.attempt && old?.operationId!==recovery.attempt.operationId)return null;
        if(old){if(old.fingerprint!==fingerprint)return null;return old;}
        const record={fingerprint,operationId:randomUUID()};
        await persistAttempt(recovery.key,record);
        return record;
      });
      request.signal.throwIfAborted();
      if(!claimed){setMessage("توجد محاولة مختلفة غير مؤكدة. أعد إدخال القيم الأصلية أو راجع السجل لدى DSH.");return;}
      setRecovery({...recovery,attempt:claimed});
      const input={...values,operationId:claimed.operationId};
      setPending(input);
      await saveEmployee(actorId,storeId,input,request.signal);
      request.signal.throwIfAborted();
      await withAttemptLock(recovery.key,async()=>{
        const old=await storedAttempt(recovery.key);
        if(old?.operationId===claimed.operationId)await persistAttempt(recovery.key,null);
      });
      if(request.signal.aborted)return;
      setRecovery({...recovery,attempt:null});setPending(null);setDraft(emptyDraft);
      setMessage("أكد DSH حفظ سجل الموظف. لم تُمنح أي صلاحيات دخول.");
      setItems([]);setCursor(null);setReady(false);
      active.current=null;
      void load();
    }catch(error){
      if(!request.signal.aborted){
        const status=error && typeof error==="object" && "status" in error?error.status:undefined;
        if(status===401||status===403){setItems([]);setCursor(null);setReady(false);setMessage("انتهت الجلسة أو ملكية المتجر. لا يمكن تأكيد التسجيل.");}
        else setMessage("لم يصل تأكيد موثوق. أعد المحاولة بالقيم نفسها؛ تُحفظ هوية العملية للاسترداد.");
      }
    }finally{
      if(activeWrite.current===request){
        activeWrite.current=null;
        const reload=refreshAfterWrite.current;
        refreshAfterWrite.current=false;
        if(active.current===request){
          active.current=null;
          if(reload)void load();
          else setBusy(false);
        }
      }
    }
  }
  const button={minHeight:44,justifyContent:"center" as const,paddingHorizontal:12,borderWidth:1,borderRadius:10,borderColor:theme.borderColor};
  const input={...button,color:theme.color,backgroundColor:theme.surface};
  const labels=[["displayName","اسم الموظف",120],["department","القسم",80],["jobTitle","المسمى الوظيفي",80],["startDate","بداية العمل (YYYY-MM-DD)",10]] as const;
  return <View testID="merchant-employees-directory" style={{gap:12,padding:16,borderWidth:1,borderColor:theme.borderColor,borderRadius:14,backgroundColor:theme.surface}}>
    <Text accessibilityRole="header" style={{color:theme.color,fontSize:20,fontWeight:"700"}}>موظفو التاجر</Text>
    <Text style={{color:theme.colorSecondary}}>سجل العاملين لدى مالك المتجر الفردي. تسجيل الموظف لا يمنحه حسابًا أو صلاحية متجر.</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load()} style={button}>
      <Text style={{color:theme.interactiveText}}>{busy?"جارٍ الاتصال بـ DSH…":"تحديث سجل الموظفين"}</Text>
    </Pressable>
    {message?<Text accessibilityRole="alert" style={{color:theme.warningText}}>{message}</Text>:null}
    {ready?<View style={{gap:10}}>
      {items.length===0?<Text style={{color:theme.colorSecondary}}>لا توجد سجلات موظفين.</Text>:null}
      {items.map(item=><View key={item.id} style={{gap:4,padding:10,borderWidth:1,borderRadius:8,borderColor:theme.borderColor}}>
        <Text style={{color:theme.color,fontWeight:"700"}}>{item.displayName}</Text>
        <Text style={{color:theme.colorSecondary}}>{item.department} · {item.jobTitle}</Text>
        <Text style={{color:theme.colorSecondary}}>بداية العمل: {item.startDate} · {item.endDate?"منتهي: "+item.endDate:"مستمر"}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`تفاصيل الموظف ${item.displayName}`} disabled={busy} onPress={()=>void openDetail(item.id)} style={button}>
          <Text style={{color:theme.interactiveText}}>التفاصيل وسجل التسجيل</Text>
        </Pressable>
      </View>)}
      {detail?<View testID="merchant-employee-detail" style={{gap:4,padding:12,borderWidth:1,borderColor:theme.borderColor}}>
        <Text accessibilityRole="header" style={{color:theme.color,fontWeight:"700"}}>{detail.employee.displayName}</Text>
        <Text style={{color:theme.colorSecondary}}>{detail.employee.department} · {detail.employee.jobTitle}</Text>
        <Text style={{color:theme.colorSecondary}}>بداية العمل: {detail.employee.startDate} · {detail.employee.endDate??"مستمر"}</Text>
        <Text selectable style={{color:theme.colorSecondary}}>معرّف الموظف: {detail.employee.id}</Text>
        <Text selectable style={{color:theme.colorSecondary}}>المسجل: {detail.audit.registeredByActorId}</Text>
        <Text style={{color:theme.colorSecondary}}>وقت التسجيل (UTC): {detail.audit.recordedAt}</Text>
        <Pressable accessibilityRole="button" onPress={()=>setDetail(null)} style={button}><Text style={{color:theme.interactiveText}}>إغلاق التفاصيل</Text></Pressable>
      </View>:null}
      {cursor?<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void load(cursor)} style={button}>
        <Text style={{color:theme.interactiveText}}>عرض المزيد</Text>
      </Pressable>:null}
      <Text accessibilityRole="header" style={{color:theme.color,fontWeight:"700"}}>تسجيل موظف</Text>
      {recovery?.attempt?<Text style={{color:theme.warningText}}>توجد محاولة سابقة. أدخل بياناتها الأصلية لإعادة التأكيد.</Text>:null}
      {labels.map(([name,label,maxLength])=><View key={name} style={{gap:4}}>
        <Text style={{color:theme.color}}>{label}</Text>
        <TextInput accessibilityLabel={label} value={pending?.[name]??draft[name]} maxLength={maxLength}
          editable={!busy&&!pending&&!!recovery} onChangeText={value=>setDraft(previous=>({...previous,[name]:value}))} style={input}/>
      </View>)}
      <Pressable accessibilityRole="button" disabled={busy||!recovery||(!pending&&!validEmployeeRegistration(proposed))}
        onPress={()=>void save()} style={{...button,backgroundColor:theme.actionBackground}}>
        <Text style={{color:theme.onAction,fontWeight:"700",textAlign:"center"}}>{recovery?.attempt?"إعادة تأكيد التسجيل":"حفظ سجل الموظف"}</Text>
      </Pressable>
    </View>:null}
  </View>;
}

export default function EmployeesScreen({actorId,storeId}:Readonly<{actorId?:string;storeId?:string}>={}){
  if(!actorId||!storeId)return <MerchantCapabilityScreen title="الموظفون" message="افتح سجل الموظفين من تفاصيل متجر تملكه في مساحة التاجر الموثقة." />;
  return <MerchantEmployees key={JSON.stringify([actorId,storeId])} actorId={actorId} storeId={storeId}/>;
}
