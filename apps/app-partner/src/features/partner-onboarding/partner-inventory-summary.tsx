import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, scopedCatalogInventorySummary, type CatalogInventorySummary, type PartnerAccessibleStore } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function PartnerInventorySummary({ store }: Readonly<{ store: PartnerAccessibleStore }>) {
 const theme=useAppearanceTheme();
 const styles=useMemo(()=>StyleSheet.create({
  panel:{padding:14,borderRadius:13,borderWidth:1,borderColor:theme.borderColor,backgroundColor:theme.surface,gap:10},
  title:{...typography.bodyStrong,color:theme.color,fontWeight:"800"},
  note:{...typography.caption,color:theme.colorMuted},
  warning:{...typography.bodySm,color:theme.danger},
  cards:{flexDirection:"row",flexWrap:"wrap",gap:8},
  card:{flexBasis:125,flexGrow:1,padding:11,borderRadius:10,borderColor:theme.borderColor,borderWidth:1,gap:4},
  value:{...typography.titleMd,color:theme.color,fontWeight:"800"},
  retry:{minHeight:44,justifyContent:"center"},
 }),[theme]);
 const [summary,setSummary]=useState<CatalogInventorySummary|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [retry,setRetry]=useState(0);
 const allowed=store.owned||store.permissions.includes("catalog");
 useFocusEffect(useCallback(()=>{
  void retry;
  let active=true;
  setSummary(null);setError("");
  if(!allowed){setLoading(false);return ()=>{active=false;};}
  setLoading(true);
  const identity=currentIdentityState();
  const actor=identity.kind==="authenticated"?identity.identity.subject:"";
  const current=()=>{
   const latest=currentIdentityState();
   return active&&Boolean(actor)&&latest.kind==="authenticated"&&latest.identity.subject===actor;
  };
  const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if(!actor||!base){setError("تعذر قراءة المخزون؛ تحقق من الجلسة والاتصال.");setLoading(false);return ()=>{active=false;};}
  void(async()=>{
   const token=await getUsableIdentityAccessToken();
   if(!current())return;
   const client=createDshMobileClient(base,{cryptoRandomUUID:()=>Crypto.randomUUID()});
   const result=await client.readOwnStoreInventorySummary(token,store.id);
   if(!current())return;
   const parsed=scopedCatalogInventorySummary(result,store.id);
   if(!parsed)throw new Error("INVALID_INVENTORY_SUMMARY_SCOPE");
   setSummary(parsed);setLoading(false);
  })().catch(()=>{if(current()){setSummary(null);setError("تعذر قراءة إجمالي مخزون المتجر. أعد المحاولة.");setLoading(false);}});
  return ()=>{active=false;};
 },[store.id,allowed,retry]));
 const items=summary?[
  {label:"إجمالي العروض",value:summary.totalOffers},
  {label:"العروض المنشورة",value:summary.publishedOffers},
  {label:"متاحة ضمن الكتالوج",value:summary.availableOffers},
  {label:"غير متاحة",value:summary.unavailableOffers},
  {label:"نافدة المخزون",value:summary.stockoutOffers},
 ]:[];
 return <View style={styles.panel} accessibilityLabel="ملخص مخزون المتجر الكامل">
  <Text accessibilityRole="header" style={styles.title}>إجماليات المخزون من DSH</Text>
  {!allowed?<Text style={styles.warning}>لا تملك صلاحية قراءة كتالوج هذا المتجر.</Text>:null}
  {loading?<ActivityIndicator accessibilityLabel="جارٍ قراءة ملخص المخزون" color={theme.brandAction}/>:null}
  {error?<Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل ملخص المخزون" onPress={()=>setRetry(n=>n+1)} style={styles.retry}><Text style={styles.warning}>{error} · إعادة المحاولة</Text></Pressable>:null}
  {summary&&!loading&&!error?<><View style={styles.cards}>{items.map(item=><View key={item.label} style={styles.card}><Text style={styles.note}>{item.label}</Text><Text style={styles.value}>{item.value.toLocaleString("ar-YE")}</Text></View>)}</View>
   <Text style={styles.note}>الأرقام تشمل جميع عروض المتجر، لا الصفحة الحالية فقط. لا تعني إتاحة العرض أن المتجر مفتوح لاستقبال الطلبات.</Text>
  </>:null}
 </View>;
}
