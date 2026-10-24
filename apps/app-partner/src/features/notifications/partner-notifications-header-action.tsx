import { sizing, typography } from "@bthwani/design-system";
import { BthwaniIconButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function PartnerNotificationsHeaderAction() {
  const theme=useAppearanceTheme();
  const router=useRouter();
  const [unread,setUnread]=useState<number|null>(null);
  const [actor,setActor]=useState("");
  useFocusEffect(useCallback(()=>{
    const state=currentIdentityState();
    const current=state.kind==="authenticated"?state.identity.subject:"";
    let active=true;
    setActor(current);
    setUnread(null);
    const refresh=async()=>{
      if(!current||!active||AppState.currentState!=="active")return;
      try{
        const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
        if(!base)return;
        const token=await getUsableIdentityAccessToken();
        const identity=currentIdentityState();
        if(!active||identity.kind!=="authenticated"||identity.identity.subject!==current)return;
        const response=await createDshMobileClient(base,{cryptoRandomUUID:()=>Crypto.randomUUID()}).listNotifications(token,1);
        const latest=currentIdentityState();
        if(active&&latest.kind==="authenticated"&&latest.identity.subject===current)setUnread(response.unreadCount);
      }catch{if(active)setUnread(null);}
    };
    void refresh();
    const interval=setInterval(()=>void refresh(),30_000);
    const listener=AppState.addEventListener("change",state=>{if(state==="active")void refresh();});
    return()=>{active=false;clearInterval(interval);listener.remove();};
  },[]));
  return <View style={styles.wrapper}>
    <BthwaniIconButton icon="notifications" label={unread&&actor?`الإشعارات، ${unread} غير مقروءة`:"الإشعارات"} onPress={()=>router.push("/notifications" as Href)} size={sizing.controlSm} tone="soft"/>
    {unread!==null&&unread>0?<View pointerEvents="none" style={[styles.badge,{backgroundColor:theme.brandAction}]}>
      <Text style={[styles.count,{color:theme.onAction}]}>{unread>99?"99+":unread}</Text>
    </View>:null}
  </View>;
}
const styles=StyleSheet.create({
  wrapper:{minWidth:36,minHeight:36,alignItems:"center",justifyContent:"center"},
  badge:{position:"absolute",right:-4,top:-5,minWidth:17,height:17,borderRadius:9,paddingHorizontal:3,alignItems:"center",justifyContent:"center"},
  count:{...typography.caption,fontSize:10,fontWeight:"800"},
});
