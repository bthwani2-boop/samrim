import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreAccessGrant } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { notifyPartnerStoreAccessChanged } from "./partner-store-scope-context";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { type InvitationAction, invitationActionConfirmed, invitationActionIdentity } from "./store-access-invitation-recovery";
import { activateOwnStoreAccessInvitation, decideOwnStoreAccessInvitation, listOwnStoreAccessInvitations } from "./store-readback-client";

const names:Record<string,string> = {
  orders:"الطلبات",catalog:"الكتالوج",store_operations:"تشغيل المتجر",
  promotions:"العروض",finance_read:"عرض المالية",payout_request:"طلب صرف",
  fulfillment:"التوصيل",
};
function label(state:StoreAccessGrant["state"]) {
  switch(state){
    case "pending_acceptance":return "بانتظار قبول الدعوة";
    case "pending_role_admission":return "بانتظار الاعتماد";
    case "pending_partner_activation":return "بانتظار تفعيل الحساب";
    case "active":return "نشطة";
    case "suspended":return "موقوفة";
    case "revoked":return "ملغاة";
    case "declined":return "مرفوضة";
    case "expired":return "منتهية";
  }
}
async function attemptHeaders(grant:StoreAccessGrant,action:InvitationAction){
  const digest=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,invitationActionIdentity(grant.id,grant.version,action));
  return {idempotencyKey:"store_access_"+digest,correlationID:"store_access_corr_"+digest};
}
export function PartnerAccessInvitationsCard(){
  const theme=useAppearanceTheme();
  const styles=useMemo(()=>createPartnerSurfaceStyles(theme),[theme]);
  const [invitations,setInvitations]=useState<ReadonlyArray<StoreAccessGrant>>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const reload=useCallback(async():Promise<ReadonlyArray<StoreAccessGrant>|null>=>{
    setLoading(true);setError("");
    try{
      const page=await listOwnStoreAccessInvitations();
      setInvitations(page.items);
      return page.items;
    }catch{
      setError("تعذر تحميل الدعوات. تحقق من الاتصال وأعد المحاولة.");
      return null;
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  async function submit(grant:StoreAccessGrant,action:InvitationAction){
    if(busy)return;
    setBusy(true);setError("");setNotice("");
    try{
      const headers=await attemptHeaders(grant,action);
      try {
        if(action==="activate")await activateOwnStoreAccessInvitation(grant.id,grant.version,headers.idempotencyKey,headers.correlationID);
        else await decideOwnStoreAccessInvitation(grant.id,{decision:action,expectedVersion:grant.version},headers.idempotencyKey,headers.correlationID);
      }catch(cause){console.warn("Invitation transition response uncertain",cause);}
      const latest=await reload();
      const canonical=latest?.find(item=>item.id===grant.id);
      if(!invitationActionConfirmed(grant,canonical,action)){
        setError("لم تتأكد نتيجة العملية من الخادم. أعد فتح الإشعارات قبل المحاولة مجددًا.");
        return;
      }
      setNotice(action==="decline"?"تم رفض الدعوة.":action==="activate"||canonical?.state==="active"?"تم تفعيل العضوية.":"تم قبول الدعوة، وقد تحتاج إلى اعتماد أو تفعيل.");
      if(action==="activate"||(action==="accept"&&canonical?.state==="active")){
        try{await notifyPartnerStoreAccessChanged();}catch{setError("تم تأكيد الدعوة، لكن تعذر تحديث المتاجر. أعد فتح التطبيق.");}
      }
    }catch{
      setError("تعذر التحقق من الدعوة. أعد فتح الإشعارات.");
    }finally{setBusy(false);}
  }
  const actionableInvitations=invitations.filter(grant=>grant.state==="pending_acceptance"||grant.state==="pending_partner_activation");
  if(!actionableInvitations.length&&!notice)return null;
  return <View style={styles.card} accessibilityLabel="دعوات الفريق">
    <Text style={styles.value}>دعوات الفريق</Text>
    {actionableInvitations.map(grant=><View key={grant.id} style={{gap:8,borderColor:theme.borderColor,borderWidth:1,borderRadius:12,padding:10}}>
      <Text style={styles.value}>{grant.storeName}</Text>
      <Text style={styles.muted}>{label(grant.state)} · {grant.permissions.map(p=>names[p]??p).join("، ")}</Text>
      {grant.state==="pending_role_admission"?<Text style={styles.muted}>تنتظر الدعوة اعتماد المنصة.</Text>:null}
      {grant.state==="pending_acceptance"?<View style={{flexDirection:"row",gap:8}}>
        <View style={{flex:1}}><BthwaniButton disabled={busy||loading} busy={busy} label="قبول" onPress={()=>void submit(grant,"accept")}/></View>
        <View style={{flex:1}}><BthwaniButton disabled={busy||loading} label="رفض" variant="secondary" onPress={()=>void submit(grant,"decline")}/></View>
      </View>:null}
      {grant.state==="pending_partner_activation"?<BthwaniButton busy={busy} disabled={busy||loading} label="تفعيل العضوية" onPress={()=>void submit(grant,"activate")}/>:null}
    </View>)}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    {notice?<Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>:null}
  </View>;
}
