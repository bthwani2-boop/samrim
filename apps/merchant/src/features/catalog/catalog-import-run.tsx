import { type MerchantCatalogImportResult, validMerchantCatalogImportChange } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { withMutationRecoveryLock } from "../mutation-recovery/recovery-lock";
import { buildImportManifest, type previewCatalogCsv } from "./catalog-import-data";
import { requestCatalogImport } from "./catalog-import-transport";

const digest=(value:string)=>digestStringAsync(CryptoDigestAlgorithm.SHA256,value);
const options={keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY};
type Attempt={runId:string;fingerprint:string};

async function read(key:string):Promise<Attempt|null>{
  const raw=Platform.OS==="web"?window.localStorage.getItem(key):await SecureStore.getItemAsync(key,options);
  if(raw===null)return null;
  const a=JSON.parse(raw) as Attempt;
  if(!a||Object.keys(a).length!==2||typeof a.runId!=="string"||!/^[A-Za-z0-9._-]{8,128}$/.test(a.runId)||
    typeof a.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(a.fingerprint))throw new Error("INVALID_RECOVERY");
  return a;
}
async function write(key:string,a:Attempt|null){
  if(Platform.OS==="web"){if(a)window.localStorage.setItem(key,JSON.stringify(a));else window.localStorage.removeItem(key);}
  else if(a)await SecureStore.setItemAsync(key,JSON.stringify(a),options);
  else await SecureStore.deleteItemAsync(key,options);
}
type Rows=ReturnType<typeof previewCatalogCsv>;
const reasons:Record<string,string>={UPDATED:"تم التعديل",UNSELECTED:"لم يُعتمد للتعديل",DUPLICATE:"مكرر",INVALID_VALUES:"قيم غير صالحة",AMBIGUOUS_OR_CHANGED:"مطابقة ملتبسة أو متغيرة",INELIGIBLE:"غير مؤهل",STALE_VERSION_OR_NAME:"تغيرت المسودة",OPERATION_CONFLICT:"تعارض العملية"};
export default function CatalogImportRun({actorId,storeId,rows,sourceSha256,onChanged,blocked,running,beginRun}:Readonly<{
  actorId:string;storeId:string;rows:Rows;sourceSha256:string;onChanged?:(()=>void)|undefined;blocked:boolean;running:boolean;beginRun:()=> (()=>void)|null;
}>){
  const {theme}=useMobileAppearance();
  const [recovery,setRecovery]=useState<{key:string;attempt:Attempt|null}|null>(null);
  const [selected,setSelected]=useState<ReadonlySet<number>>(new Set());
  const [result,setResult]=useState<MerchantCatalogImportResult|null>(null);
  const disabled=blocked||running;
  const [message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null);
  const scope=useRef<AbortController|null>(null);
  useLayoutEffect(()=>{
    const controller=new AbortController();scope.current=controller;
    void (async()=>{
      try{
        const key="bthwani.merchant.import."+await digest(JSON.stringify([actorId,storeId]));
        const attempt=await read(key);
        if(controller.signal.aborted)return;
        setRecovery({key,attempt});
        if(attempt)setMessage("توجد دفعة محفوظة. اقرأ نتيجتها أو أعد اختيار الملف نفسه عند الحاجة.");
      }catch{if(!controller.signal.aborted)setMessage("تعذرت قراءة معرّف دفعة الاستيراد.");}
    })();
    return()=>{controller.abort();active.current?.abort();active.current=null;};
  },[actorId,storeId]);
  const [selectionPage,setSelectionPage]=useState(0);
  const selectionSource=useRef({sourceSha256,rows,selected});
  useLayoutEffect(()=>{
    if(selectionSource.current.sourceSha256!==sourceSha256||selectionSource.current.rows!==rows){
      setSelected(new Set());setSelectionPage(0);
    }
    selectionSource.current={sourceSha256,rows,selected};
  },[sourceSha256,rows,selected]);
  const eligible=rows.filter(r=>r.editableDraft);
  const selectedCount=eligible.filter(r=>selected.has(r.row)).length;
  const manifest=buildImportManifest(rows,sourceSha256,selected);
  const canStart=selectionSource.current.sourceSha256===sourceSha256&&selectionSource.current.rows===rows&&selectedCount>0&&validMerchantCatalogImportChange(manifest);
  const currentStart=()=>canStart&&selectionSource.current.sourceSha256===sourceSha256&&
    selectionSource.current.rows===rows&&selectionSource.current.selected===selected;
  async function execute(action:"start"|"read"|"advance"|"finish",offset=0){
    if(!recovery||active.current||!scope.current||scope.current.signal.aborted||(action==="start"&&!currentStart()))return;
    if(blocked)return;
    const release=beginRun();
    if(!release)return;
    const controller=new AbortController();active.current=controller;
    const signal=controller.signal;
    setMessage("");
    try{
      const attempt=recovery.attempt;
      const key=recovery.key;
      if(action==="start"){
        const fingerprint=await digest(JSON.stringify(manifest));
        if(!currentStart())return;
        const confirmed=await withMutationRecoveryLock(Platform.OS,key,async()=>{
          signal.throwIfAborted();
          const previous=await read(key);
          signal.throwIfAborted();
          if(!currentStart())throw new Error("SELECTION_CHANGED");
          if(previous&&previous.fingerprint!==fingerprint)throw new Error("MANIFEST_CHANGED");
          if(!previous&&recovery.attempt)throw new Error("RECOVERY_CHANGED");
          const registered=previous??{runId:randomUUID(),fingerprint};
          if(!previous){
            await write(key,registered);
            if(!signal.aborted)setRecovery({key,attempt:registered});
            // This new attempt has not reached DSH. Only its creator may
            // discard it, under the same lock, before any owner dispatch.
            if(signal.aborted||!currentStart()){
              await write(key,null);
              if(!signal.aborted)setRecovery({key,attempt:null});
              signal.throwIfAborted();
              throw new Error("SELECTION_CHANGED");
            }
          }
          signal.throwIfAborted();
          if(!currentStart())throw new Error("SELECTION_CHANGED");
          setRecovery({key,attempt:registered});
          return requestCatalogImport(actorId,storeId,registered.runId,"PUT",signal,manifest);
        });
        signal.throwIfAborted();setResult(confirmed);
        setMessage("أكد DSH تسجيل الدفعة. اختر تنفيذ الصفوف المعتمدة.");
      }else if(attempt){
        const recover=async()=>{
          signal.throwIfAborted();
          const stored=await read(key);
          signal.throwIfAborted();
          if(stored?.runId!==attempt.runId||stored.fingerprint!==attempt.fingerprint)throw new Error("RECOVERY_CHANGED");
          if(action==="finish"){
            const current=await requestCatalogImport(actorId,storeId,attempt.runId,"GET",signal);
            signal.throwIfAborted();
            if(current.processed!==current.total)throw new Error("INCOMPLETE");
            await write(key,null);
            signal.throwIfAborted();setRecovery({key,attempt:null});setResult(null);setSelected(new Set());
            setMessage("تم إغلاق متابعة الدفعة المكتملة. اختر الملف من جديد قبل أي تعديل آخر.");onChanged?.();
          }else if(action==="read"){
            const current=await requestCatalogImport(actorId,storeId,attempt.runId,"GET",signal,undefined,offset);
            signal.throwIfAborted();setResult(current);
          }else{
            // Hold the same recovery claim during resume and completion.
            // A competing tab cannot retire the attempt between read and write.
            let current=await requestCatalogImport(actorId,storeId,attempt.runId,"GET",signal);
            signal.throwIfAborted();setResult(current);
            while(current.processed<current.total){
              const next=await requestCatalogImport(actorId,storeId,attempt.runId,"PATCH",signal);
              signal.throwIfAborted();
              if(next.total!==current.total||next.sourceSha256!==current.sourceSha256||next.processed<=current.processed)throw new Error("PROGRESS_INVALID");
              current=next;setResult(current);
            }
            setMessage("اكتملت معالجة الدفعة لدى DSH. راجع النتائج؛ الصفوف المحجوزة لم تُعدّل.");onChanged?.();
          }
        };
        if(action==="read")await recover();
        else await withMutationRecoveryLock(Platform.OS,key,recover);
      }
    }catch(error){
      if(signal.aborted)return;
      const code=error instanceof Error?error.message:"";
      if(code!=="MUTATION_RECOVERY_LOCK_UNAVAILABLE")setResult(null);
      setMessage(code==="MUTATION_RECOVERY_LOCK_UNAVAILABLE"?"تعذر تأمين الاسترداد بين تبويبات المتصفح. استخدم متصفحًا يدعم Web Locks قبل تعديل الدفعة.":code==="MANIFEST_CHANGED"?"الملف أو الاختيارات لا تطابق المحاولة المحفوظة. أعد اختيار القيم نفسها أو اقرأ الدفعة الموجودة.":
        code==="SELECTION_CHANGED"?"تغيرت المعاينة أو الاختيارات. راجعها وأكد الدفعة الحالية.":
        code==="RECOVERY_CHANGED"?"تغيرت متابعة الدفعة في نافذة أخرى. أعد فتح الكتالوج.":
        "تعذر التأكيد لدى DSH. معرّف الدفعة محفوظ؛ اقرأ حالتها قبل إعادة التنفيذ.");
    }finally{if(active.current===controller)active.current=null;release();}
  }
  const button={minHeight:44,borderWidth:1,borderColor:theme.borderColor,borderRadius:10,padding:10};
  return <View testID="merchant-catalog-import-run" style={{gap:8}}>
    <Text style={{color:theme.color,fontWeight:"700"}}>دفعة تعديل المسودات الحالية</Text>
    {rows.length>0&&!result?<View style={{gap:6}}>
      <Text style={{color:theme.colorSecondary}}>اعتماد {selectedCount} من {eligible.length} مسودة مطابقة. لا ينشئ هذا المسار منتجات جديدة، ولا ينشر العروض.</Text>
      <Pressable accessibilityRole="button" disabled={disabled||eligible.length===0} style={button} onPress={()=>{if(!disabled&&!active.current)setSelected(new Set(eligible.map(r=>r.row)));}}><Text style={{color:theme.interactiveText}}>تحديد جميع المسودات المطابقة</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} style={button} onPress={()=>{if(!disabled&&!active.current)setSelected(new Set());}}><Text style={{color:theme.interactiveText}}>إلغاء تحديد الكل</Text></Pressable>
      {eligible.slice(selectionPage*25,(selectionPage+1)*25).map(row=>
        <Pressable key={row.row} accessibilityRole="checkbox" accessibilityLabel={`اعتماد السجل ${row.row}`}
          accessibilityState={{checked:selected.has(row.row),disabled:disabled}} disabled={disabled} style={button}
          onPress={()=>{if(!disabled&&!active.current)setSelected(previous=>{const next=new Set(previous);if(next.has(row.row))next.delete(row.row);else next.add(row.row);return next;});}}>
          <Text style={{color:theme.color}}>{selected.has(row.row)?"محدد":"غير محدد"} · {row.row} · {row.name}</Text>
          <Text style={{color:theme.colorSecondary}}>السعر: {row.editableDraft?.priceYer} ← {row.priceYer} · المخزون: {row.editableDraft?.stockUnits} ← {row.stockUnits}</Text>
        </Pressable>)}
      {eligible.length>25?<View style={{flexDirection:"row",gap:8,flexWrap:"wrap"}}>
        <Pressable accessibilityRole="button" disabled={disabled||selectionPage===0} onPress={()=>setSelectionPage(p=>Math.max(0,p-1))} style={button}><Text style={{color:theme.interactiveText}}>المسودات السابقة</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={disabled||(selectionPage+1)*25>=eligible.length} onPress={()=>setSelectionPage(p=>p+1)} style={button}><Text style={{color:theme.interactiveText}}>المسودات التالية</Text></Pressable>
      </View>:null}
      <Pressable accessibilityRole="button" disabled={disabled||!recovery||!canStart} style={button} onPress={()=>void execute("start")}><Text style={{color:theme.interactiveText}}>اعتماد وتسجيل الدفعة المحددة</Text></Pressable>
    </View>:null}
    {recovery?.attempt?<View style={{gap:6}}>
      <Text selectable style={{color:theme.colorSecondary}}>معرّف الدفعة: {recovery.attempt.runId}</Text>
      <Pressable accessibilityRole="button" disabled={disabled} style={button} onPress={()=>void execute("read")}><Text style={{color:theme.interactiveText}}>قراءة حالة الدفعة</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled||!result||result.processed===result.total} style={button} onPress={()=>void execute("advance")}><Text style={{color:theme.interactiveText}}>تنفيذ أو استكمال الدفعة</Text></Pressable>
    </View>:null}
    {result?<View style={{gap:6}}>
      <Text accessibilityLiveRegion="polite" style={{color:theme.color}}>تمت معالجة {result.processed} من {result.total}</Text>
      {result.outcomes.map(o=><Text key={o.row} style={{color:theme.colorSecondary}}>السجل {o.row}: {reasons[o.reason]??o.reason}{o.resultVersion?" · نسخة "+o.resultVersion:""}</Text>)}
      <Pressable accessibilityRole="button" disabled={disabled||result.offset===0} style={button} onPress={()=>void execute("read",Math.max(0,result.offset-25))}><Text style={{color:theme.interactiveText}}>نتائج سابقة</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled||result.offset+result.outcomes.length>=result.processed} style={button} onPress={()=>void execute("read",result.offset+result.outcomes.length)}><Text style={{color:theme.interactiveText}}>نتائج تالية</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={disabled||result.processed!==result.total} style={button} onPress={()=>void execute("finish")}><Text style={{color:theme.interactiveText}}>إنهاء متابعة الدفعة</Text></Pressable>
    </View>:null}
    {running?<Text accessibilityLiveRegion="polite" style={{color:theme.colorSecondary}}>جارٍ التأكيد لدى DSH...</Text>:null}
    {message?<Text accessibilityRole="alert" style={{color:theme.colorSecondary}}>{message}</Text>:null}
  </View>;
}
