import { type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme, useMobileAppearance, type MobileIconName } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreAccessGrant, StoreImagesResponse } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { currentIdentityState, logoutIdentity, subscribeIdentitySession } from "../../bootstrap/identity";
import { PartnerAccessInvitationsCard } from "./partner-access-invitations";
import { readOwnJoiningCase, listOwnStoreAccessInvitations, readOwnStoreOperationalAvailability, readOwnStoreImages } from "./store-readback-client";
import { onStoreAvailabilityChanged } from "./store-availability-events";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";

type MenuItem = Readonly<{label:string;icon:MobileIconName;href?:Href;section?:"promotions"|"team"}>;
type IdentityDisplay = Readonly<{name:string;role:string}>;
function roleForPermissions(values:ReadonlyArray<string>) {
  const unique=new Set(values);
  if(unique.size===1 && unique.has("orders")) return "موظف طلبات";
  if(unique.size===1 && unique.has("catalog")) return "مسؤول الكتالوج";
  if(unique.size===1 && unique.has("finance_read")) return "اطلاع مالي";
  if(unique.has("store_operations") && unique.has("orders")) return "مسؤول تشغيل المتجر";
  return "موظف بصلاحيات مخصصة";
}
function actorID() { const state=currentIdentityState(); return state.kind==="authenticated"?state.identity.subject:""; }

