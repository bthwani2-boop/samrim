import { Button, Host } from "@expo/ui";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import { type resolveTheme, typography } from "@bthwani/design-system";
import { AppearancePicker, BthwaniButton, BthwaniIcon, type MobileIconName, useMobileAppearance } from "@bthwani/design-system/native";
import type { PartnerStoreOperationalAvailabilityResponse, StoreAccessGrant, StoreImagesResponse } from "@bthwani/dsh";
import { Image as ExpoImage } from "expo-image";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { currentIdentityState, logoutIdentity, subscribeIdentitySession } from "../../bootstrap/identity";
import { PartnerPerformancePeek } from "./partner-performance-peek";
import { PartnerInsights } from "./partner-insights";
import { PartnerDesktopHome } from "./partner-desktop-home";
import { readOwnStoreCommercialAgreements } from "./store-commercial-agreement-client";
import { agreementReadinessMessage, ownStoreAgreementReadiness, type StoreAgreementReadback } from "./store-agreement-readiness";
import { dispatchPartnerProductAction } from "../../shell/partner-product-actions";
import { usePartnerStoreScope } from "./partner-store-scope-context";
import { PartnerStoreScopeSelector } from "./partner-store-scope-selector";
import { PartnerStorefrontLink } from "./partner-storefront-link";
import { onStoreAvailabilityChanged } from "./store-availability-events";
import { listOwnStoreAccessInvitations, readOwnJoiningCase, readOwnStoreImages, readOwnStoreOperationalAvailability } from "./store-readback-client";

type MenuItem = Readonly<{label:string;icon:MobileIconName;href?:Href;section?:"promotions"|"team";description?:string}>;
type IdentityDisplay = Readonly<{name:string;role:string;phone?:string}>;
function roleForPermissions(values:ReadonlyArray<string>) {
  const unique=new Set(values);
  if(unique.size===1 && unique.has("orders")) return "موظف طلبات";
  if(unique.size===1 && unique.has("catalog")) return "مسؤول الكتالوج";
  if(unique.size===1 && unique.has("finance_read")) return "اطلاع مالي";
  if(unique.has("store_operations") && unique.has("orders")) return "مسؤول تشغيل المتجر";
  return "موظف بصلاحيات مخصصة";
}
function actorID() { const state=currentIdentityState(); return state.kind==="authenticated"?state.identity.subject:""; }

