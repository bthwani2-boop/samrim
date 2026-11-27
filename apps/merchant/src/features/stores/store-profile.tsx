import { type MerchantStoreProfile, type MerchantStoreProfileChange, validMerchantStoreProfileChange } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { randomUUID } from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { readStoreProfile, saveStoreProfile } from "./store-profile-transport";

type Snapshot = { scope: string; profile: MerchantStoreProfile | null; loading: boolean; message: string };

export default function StoreProfile({ storeId="",actorId="",onUpdated }: Readonly<{
  storeId?:string; actorId?:string; onUpdated?: (()=>void) | undefined;
}> = {}) {
  const {theme}=useMobileAppearance();
  const [snapshot,setSnapshot]=useState<Snapshot>({scope:"",profile:null,loading:false,message:""});
  const [name,setName]=useState("");
  const [description,setDescription]=useState("");
  const [saving,setSaving]=useState(false);
  const [pending,setPending]=useState<MerchantStoreProfileChange|null>(null);
  const [reload,setReload]=useState(0);
  const scope=JSON.stringify([actorId,storeId,reload]);
  const active=useRef<AbortController|null>(null);
  const busy=useRef(false);

  useEffect(()=>{
    if(!actorId || !storeId) return;
    const controller=new AbortController();
    active.current=controller;
    busy.current=false;
    setSaving(false);
    setPending(null);
    setName("");
    setDescription("");
    setSnapshot({scope,profile:null,loading:true,message:""});
    void readStoreProfile(storeId,actorId,controller.signal).then(profile=>{
      if(controller.signal.aborted || active.current!==controller) return;
      setName(profile.name);
      setDescription(profile.description);
      setSnapshot({scope,profile,loading:false,message:""});
    }).catch(()=>{
      if(!controller.signal.aborted && active.current===controller) setSnapshot({scope,profile:null,loading:false,message:"تعذّر تأكيد بيانات المتجر من DSH."});
    });
    return ()=>{controller.abort();if(active.current===controller) active.current=null;};
  },[actorId,storeId,scope]);

  const visible=snapshot.scope===scope?snapshot:null;
  const profile=visible?.profile;
  const draft=profile?{operationId:"profile-draft",expectedVersion:profile.version,name:name.trim(),description:description.trim()}:null;
  const changed=Boolean(profile && draft && (draft.name!==profile.name || draft.description!==profile.description));
  const canSave=visible!==null && !saving && Boolean(pending || (profile && !profile.published && changed && validMerchantStoreProfileChange(draft)));
  const text={color:theme.color};
  const secondary={color:theme.colorSecondary};
  const control={minHeight:44,borderColor:theme.borderColor,borderWidth:1,borderRadius:10,padding:12};

  async function save() {
    const controller=active.current;
    if(!controller || controller.signal.aborted || busy.current || !canSave) return;
    const command=pending??(draft?{...draft,operationId:randomUUID()}:null);
    if(!command) return;
    busy.current=true;
    setSaving(true);
    setPending(command);
    setSnapshot(previous=>({...previous,message:""}));
    const current=()=>!controller.signal.aborted && active.current===controller;
    let acknowledged=false;
    try {
      await saveStoreProfile(storeId,actorId,command,controller.signal);
      acknowledged=true;
      if(!current()) return;
      // A replay can return a historical receipt, so only a fresh owner read is displayed.
      const fresh=await readStoreProfile(storeId,actorId,controller.signal);
      if(!current()) return;
      setName(fresh.name);
      setDescription(fresh.description);
      setPending(null);
      setSnapshot({scope,profile:fresh,loading:false,message:"تم تأكيد بيانات المتجر لدى DSH."});
      onUpdated?.();
    } catch(error) {
      if(!current()) return;
      const status=error && typeof error==="object" && "status" in error?error.status:undefined;
      const code=error && typeof error==="object" && "code" in error?error.code:undefined;
      if(!acknowledged && !pending && (status===400 || status===401 || status===403 || (status===409 && code==="STORE_PROFILE_VERSION_CONFLICT"))) {
        setPending(null);
        setSnapshot({scope,profile:null,loading:false,message:"لم يُقبل التعديل. اقرأ أحدث بيانات المتجر قبل المحاولة مجددًا."});
      } else {
        // Never generate a different operation after an ambiguous dispatch.
        setSnapshot({scope,profile:null,loading:false,message:"لم تتأكد النتيجة. أعد التحقق من العملية نفسها."});
      }
    } finally {
      if(current()){busy.current=false;setSaving(false);}
    }
  }

  if(!actorId || !storeId) return <Text style={secondary}>اختر متجرًا من متاجري لعرض بياناته.</Text>;
  return <View testID="merchant-store-profile" style={{gap:10,padding:16,borderWidth:1,borderColor:theme.borderColor,borderRadius:14,backgroundColor:theme.surface}}>
    <Text accessibilityRole="header" style={{...text,fontSize:20,fontWeight:"700"}}>بيانات المتجر</Text>
    {!visible || visible.loading?<ActivityIndicator accessibilityLabel="جارٍ قراءة بيانات المتجر" color={theme.interactiveText}/>:null}
    {visible?.message?<Text accessibilityRole="alert" style={{color:theme.warningText}}>{visible.message}</Text>:null}
    {profile?<>
      <Text style={secondary}>معرّف المتجر: {profile.storeId} · الإصدار {profile.version}</Text>
      <Text style={text}>اسم المتجر</Text>
      <TextInput accessibilityLabel="اسم المتجر" value={name} onChangeText={setName} editable={!profile.published&&!pending&&!saving} maxLength={120} style={{...control,...text}}/>
      <Text style={text}>وصف المتجر</Text>
      <TextInput accessibilityLabel="وصف المتجر" value={description} onChangeText={setDescription} editable={!profile.published&&!pending&&!saving} multiline maxLength={1000} style={{...control,...text,minHeight:88,textAlignVertical:"top"}}/>
      {profile.published?<Text style={secondary}>بيانات المتجر المنشور للقراءة فقط ضمن هذه الصلاحية.</Text>:null}
    </>:null}
    {profile && !profile.published || pending?<Pressable accessibilityRole="button" accessibilityState={{disabled:!canSave}} disabled={!canSave} style={{...control,opacity:canSave?1:0.5}} onPress={()=>void save()}>
      <Text style={{color:theme.interactiveText}}>{pending?"التحقق من الحفظ السابق":"حفظ بيانات المتجر"}</Text>
    </Pressable>:null}
    {!pending&&!saving&&!visible?.loading?<Pressable accessibilityRole="button" style={control} onPress={()=>setReload(value=>value+1)}>
      <Text style={{color:theme.interactiveText}}>تحديث بيانات المتجر</Text>
    </Pressable>:null}
  </View>;
}