export function PartnerMore() {
  const router=useRouter();
  const theme=useAppearanceTheme();
  const {preference,setPreference}=useMobileAppearance();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {selectedStore,stores,state,reload}=usePartnerStoreScope();
  const [actor,setActor]=useState(actorID);
  const [identity,setIdentity]=useState<IdentityDisplay>({name:"الحساب الحالي",role:"جارٍ التحقق من الصفة"});
  const [availability,setAvailability]=useState<PartnerStoreOperationalAvailabilityResponse|null>(null);
  const [availabilityError,setAvailabilityError]=useState(false);
  const [storeImages,setStoreImages]=useState<StoreImagesResponse|null>(null);
  const [coverFailed,setCoverFailed]=useState(false);
  const [logoFailed,setLogoFailed]=useState(false);
  const [themeExpanded,setThemeExpanded]=useState(false);
  const [themeBusy,setThemeBusy]=useState(false);
  const [themeError,setThemeError]=useState("");
  const [invitesExpanded,setInvitesExpanded]=useState(false);
  const [profileExpanded,setProfileExpanded]=useState(false);
  const [logoutBusy,setLogoutBusy]=useState(false);
  const [logoutError,setLogoutError]=useState("");
  const selectedID=selectedStore?.id;
  const canOperate=Boolean(selectedStore && (selectedStore.owned||selectedStore.permissions.includes("store_operations")));
  const can=(permission:"promotions"|"catalog")=>Boolean(selectedStore&&(selectedStore.owned||selectedStore.permissions.includes(permission)));
  const storeID=canOperate?selectedID:undefined;

  useFocusEffect(useCallback(()=>{
    const unsub=subscribeIdentitySession(()=>setActor(actorID()));
    setActor(actorID());
    return unsub;
  },[]));
  useFocusEffect(useCallback(()=>{
    let active=true;
    setIdentity({name:"الحساب الحالي",role:"جارٍ التحقق من الصفة"});
    if(!actor || !selectedStore) return ()=>{active=false;};
    const resolve=async()=>{
      if(selectedStore.owned){
        try {
          const result=await readOwnJoiningCase();
          if(active) setIdentity({name:result.case.ownerFullName?.trim()||"مالك الحساب",role:"مالك الشريك"});
        } catch {
          if(active)setIdentity({name:"مالك الحساب",role:"مالك الشريك"});
        }
        return;
      }
      try {
        const page=await listOwnStoreAccessInvitations();
        const grant:StoreAccessGrant|undefined=page.items.find(item=>item.storeId===selectedStore.id&&item.delegateActorId===actor&&item.state==="active");
        if(active)setIdentity({name:grant?.displayNameAr?.trim()||grant?.delegateBeneficiaryName?.trim()||"الحساب الحالي",
          role:grant?roleForPermissions(grant.permissions):roleForPermissions(selectedStore.permissions)});
      } catch {
        if(active)setIdentity({name:"الحساب الحالي",role:roleForPermissions(selectedStore.permissions)});
      }
    };
    void resolve();
    return ()=>{active=false;};
  },[actor,selectedStore?.id,selectedStore?.owned,selectedStore?.permissions.join(",")]));

  useFocusEffect(useCallback(()=>{
    let active=true;
    setStoreImages(null);setCoverFailed(false);setLogoFailed(false);
    if(selectedID)void readOwnStoreImages(selectedID).then(value=>{if(active&&value.storeId===selectedID)setStoreImages(value);}).catch(()=>{if(active)setStoreImages(null);});
    return ()=>{active=false;};
  },[selectedID]));
  useFocusEffect(useCallback(()=>{
    let active=true;
    setAvailability(null);setAvailabilityError(false);
    const refresh=()=>{if(storeID)void readOwnStoreOperationalAvailability(storeID).then(
      value=>{if(active){setAvailability(value);setAvailabilityError(false);}},
      ()=>{if(active)setAvailabilityError(true);});
    };
    refresh();
    const stop=storeID?onStoreAvailabilityChanged(storeID,refresh):()=>{};
    return ()=>{active=false;stop();};
  },[storeID]));
  const orderable=availability?.orderabilityByMode.some(mode=>mode.state==="OPEN_FOR_ORDERS")??false;
  const stopped=availability?.availability.paused??false;
  const operationalState=availabilityError?"تعذر قراءة حالة المتجر":!availability?"جارٍ التحقق":stopped?"متوقف مؤقتًا":orderable?"مفتوح":"مغلق";
  const actions:MenuItem[]=[
    ...(can("catalog")?[{label:"أدوات الكتالوج",icon:"cart" as const,href:"/products?panel=tools" as Href}]:[]),
    ...(can("promotions")?[{label:"العروض",icon:"offers" as const,section:"promotions" as const}]:[]),
    ...(selectedStore?.owned?[{label:"الفريق",icon:"account" as const,section:"team" as const}]:[]),
    {label:"الأداء",icon:"orders",href:"/insights" as Href},
    ...(state.kind==="ready"&&!stores.length?[{label:"إعداد المتجر",icon:"store" as const,href:"/onboarding" as Href}]:[]),
  ];
  const open=(item:MenuItem)=>{
    if(item.section)router.push({pathname:"/store",params:{section:item.section,returnTo:"more"}} as Href);
    else if(item.href)router.push((String(item.href)+(String(item.href).includes("?")?"&":"?")+"returnTo=more") as Href);
  };
  async function chooseTheme(next:typeof preference){
    if(themeBusy||next===preference)return;
    setThemeBusy(true);setThemeError("");
    try{await setPreference(next);}catch{setThemeError("تعذر تغيير المظهر، أعد المحاولة.");}
    finally{setThemeBusy(false);}
  }
  async function logout(){
    if(logoutBusy)return;
    setLogoutBusy(true);setLogoutError("");
    try{await logoutIdentity();}catch{setLogoutError("تعذر تسجيل الخروج. تحقق من الاتصال وحاول مجددًا.");}
    finally{setLogoutBusy(false);}
  }
  return <View style={styles.screen}>
    <Pressable accessibilityRole="button" accessibilityLabel={"هوية الحساب "+identity.name+"، "+identity.role}
      onPress={()=>setProfileExpanded(v=>!v)} style={styles.accountHeader}>
      <View style={styles.avatar}><BthwaniIcon name="account" color={theme.brandAction} size={21}/></View>
      <View style={styles.accountText}><Text style={styles.accountName} numberOfLines={1}>{identity.name}</Text><Text style={styles.accountRole} numberOfLines={1}>{identity.role}</Text></View>
      <BthwaniIcon name="edit" size={17} color={theme.colorMuted}/>
    </Pressable>
    {profileExpanded?<View style={styles.profilePanel}><Text style={styles.muted}>هذه هوية المستخدم، وتُعرض الصلاحيات بحسب المتجر المحدد. إعدادات المظهر والدعوات بالأسفل.</Text>
      {selectedStore?<Text style={styles.accountRole}>المتجر الحالي: {selectedStore.name}</Text>:null}
      <Text style={styles.accountRole}>الصفة: {identity.role}</Text>
    </View>:null}
    {stores.length>1?<PartnerStoreScopeSelector/>:null}
    {state.kind==="error"?<View style={styles.panel}><Text style={styles.muted}>تعذر تحميل المتاجر.</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={()=>void reload()}/></View>:null}
    {selectedStore?<View style={styles.storeHero}>
      <Pressable accessibilityRole="button" accessibilityLabel={"غلاف وشعار المتجر "+selectedStore.name+"، فتح ملف المتجر"}
        onPress={()=>router.push({pathname:"/store",params:{section:"settings",returnTo:"more"}} as Href)}>
        <View style={styles.coverArea}>
          {storeImages?.storeCoverImage?.uri&&!coverFailed?<Image source={{uri:storeImages.storeCoverImage.uri}} resizeMode="cover" onError={()=>setCoverFailed(true)} style={styles.heroCover}/>:<View style={styles.heroFallback}><BthwaniIcon name="store" color={theme.brandAction} size={30}/></View>}
        </View>
        <View style={styles.heroFooter}>
          <View style={styles.heroLogo}>{storeImages?.storeProfileImage?.uri&&!logoFailed?<Image source={{uri:storeImages.storeProfileImage.uri}} onError={()=>setLogoFailed(true)} style={styles.heroLogoImage}/>:<BthwaniIcon name="store" color={theme.brandAction} size={25}/>}</View>
          <View style={styles.heroText}><Text style={styles.heroName} numberOfLines={1}>{selectedStore.name}</Text><Text style={styles.heroSubtitle}>ملف المتجر والصور</Text></View>
          <BthwaniIcon name="edit" color={theme.brandAction} size={18}/>
        </View>
      </Pressable>
      {canOperate?<Pressable accessibilityRole="button" accessibilityLabel={"التشغيل "+operationalState} style={styles.operationRow}
        onPress={()=>router.push({pathname:"/store",params:{section:"operations",returnTo:"more"}} as Href)}>
        <View style={[styles.dot,{backgroundColor:orderable&&!stopped?theme.success:theme.warning}]}/>
        <Text style={styles.operationLabel}>التشغيل: {operationalState}</Text>
        <Text style={styles.operationAction}>إدارة التشغيل ←</Text>
      </Pressable>:null}
    </View>:null}
    <View style={styles.grid}>{actions.map((item,index)=><Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label}
      onPress={()=>open(item)} style={({pressed})=>[styles.menuCard,pressed&&{opacity:.7}]}>
      <Text style={styles.menuLabel}>{item.label}</Text>
      <View style={[styles.menuIcon,{backgroundColor:index%2===0?theme.actionSoft:theme.surfaceRaised}]}><BthwaniIcon name={item.icon} size={20} color={index%2===0?theme.brandAction:theme.color}/></View>
    </Pressable>)}</View>
    <View style={styles.grid}>
      <Pressable accessibilityRole="button" accessibilityLabel="المظهر" style={styles.utilityCard} onPress={()=>setThemeExpanded(v=>!v)}>
        <BthwaniIcon name="edit" size={19} color={theme.colorMuted}/><Text style={styles.utilityTitle}>المظهر</Text>
        <Text style={styles.utilityHint}>{preference==="system"?"حسب النظام":preference==="dark"?"داكن":"فاتح"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="الدعوات" style={styles.utilityCard} onPress={()=>setInvitesExpanded(v=>!v)}>
        <BthwaniIcon name="account" size={19} color={theme.colorMuted}/><Text style={styles.utilityTitle}>الدعوات</Text>
        <Text style={styles.utilityHint}>دعوات الوصول إليك</Text>
      </Pressable>
    </View>
    {themeExpanded?<View style={styles.panel} accessibilityLabel="خيارات المظهر">
      {([{value:"system",label:"حسب النظام"},{value:"light",label:"فاتح"},{value:"dark",label:"داكن"}] as const).map(option=><Pressable key={option.value}
        accessibilityRole="radio" accessibilityState={{selected:preference===option.value,disabled:themeBusy,busy:themeBusy}}
        onPress={()=>void chooseTheme(option.value)} disabled={themeBusy} style={[styles.themeOption,preference===option.value&&styles.themeSelected]}>
        <Text style={[styles.themeText,preference===option.value&&styles.themeActiveText]}>{option.label}</Text>
      </Pressable>)}
      {themeError?<Text accessibilityRole="alert" style={styles.error}>{themeError}</Text>:null}
    </View>:null}
    {invitesExpanded?<PartnerAccessInvitationsCard/>:null}
    <View style={styles.logout}><BthwaniButton variant="secondary" label={logoutBusy?"جارٍ تسجيل الخروج":"تسجيل الخروج"} disabled={logoutBusy} busy={logoutBusy} onPress={()=>void logout()}/></View>
    {logoutError?<Text accessibilityRole="alert" style={styles.error}>{logoutError}</Text>:null}
  </View>;
}
function createStyles(p:ReturnType<typeof resolveTheme>){return StyleSheet.create({
  screen:{gap:10,paddingTop:4,paddingBottom:18},
  accountHeader:{minHeight:55,flexDirection:"row",alignItems:"center",gap:10,paddingHorizontal:3},
  avatar:{width:40,height:40,borderRadius:20,backgroundColor:p.actionSoft,alignItems:"center",justifyContent:"center"},
  accountText:{flex:1,minWidth:0,gap:3},accountName:{...typography.bodyStrong,color:p.color,fontWeight:"800",fontSize:15},
  accountRole:{...typography.caption,color:p.colorMuted},
  profilePanel:{backgroundColor:p.surface,borderRadius:12,borderWidth:1,borderColor:p.borderColor,padding:12,gap:6},
  panel:{backgroundColor:p.surface,padding:8,borderWidth:1,borderColor:p.borderColor,borderRadius:12,gap:6},
  muted:{...typography.bodySm,color:p.colorMuted},
  storeHero:{backgroundColor:p.surface,borderWidth:1,borderColor:p.borderColor,borderRadius:14,overflow:"hidden"},
  coverArea:{height:103,backgroundColor:p.surfaceRaised,overflow:"hidden"},
  heroCover:{...StyleSheet.absoluteFill,width:"100%",height:"100%"},
  heroFallback:{flex:1,alignItems:"center",justifyContent:"center"},
  heroFooter:{flexDirection:"row",alignItems:"center",minHeight:72,padding:9,gap:10},
  heroLogo:{height:48,width:48,borderRadius:11,backgroundColor:p.surfaceRaised,alignItems:"center",justifyContent:"center",overflow:"hidden"},
  heroLogoImage:{height:"100%",width:"100%"},heroText:{flex:1,minWidth:0,gap:3},
  heroName:{...typography.titleSm,color:p.color,fontWeight:"800"},heroSubtitle:{...typography.caption,color:p.colorMuted},
  operationRow:{minHeight:42,borderTopWidth:1,borderColor:p.borderColor,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:12},
  dot:{width:8,height:8,borderRadius:4},operationLabel:{...typography.caption,color:p.color,flex:1},
  operationAction:{...typography.caption,color:p.brandAction,fontWeight:"800"},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:9,justifyContent:"space-between"},
  menuCard:{width:"48.5%",minHeight:64,padding:11,borderRadius:12,borderWidth:1,borderColor:p.borderColor,backgroundColor:p.surface,flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:6},
  menuLabel:{...typography.bodyStrong,color:p.color,fontSize:13,flex:1},menuIcon:{height:33,width:33,borderRadius:9,alignItems:"center",justifyContent:"center"},
  utilityCard:{width:"48.5%",minHeight:73,borderWidth:1,borderColor:p.borderColor,borderRadius:12,backgroundColor:p.surface,flexDirection:"row",alignItems:"center",justifyContent:"flex-start",gap:8,padding:11,flexWrap:"wrap"},
  utilityTitle:{...typography.bodyStrong,color:p.color,fontSize:13},utilityHint:{...typography.caption,color:p.colorMuted,width:"100%"},
  themeOption:{minHeight:43,borderRadius:9,borderWidth:1,borderColor:p.borderColor,backgroundColor:p.surface,alignItems:"flex-start",justifyContent:"center",paddingHorizontal:12},
  themeSelected:{backgroundColor:p.actionSoft,borderColor:p.brandAction},
  themeText:{...typography.bodySm,color:p.color},themeActiveText:{color:p.brandAction,fontWeight:"800"},
  logout:{paddingTop:7},error:{...typography.bodySm,color:p.warning},
});}
