import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PartnerAccessibleStore, type PartnerScopedFinanceStore } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function PartnerPerformancePeek({store}:{store:PartnerAccessibleStore|undefined}){
  const theme=useAppearanceTheme();
  const router=useRouter();
  const styles=useMemo(()=>StyleSheet.create({
    root:{backgroundColor:theme.surface,borderWidth:1,borderColor:theme.borderColor,borderRadius:12,paddingHorizontal:11,paddingVertical:9,gap:6},
    top:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
    heading:{...typography.bodyStrong,color:theme.color,fontSize:13},
    action:{...typography.caption,color:theme.brandAction,fontWeight:"800"},
    metrics:{flexDirection:"row",alignItems:"center",gap:12},
    metric:{flex:1,gap:3},
    label:{...typography.caption,color:theme.colorMuted},
    number:{...typography.bodyStrong,color:theme.color},
  }),[theme]);
  const [data,setData]=useState<PartnerScopedFinanceStore|null>(null);
  useFocusEffect(useCallback(()=>{
    let alive=true;
    setData(null);
    const storeID=store?.id;
    const state=currentIdentityState();
    const actorID=state.kind==="authenticated"?state.identity.subject:"";
    if(!actorID||!storeID||!store.owned)return()=>{alive=false;};
    void (async()=>{
      const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if(!base)return;
      const token=await getUsableIdentityAccessToken();
      const api=createDshMobileClient(base,{cryptoRandomUUID:()=>Crypto.randomUUID()});
      const result=await api.readOwnPartnerFinancialSummary(token);
      const summary=result.summary.stores.find(item=>item.storeId===storeID);
      const latest=currentIdentityState();
      if(alive&&latest.kind==="authenticated"&&latest.identity.subject===actorID&&summary?.attributionComplete)setData(summary);
    })().catch(()=>{if(alive)setData(null);});
    return()=>{alive=false;};
  },[store?.id,store?.owned]));
  if(!data)return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="ملخص مستحقات المتجر، فتح الأداء" onPress={()=>router.push("/insights?returnTo=more" as Href)} style={styles.root}>
    <View style={styles.top}><Text style={styles.heading}>ملخص المتجر المالي</Text><Text style={styles.action}>الأداء ←</Text></View>
    <View style={styles.metrics}>
      <View style={styles.metric}><Text style={styles.label}>مستحقات مكتسبة</Text><Text style={styles.number} numberOfLines={1}>{formatMoney(data.earnedMinor,"YER")}</Text></View>
      <View style={styles.metric}><Text style={styles.label}>طلبات مسوّاة</Text><Text style={styles.number}>{data.orderCount.toLocaleString("ar-YE")}</Text></View>
      <BthwaniIcon name="orders" color={theme.colorMuted} size={19}/>
    </View>
  </Pressable>;
}