export function PartnerMore({ accountOnly = false }: { accountOnly?: boolean } = {}) {
  const router=useRouter();
  const {theme,themeName}=useMobileAppearance();
  const {width}=useWindowDimensions();
  const desktopWeb=Platform.OS==="web"&&width>=1024;
  const today=new Date();
  const displayDate=new Intl.DateTimeFormat("ar-YE",{timeZone:"Asia/Aden",day:"numeric",month:"long",year:"numeric"}).format(today);
  const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Aden",hour:"2-digit",hourCycle:"h23"}).format(today));
  const greeting=hour<12?"صباح الخير":"مساء الخير";
  const styles=useMemo(()=>createStyles(theme,desktopWeb),[theme,desktopWeb]);
  const {selectedStore,stores,state,reload}=usePartnerStoreScope();
  const [actor,setActor]=useState(actorID);
  const [diagnosticNotice, setDiagnosticNotice] = useState("");
  const [identity,setIdentity]=useState<IdentityDisplay>({name:"الحساب الحالي",role:"جارٍ التحقق من الصفة"});
  const [needsJoiningCorrection,setNeedsJoiningCorrection]=useState(false);
  const [availability,setAvailability]=useState<PartnerStoreOperationalAvailabilityResponse|null>(null);
  const [availabilityError,setAvailabilityError]=useState(false);
  const [agreementState,setAgreementState]=useState<Readonly<{ actor: string; storeId: string; status: Exclude<StoreAgreementReadback, null> }> | null>(null);
  const [storeImages,setStoreImages]=useState<StoreImagesResponse|null>(null);
  const [coverFailed,setCoverFailed]=useState(false);
  const [logoFailed,setLogoFailed]=useState(false);
  const [logoutBusy,setLogoutBusy]=useState(false);
  const [logoutError,setLogoutError]=useState("");
  const selectedID=selectedStore?.id;
  const canOperate=Boolean(selectedStore && (selectedStore.owned||selectedStore.permissions.includes("store_operations")));
  const can=(permission:"promotions"|"catalog")=>Boolean(selectedStore&&(selectedStore.owned||selectedStore.permissions.includes(permission)));
  const canOrders=Boolean(selectedStore&&(selectedStore.owned||selectedStore.permissions.includes("orders")));
  const canWallet=Boolean(selectedStore&&(selectedStore.owned||selectedStore.permissions.includes("finance_read")||selectedStore.permissions.includes("payout_request")));
  const storeID=canOperate?selectedID:undefined;

  useFocusEffect(useCallback(()=>{
    const unsub=subscribeIdentitySession(()=>setActor(actorID()));
    setActor(actorID());
    return unsub;
  },[]));
  useFocusEffect(useCallback(()=>{
    let active=true;
    setIdentity({name:"الحساب الحالي",role:"جارٍ التحقق من الصفة"});
    setNeedsJoiningCorrection(false);
    if(!actor || !selectedStore) return ()=>{active=false;};
    const resolve=async()=>{
      if(selectedStore.owned){
        try {
          const result=await readOwnJoiningCase();
          if(active) {
            setIdentity({name:result.case.ownerFullName?.trim()||"مالك الحساب",role:"مالك الشريك",phone:result.case.contactPhoneE164?.trim()});
            setNeedsJoiningCorrection(result.case.state==="needs_correction");
          }
        } catch {
          if(active)setIdentity({name:"مالك الحساب",role:"مالك الشريك"});
        }
        return;
      }
      try {
        const page=await listOwnStoreAccessInvitations();
        const grant:StoreAccessGrant|undefined=page.items.find(item=>item.storeId===selectedStore.id&&item.delegateActorId===actor&&item.state==="active");
        if(active)setIdentity({name:grant?.displayNameAr?.trim()||grant?.delegateBeneficiaryName?.trim()||"الحساب الحالي",
          role:grant?roleForPermissions(grant.permissions):roleForPermissions(selectedStore.permissions),phone:grant?.delegatePhoneMasked?.trim()||""});
      } catch {
        if(active)setIdentity({name:"الحساب الحالي",role:roleForPermissions(selectedStore.permissions)});
      }
    };
    void resolve();
    return ()=>{active=false;};
  },[actor,selectedStore]));


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
  useFocusEffect(useCallback(()=>{
    let active=true;
    setAgreementState(null);
    if(accountOnly || !actor || !selectedStore?.owned) return ()=>{active=false;};
    const scope=selectedStore.id;
    const isCurrent=()=>{
      const current=currentIdentityState();
      return active && current.kind==="authenticated" && current.identity.subject===actor;
    };
    void readOwnStoreCommercialAgreements(scope).then(agreements=>{
      if(!isCurrent())return;
      setAgreementState({actor,storeId:scope,status:ownStoreAgreementReadiness(agreements,scope,actor)});
    }).catch(()=>{if(isCurrent())setAgreementState({actor,storeId:scope,status:"UNAVAILABLE"});});
    return ()=>{active=false;};
  },[accountOnly,actor,selectedStore?.id,selectedStore?.owned]));
  const commercialAgreement:StoreAgreementReadback=selectedStore?.owned && actor && agreementState?.actor===actor
    && agreementState.storeId===selectedStore.id ? agreementState.status : null;
  const primaryActions:MenuItem[]=[
    ...(canOrders?[{label:"الطلبات",description:"قبول الطلبات وتجهيزها ومتابعة التسليم",icon:"orders" as const,href:"/orders" as Href}]:[]),
    ...(can("catalog")?[{label:"المنتجات",description:"إضافة المنتجات والأسعار وتحديث التوفر",icon:"cart" as const,href:"/products" as Href}]:[]),
    ...(canWallet?[{label:"المحفظة",description:"متابعة الرصيد والتسويات المصرّح بها",icon:"wallet" as const,href:"/wallet" as Href}]:[]),
  ];
  const actions:MenuItem[]=[
    ...(selectedStore?.owned?[{label:"إعدادات المتجر",icon:"edit" as const,href:"/store?section=settings" as Href}]:[]),
    ...(can("catalog")?[{label:"أدوات الكتالوج",icon:"cart" as const,href:"/products?panel=tools" as Href},{label:"سجل تغييرات العروض",icon:"cart" as const,href:"/activity" as Href}]:[]),
    ...(can("promotions")?[{label:"العروض",icon:"offers" as const,section:"promotions" as const}]:[]),
    ...(selectedStore?.owned?[{label:"الموظفين",icon:"account" as const,href:"/employees" as Href},{label:"كباتن المتجر",icon:"deliveries" as const,section:"team" as const}]:[]),
    {label:"الإشعارات",icon:"notifications" as const,href:"/notifications" as Href},
    {label:"الأداء",icon:"orders",href:"/insights" as Href},
    ...(state.kind==="ready"&&!stores.length?[{label:"إعداد المتجر",icon:"store" as const,href:"/onboarding" as Href}]:[]),
  ];
  const open=(item:MenuItem)=>{
    if(item.section)router.push({pathname:"/store",params:{section:item.section,returnTo:"more"}} as Href);
    else if(item.href){
      if(String(item.href)==="/products") dispatchPartnerProductAction("list");
      if(["/orders","/products","/wallet"].includes(String(item.href)))router.navigate(item.href);
      else router.push((String(item.href)+(String(item.href).includes("?")?"&":"?")+"returnTo=more") as Href);
    }
  };
  async function logout(){
    if(logoutBusy)return;
    setLogoutBusy(true);setLogoutError("");
    try{await logoutIdentity();}catch{setLogoutError("تعذر تسجيل الخروج. تحقق من الاتصال وحاول مجددًا.");}
    finally{setLogoutBusy(false);}
  }
  return <View style={styles.screen}>
    {!accountOnly ? <>
    {desktopWeb && selectedStore ? <View style={styles.topAlert} accessibilityLabel="حالة المتجر الحالية">
      <View style={[styles.dot,{backgroundColor:selectedStore.publicationState==="published"?theme.success:theme.warning}]}/>
      <Text style={styles.topAlertText}>{selectedStore.publicationState==="published" ? "المتجر منشور للعملاء" : "المتجر لم يُنشر للعملاء بعد"}</Text>
      <Text style={styles.topAlertHint}>{canOperate ? "استقبال الطلبات: "+operationalState : "الحالة تعتمد على نشر المتجر والصلاحيات"}</Text>
    </View> : null}
    <View style={styles.dashboardHeader}>
      <View style={styles.dashboardCopy}>
        <Text style={styles.dashboardEyebrow}>لوحة الشريك</Text>
        <Text accessibilityRole="header" style={styles.dashboardTitle} numberOfLines={2}>{desktopWeb?greeting+", ":"مرحبًا، "}{identity.name}</Text>
        <Text style={styles.dashboardSubtitle} numberOfLines={2}>{selectedStore ? selectedStore.name+" · "+identity.role : identity.role}</Text>
      </View>
      {desktopWeb?<View style={styles.dateColumn}>
        <Text style={styles.dateLabel}>اليوم: {displayDate}</Text>
        <Text style={styles.statusText}>{selectedStore?(canOperate?"التشغيل: "+operationalState:selectedStore.publicationState==="published"?"متجر منشور":"متجر قيد الإعداد"):"لوحة الشريك"}</Text>
      </View>:selectedStore?<View style={styles.statusPanel}>
        <View style={styles.statusLine}>
          <View style={[styles.dot,{backgroundColor:availabilityError?theme.warning:orderable&&!stopped?theme.success:theme.warning}]}/>
          <Text style={styles.statusText}>{canOperate ? "استقبال الطلبات: "+operationalState : "المتجر: "+(selectedStore.publicationState==="published"?"منشور":"قيد الإعداد")}</Text>
        </View>
        {canOperate?<Pressable accessibilityRole="button" accessibilityLabel="فتح إدارة تشغيل المتجر" style={styles.statusButton}
          onPress={()=>router.push({pathname:"/store",params:{section:"operations",returnTo:"more"}} as Href)}>
          <Text style={styles.statusButtonText}>إدارة التشغيل</Text>
          <BthwaniIcon name="store" color={theme.interactiveText} size={16}/>
        </Pressable>:null}
      </View>:null}
    </View>
    {stores.length>1?<PartnerStoreScopeSelector/>:null}
    {selectedStore?.owned && needsJoiningCorrection ? <Pressable accessibilityRole="button" accessibilityLabel="مراجعة التصحيح المطلوب في طلب انضمام المتجر"
      style={styles.correctionNotice} onPress={()=>router.push("/onboarding" as Href)}>
      <BthwaniIcon name="warning" color={theme.warning} size={21}/>
      <View style={{flex:1,gap:4}}>
        <Text style={styles.correctionTitle}>يحتاج ملف الانضمام إلى تصحيح</Text>
        <Text style={styles.readinessHint}>راجع الملاحظات المطلوبة من قسم الشراكات وأعد إرسال التصحيح.</Text>
      </View>
      <BthwaniIcon name="back" color={theme.warning} size={18}/>
    </Pressable> : null}
    {state.kind==="error"?<View style={styles.panel}><Text style={styles.muted}>تعذر تحميل المتاجر.</Text><BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={()=>void reload()}/></View>:null}
    {primaryActions.length>0 && !desktopWeb ? <View style={styles.dashboardSection}>
      <Text style={styles.sectionTitle}>العمل اليومي</Text>
      <View style={styles.quickGrid}>
        {primaryActions.map(item=><Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={()=>open(item)}
          style={({pressed})=>[styles.quickCard,pressed&&{opacity:.75}]}>
          <View style={styles.quickIcon}><BthwaniIcon name={item.icon} color={theme.brandAction} size={22}/></View>
          <View style={styles.quickText}>
            <Text style={styles.quickTitle}>{item.label}</Text>
            <Text style={styles.quickDescription}>{item.description}</Text>
          </View>
          <BthwaniIcon name="back" color={theme.colorMuted} size={15}/>
        </Pressable>)}
      </View>
    </View>:null}
    {selectedStore && desktopWeb ? <PartnerDesktopHome key={"home:"+selectedStore.id} store={selectedStore} operationalState={operationalState} operationalKnown={Boolean(availability&&!availabilityError)} canOperate={canOperate} commercialAgreement={commercialAgreement}/> : selectedStore ? <View style={styles.dashboardSection}>
      <Text style={styles.sectionTitle}>نظرة على المتجر</Text>
      <PartnerInsights embedded/>
    </View> : null}
    {!desktopWeb ? <View style={styles.dashboardSection}>
    <Text style={styles.sectionTitle}>إدارة المتجر</Text>
    <View style={styles.grid}>{actions.map((item,index)=><Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label}
      onPress={()=>open(item)} style={({pressed})=>[styles.menuCard,pressed&&{opacity:.7}]}>
      <Text style={styles.menuLabel}>{item.label}</Text>
      <View style={[styles.menuIcon,{backgroundColor:index%2===0?theme.actionSoft:theme.surfaceRaised}]}><BthwaniIcon name={item.icon} size={20} color={index%2===0?theme.brandAction:theme.color}/></View>
    </Pressable>)}</View>
    </View> : null}
    {!desktopWeb?<PartnerPerformancePeek store={selectedStore}/>:null}
    {!desktopWeb?<Text style={styles.sectionTitle}>ملف المتجر وإعداداته</Text>:null}
    {selectedStore?.owned && !desktopWeb ? <Pressable accessibilityRole="button"
      accessibilityLabel={"مراجعة الاتفاقية التجارية: "+agreementReadinessMessage(commercialAgreement)}
      style={styles.quickCard} onPress={()=>router.push({pathname:"/store",params:{section:"settings",returnTo:"more"}} as Href)}>
      <View style={styles.quickIcon}><BthwaniIcon name="wallet" color={commercialAgreement==="ACTIVE"?theme.success:theme.brandAction} size={22}/></View>
      <View style={styles.quickText}>
        <Text style={styles.quickTitle}>الاتفاقية التجارية</Text>
        <Text style={styles.quickDescription}>{agreementReadinessMessage(commercialAgreement)}</Text>
      </View>
      <BthwaniIcon name="back" color={theme.colorMuted} size={16}/>
    </Pressable> : null}
    {selectedStore&&!desktopWeb?<View style={styles.storeHero}>
      <Pressable disabled={!selectedStore.owned} accessibilityRole={selectedStore.owned?"button":undefined} accessibilityLabel={"ملف المتجر "+selectedStore.name+(selectedStore.owned?"، فتح إعدادات المتجر":"، للعرض فقط")}
        onPress={selectedStore.owned?()=>router.push({pathname:"/store",params:{section:"settings",returnTo:"more"}} as Href):undefined}>
        {!desktopWeb?<View style={styles.coverArea}>
          {storeImages?.storeCoverImage?.uri&&!coverFailed?<ExpoImage cachePolicy="memory" source={{uri:storeImages.storeCoverImage.uri}} contentFit="cover" onError={()=>setCoverFailed(true)} style={styles.heroCover}/>:<View style={styles.heroFallback}><BthwaniIcon name="store" color={theme.brandAction} size={30}/></View>}
        </View>:null}
        <View style={styles.heroFooter}>
          <View style={styles.heroLogo}>{storeImages?.storeProfileImage?.uri&&!logoFailed?<ExpoImage cachePolicy="memory" source={{uri:storeImages.storeProfileImage.uri}} onError={()=>setLogoFailed(true)} style={styles.heroLogoImage}/>:<BthwaniIcon name="store" color={theme.brandAction} size={25}/>}</View>
          <View style={styles.heroText}><Text style={styles.heroName} numberOfLines={1}>{selectedStore.name}</Text><Text style={styles.heroSubtitle}>{selectedStore.owned?"ملف المتجر والصور":"بيانات المتجر للعرض فقط"}</Text></View>
          {selectedStore.owned?<BthwaniIcon name="edit" color={theme.brandAction} size={18}/>:null}
        </View>
      </Pressable>
      {canOperate?<Pressable accessibilityRole="button" accessibilityLabel={"التشغيل "+operationalState} style={styles.operationRow}
        onPress={()=>router.push({pathname:"/store",params:{section:"operations",returnTo:"more"}} as Href)}>
        <View style={[styles.dot,{backgroundColor:orderable&&!stopped?theme.success:theme.warning}]}/>
        <Text style={styles.operationLabel}>التشغيل: {operationalState}</Text>
        <Text style={styles.operationAction}>إدارة التشغيل ←</Text>
      </Pressable>:null}
    </View>:null}

    {selectedStore ? <PartnerStorefrontLink key={selectedStore.id} store={selectedStore} /> : null}
    {desktopWeb?<View style={styles.desktopFooter}><Text style={styles.muted}>© بثواني {today.getFullYear()} — لوحة الشريك</Text><Text style={styles.muted}>البيانات من الخدمات المصرح بها للمتجر الحالي.</Text></View>:null}
    </> : null}
    {(accountOnly || !desktopWeb) ? <>
    <Text style={styles.sectionTitle}>الحساب والتفضيلات</Text>
    <View accessible accessibilityLabel={"هوية الحساب "+identity.name+"، "+identity.role+(identity.phone?"، "+identity.phone:"")} style={styles.accountHeader}>
      <View style={styles.avatar}><BthwaniIcon name="account" color={theme.brandAction} size={21}/></View>
      <View style={styles.accountText}>
        <Text style={styles.accountName} numberOfLines={1}>{identity.name}</Text>
        <Text style={styles.accountRole} numberOfLines={1}>
          {identity.role}
          {identity.phone?<Text style={styles.accountPhone}>{"  ·  \u2066"+identity.phone+"\u2069"}</Text>:null}
        </Text>
      </View>
    </View>
    <AppearancePicker compact title="المظهر" helper="" />
    <Pressable accessibilityRole="button" accessibilityLabel="نسخ معلومات إصدار التطبيق"
      onPress={() => void Clipboard.setStringAsync([
        "بثواني", Application.nativeApplicationVersion ?? "—",
        "build:" + (Application.nativeBuildVersion ?? "—"),
        Device.modelName ?? "جهاز غير معروف", Device.osVersion ?? "—",
      ].join(" · ")).then(() => setDiagnosticNotice("تم نسخ معلومات إصدار التطبيق")).catch(() => setDiagnosticNotice("تعذر نسخ معلومات التطبيق"))}
      style={{ paddingVertical: 7, alignItems: "center" }}>
      <Text style={{ color: theme.colorMuted, fontSize: 12 }}>
        {"إصدار التطبيق " + (Application.nativeApplicationVersion ?? "—") + " · نسخ معلومات الإصدار"}
      </Text>
    </Pressable>
    {diagnosticNotice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{diagnosticNotice}</Text> : null}
    <View style={styles.logout}>
      <Host colorScheme={themeName} matchContents seedColor={theme.brandAction}>
        <Button disabled={logoutBusy} label={logoutBusy?"جارٍ تسجيل الخروج":"تسجيل الخروج"} onPress={()=>void logout()} testID="partner-more-logout" variant="outlined" />
      </Host>
    </View>
    {logoutError?<Text accessibilityRole="alert" style={styles.error}>{logoutError}</Text>:null}
    </> : null}
  </View>;
}
function createStyles(p:ReturnType<typeof resolveTheme>,desktopWeb:boolean){return StyleSheet.create({
  screen:{gap:desktopWeb?18:10,paddingTop:desktopWeb?16:4,paddingBottom:24},
  sectionTitle:{...typography.titleSm,color:p.color,fontWeight:"800",paddingTop:4},
  dashboardSection:{gap:12},
  correctionNotice:{backgroundColor:p.warningSoft,borderWidth:1,borderColor:p.warning,borderRadius:12,padding:14,flexDirection:"row",alignItems:"center",gap:12},
  correctionTitle:{...typography.bodyStrong,color:p.warning,fontWeight:"800"},
  topAlert:{backgroundColor:p.warningSoft,borderWidth:1,borderColor:p.warning,borderRadius:12,flexDirection:"row",alignItems:"center",flexWrap:"wrap",minHeight:46,paddingHorizontal:16,paddingVertical:10,gap:10},
  topAlertText:{...typography.bodySm,color:p.color,fontWeight:"800"},
  topAlertHint:{...typography.caption,color:p.colorMuted,flex:1,textAlign:"left"},
  setupBoard:{backgroundColor:p.surface,borderWidth:1,borderColor:p.borderColor,borderRadius:16,padding:desktopWeb?20:12,gap:16},
  setupHeading:{gap:5},
  setupTitle:{...typography.titleMd,color:p.color,fontWeight:"800"},
  readinessGrid:{flexDirection:"row",flexWrap:"wrap",gap:10},
  readinessCard:{flexGrow:1,flexBasis:200,minWidth:190,minHeight:108,backgroundColor:p.surfaceInset,borderWidth:1,borderColor:p.borderColor,borderRadius:12,padding:14,gap:7},
  readinessLabel:{...typography.caption,color:p.colorMuted,fontWeight:"700"},
  readinessValue:{...typography.bodyStrong,color:p.color,fontWeight:"800"},
  readinessHint:{...typography.caption,color:p.colorMuted},
  readinessAction:{...typography.caption,color:p.brandAction,fontWeight:"800"},
  dashboardHeader:{backgroundColor:desktopWeb?"transparent":p.surface,borderWidth:desktopWeb?0:1,borderColor:p.borderColorStrong,borderRadius:18,padding:desktopWeb?6:16,flexDirection:"row",flexWrap:"wrap",gap:16,alignItems:"center",justifyContent:"space-between"},
  dateColumn:{alignItems:"flex-start",gap:7,paddingHorizontal:12,paddingVertical:9,borderRadius:11,backgroundColor:p.surface,borderWidth:1,borderColor:p.borderColor},
  dateLabel:{...typography.bodySm,color:p.color,fontWeight:"700"},
  desktopFooter:{paddingVertical:13,borderTopColor:p.borderColor,borderTopWidth:1,flexDirection:"row",justifyContent:"space-between",gap:12},
  dashboardCopy:{flex:1,minWidth:220,gap:6},
  dashboardEyebrow:{...typography.caption,color:p.brandAction,fontWeight:"800"},
  dashboardTitle:{...typography.titleLg,color:p.color,fontWeight:"800"},
  dashboardSubtitle:{...typography.bodySm,color:p.colorMuted},
  statusPanel:{backgroundColor:p.surfaceInset,padding:12,borderRadius:12,gap:11,minWidth:desktopWeb?220:0},
  statusLine:{flexDirection:"row",alignItems:"center",gap:8},
  statusText:{...typography.bodySm,color:p.color,fontWeight:"700"},
  statusButton:{borderRadius:9,backgroundColor:p.actionSoft,minHeight:38,paddingHorizontal:11,flexDirection:"row",gap:8,alignItems:"center",justifyContent:"space-between"},
  statusButtonText:{...typography.label,color:p.interactiveText,fontWeight:"800"},
  quickGrid:{flexDirection:"row",flexWrap:"wrap",gap:10},
  quickCard:{width:desktopWeb?"32.2%":"100%",minHeight:88,backgroundColor:p.surface,borderColor:p.borderColor,borderWidth:1,borderRadius:14,padding:14,flexDirection:"row",alignItems:"center",gap:12},
  quickIcon:{width:43,height:43,borderRadius:12,backgroundColor:p.actionSoft,alignItems:"center",justifyContent:"center"},
  quickText:{flex:1,gap:5,minWidth:0},
  quickTitle:{...typography.bodyStrong,color:p.color,fontWeight:"800"},
  quickDescription:{...typography.caption,color:p.colorMuted},
  accountHeader:{minHeight:55,flexDirection:"row",alignItems:"center",gap:10,paddingHorizontal:3},
  avatar:{width:40,height:40,borderRadius:20,backgroundColor:p.actionSoft,alignItems:"center",justifyContent:"center"},
  accountText:{flex:1,minWidth:0,gap:3},accountName:{...typography.bodyStrong,color:p.color,fontWeight:"800",fontSize:15},
  accountRole:{...typography.caption,color:p.colorMuted},
  accountPhone:{...typography.caption,color:p.colorMuted,fontVariant:["tabular-nums"]},
  panel:{backgroundColor:p.surface,padding:8,borderWidth:1,borderColor:p.borderColor,borderRadius:12,gap:6},
  muted:{...typography.bodySm,color:p.colorMuted},
  storeHero:{backgroundColor:p.surface,borderWidth:1,borderColor:p.borderColor,borderRadius:14,overflow:"hidden"},
  coverArea:{height:82,backgroundColor:p.surfaceRaised,overflow:"hidden"},
  heroCover:{...StyleSheet.absoluteFill,width:"100%",height:"100%"},
  heroFallback:{flex:1,alignItems:"center",justifyContent:"center"},
  heroFooter:{flexDirection:"row",alignItems:"center",minHeight:60,padding:9,gap:10},
  heroLogo:{height:42,width:42,borderRadius:11,backgroundColor:p.surfaceRaised,alignItems:"center",justifyContent:"center",overflow:"hidden"},
  heroLogoImage:{height:"100%",width:"100%"},heroText:{flex:1,minWidth:0,gap:3},
  heroName:{...typography.titleSm,color:p.color,fontWeight:"800"},heroSubtitle:{...typography.caption,color:p.colorMuted},
  operationRow:{minHeight:42,borderTopWidth:1,borderColor:p.borderColor,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:12},
  dot:{width:8,height:8,borderRadius:4},operationLabel:{...typography.caption,color:p.color,flex:1},
  operationAction:{...typography.caption,color:p.brandAction,fontWeight:"800"},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:9,justifyContent:"space-between"},
  menuCard:{width:desktopWeb?"24%":"48.5%",minHeight:64,padding:11,borderRadius:12,borderWidth:1,borderColor:p.borderColor,backgroundColor:p.surface,flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:6},
  menuLabel:{...typography.bodyStrong,color:p.color,fontSize:13,flex:1},menuIcon:{height:33,width:33,borderRadius:9,alignItems:"center",justifyContent:"center"},
  logout:{paddingTop:7},error:{...typography.bodySm,color:p.warning},
});}
