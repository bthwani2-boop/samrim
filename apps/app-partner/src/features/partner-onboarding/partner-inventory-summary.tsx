import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type CatalogInventorySummary, type PartnerAccessibleStore, scopedCatalogInventorySummary } from "@bthwani/dsh";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { createPartnerDshClient } from "../../bootstrap/dsh-client";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";

const currentPartnerSessionKey = () => partnerSetupSessionKey(currentIdentityState());

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
 const sessionKey=useSyncExternalStore(subscribeIdentitySession,currentPartnerSessionKey,()=> "");
 const scopeKey = JSON.stringify([sessionKey, store.id]);
 const [visibleScopeKey,setVisibleScopeKey]=useState("");
 const [summary,setSummary]=useState<CatalogInventorySummary|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [retry,setRetry]=useState(0);
 const allowed=store.owned||store.permissions.includes("catalog");
 useFocusEffect(useCallback(()=>{
  void retry;
  let active=true;
  setSummary(null);setVisibleScopeKey("");setError("");
  if(!allowed){setLoading(false);return ()=>{active=false;};}
  setLoading(true);
  const current=()=>active&&Boolean(sessionKey)&&currentPartnerSessionKey()===sessionKey;
  const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if(!sessionKey||!base){setError("تعذر قراءة المخزون؛ تحقق من الجلسة والاتصال.");setLoading(false);return ()=>{active=false;};}
  void(async()=>{
   const token=await getUsableIdentityAccessToken();
   if(!current())return;
   const client=createPartnerDshClient();
   const result=await client.readOwnStoreInventorySummary(token,store.id);
   if(!current())return;
   const parsed=scopedCatalogInventorySummary(result,store.id);
   if(!parsed)throw new Error("INVALID_INVENTORY_SUMMARY_SCOPE");
   setSummary(parsed);setVisibleScopeKey(scopeKey);setLoading(false);
  })().catch(()=>{if(current()){setSummary(null);setVisibleScopeKey("");setError("تعذر قراءة إجمالي مخزون المتجر. أعد المحاولة.");setLoading(false);}});
  return ()=>{active=false;};
 },[store.id,allowed,retry,sessionKey,scopeKey]));
 const visible = allowed && Boolean(sessionKey) && currentPartnerSessionKey() === sessionKey && visibleScopeKey === scopeKey;
 const items=summary && visible?[
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
  {summary && visible && !loading && !error?<><View style={styles.cards}>{items.map(item=><View key={item.label} style={styles.card}><Text style={styles.note}>{item.label}</Text><Text style={styles.value}>{item.value.toLocaleString("ar-YE")}</Text></View>)}</View>
   <Text style={styles.note}>الأرقام تشمل جميع عروض المتجر، لا الصفحة الحالية فقط. لا تعني إتاحة العرض أن المتجر مفتوح لاستقبال الطلبات.</Text>
  </>:null}
 </View>;
}
