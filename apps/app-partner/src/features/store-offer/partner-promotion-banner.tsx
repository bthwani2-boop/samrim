import { typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { createDshMobileClient, formatMoney, type PublicDiscoveryContentView, type PublicPromotionView } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Easing, Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";

type BannerMode = "STATIC" | "CINEMATIC" | "CROSSFADE";
type BannerData = Readonly<{ promotion: PublicPromotionView; content: PublicDiscoveryContentView | undefined }>;
function offerLabel(promotion: PublicPromotionView) {
  return promotion.kind === "PERCENTAGE"
    ? `خصم ${promotion.valueMinor}%`
    : `خصم ${formatMoney(promotion.valueMinor, "YER")}`;
}
const service = () => {
  const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!base) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
};

/** Store-scoped, published media. Customer/banner policy controls motion; DSH decides eligible promotions. */
export function PartnerStorePromotionBanner({ storeId, serviceCityId, canManage, offersOnly = false }: Readonly<{
  storeId: string; serviceCityId: string; canManage: boolean; offersOnly?: boolean;
}>) {
  const theme = useAppearanceTheme();
  const router = useRouter();
  const [items, setItems] = useState<ReadonlyArray<BannerData>>([]);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(0);
  const currentIndex = useRef(0);
  const [transition, setTransition] = useState<{index:number;direction:1|-1}|null>(null);
  const inTransition = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const [presentation, setPresentation] = useState<{mode:BannerMode;intervalSeconds:number}>({mode:"CINEMATIC",intervalSeconds:5});
  const [active, setActive] = useState(AppState.currentState === "active");
  const [reducedMotion, setReducedMotion] = useState(false);
  const styles = useMemo(() => StyleSheet.create({
    wrap: { gap: 6 }, banner: { overflow:"hidden", borderRadius:14, height:160, backgroundColor:theme.actionSoft, borderWidth:1, borderColor:theme.borderColor },
    copy: { flex:1, justifyContent:"flex-end", padding:13, gap:4, backgroundColor:"rgba(0,0,0,0.48)" },
    title: { ...typography.titleSm, fontWeight:"800", color:"#FFFFFF" },
    benefit: { ...typography.bodyStrong, color:"#FFFFFF" },
    dots: { flexDirection:"row", justifyContent:"center", gap:5 },
    dot: { width:5, height:5, borderRadius:3, backgroundColor:theme.colorMuted },
    selectedDot: { width:13, backgroundColor:theme.brandAction },
    action: { alignSelf:"flex-start", minHeight:32, justifyContent:"center" },
    actionText: { ...typography.caption, fontWeight:"700", color:theme.brandAction },
    empty: { ...typography.bodySm, color:theme.colorMuted, paddingVertical:8 },
  }), [theme]);
  useFocusEffect(useCallback(() => {
    let mounted = true;
    setItems([]); setError(false); setIndex(0); currentIndex.current=0;
    if (!storeId || !serviceCityId) return;
    const load = async () => {
      try {
        const api=service();
        const [eligible, discovery]=await Promise.all([
          api.listPublicPromotions(serviceCityId,storeId),
          api.listPublicDiscoveryContent(serviceCityId),
        ]);
        const promos=eligible.promotions;
        const ids=new Set(promos.map(p=>p.id));
        // Resolve only published banner candidates; never display another store's marketing asset.
        const candidates=discovery.items.filter(item=>item.kind==="BANNER"&&item.mediaKind!=="video"&&Boolean(item.mediaUri)
          && (item.targetType==="PROMOTION"&&ids.has(item.targetId??"")||item.targetType==="STORE"&&item.targetId===storeId)).slice(0,40);
        const targets=await Promise.all(candidates.map(async item=>{
          try { return {item,target:await api.resolvePublicDiscoveryContentTarget(item.id,serviceCityId)}; }
          catch {return null;}
        }));
        const safe=targets.filter((entry):entry is NonNullable<typeof entry>=>Boolean(entry&&entry.target.storeId===storeId));
        const mediaByPromo=new Map<string,PublicDiscoveryContentView>();
        const defaultMedia=safe.find(entry=>entry.item.targetType==="STORE")?.item;
        for (const entry of safe) if(entry.target.promotionId)mediaByPromo.set(entry.target.promotionId,entry.item);
        const mapped=promos.map(promotion=>({promotion,content:mediaByPromo.get(promotion.id)??defaultMedia}));
        if(mounted) setItems(mapped);
      } catch {if(mounted){setError(true);setItems([]);}}
    };
    void load();
    return () => {mounted=false;};
  },[storeId,serviceCityId]));
  useEffect(()=>{
    let mounted=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReducedMotion(value);}).catch(()=>{});
    const subscription=AccessibilityInfo.addEventListener("reduceMotionChanged",setReducedMotion);
    const app=AppState.addEventListener("change",state=>setActive(state==="active"));
    return ()=>{mounted=false;subscription.remove();app.remove();progress.stopAnimation();};
  },[progress]);
  useFocusEffect(useCallback(()=>{
    let mounted=true;
    const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if(!base)return;
    const refresh=async()=>{
      try {
        const response=await fetch(base+"/dsh/public/banner-presentation",{headers:{Accept:"application/json"}});
        if(!response.ok)return;
        const value=await response.json() as {mode:BannerMode;intervalSeconds:number};
        if(mounted&&["STATIC","CINEMATIC","CROSSFADE"].includes(value.mode)
          &&Number.isInteger(value.intervalSeconds)&&value.intervalSeconds>=3&&value.intervalSeconds<=10) setPresentation(value);
      }catch{/* Keep last valid presentation while offline. */}
    };
    void refresh();
    const interval=setInterval(()=>void refresh(),60000);
    return ()=>{mounted=false;clearInterval(interval);};
  },[]));
  const navigate=useCallback((direction:1|-1)=>{
    if(items.length<2||inTransition.current)return;
    const next=(currentIndex.current+direction+items.length)%items.length;
    if(reducedMotion||width===0){currentIndex.current=next;setIndex(next);return;}
    inTransition.current=true;setTransition({index:next,direction});progress.setValue(0);
    Animated.timing(progress,{toValue:1,duration:480,easing:Easing.out(Easing.cubic),useNativeDriver:true})
      .start(()=>{currentIndex.current=next;setIndex(next);requestAnimationFrame(()=>{progress.setValue(0);setTransition(null);inTransition.current=false;});});
  },[items.length,reducedMotion,width,progress]);
  const navigateRef=useRef(navigate);navigateRef.current=navigate;
  const gesture=useMemo(()=>PanResponder.create({
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>15&&Math.abs(g.dx)>Math.abs(g.dy)*1.3,
    onPanResponderRelease:(_,g)=>{if(Math.abs(g.dx)>30)navigateRef.current(g.dx<0?1:-1);},
  }),[]);
  useEffect(()=>{
    if(!active||reducedMotion||presentation.mode==="STATIC"||items.length<2)return;
    const timer=setInterval(()=>navigateRef.current(1),presentation.intervalSeconds*1000);
    return ()=>clearInterval(timer);
  },[active,reducedMotion,presentation,items.length]);
  const openManagement=()=>{if(canManage)router.push("/store?section=promotions&returnTo=products" as Href);};
  const current=items[index];
  if(!current) return offersOnly?<View style={styles.wrap}><Text style={styles.empty}>{error?"تعذر تحميل العروض حاليًا.":"لا توجد عروض منشورة حاليًا."}</Text>
    {canManage?<Pressable accessibilityRole="button" onPress={openManagement} style={styles.action}><Text style={styles.actionText}>إدارة العروض</Text></Pressable>:null}</View>:null;
  const slide=(item:BannerData,layerStyle:object)=><Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,layerStyle]}>
    {item.content?<Image source={{uri:item.content.mediaUri}} resizeMode="cover" style={StyleSheet.absoluteFill}/>:null}
    <View style={styles.copy}><Text style={styles.title} numberOfLines={2}>{item.promotion.nameAr}</Text>
      <Text style={styles.benefit}>{offerLabel(item.promotion)}</Text></View>
  </Animated.View>;
  const fade=presentation.mode==="CROSSFADE";
  const outgoing=transition?(fade?{opacity:progress.interpolate({inputRange:[0,1],outputRange:[1,0]})}:{transform:[{translateX:progress.interpolate({inputRange:[0,1],outputRange:[0,-transition.direction*width]})}]}):{};
  const incoming=transition?(fade?{opacity:progress}:{transform:[{translateX:progress.interpolate({inputRange:[0,1],outputRange:[transition.direction*width,0]})}]}):{};
  return <View style={styles.wrap} accessibilityLabel="بنرات عروض المتجر المنشورة">
    <View style={styles.banner} onLayout={event=>setWidth(event.nativeEvent.layout.width)} {...gesture.panHandlers}>
      <Pressable accessibilityRole="button" accessibilityLabel={current.promotion.nameAr} onPress={openManagement} style={StyleSheet.absoluteFill}>
        {slide(current,outgoing)}
        {transition&&items[transition.index]?slide(items[transition.index]!,incoming):null}
      </Pressable>
    </View>
    {items.length>1?<View style={styles.dots}>{items.map((item,i)=><View key={item.promotion.id} style={[styles.dot,index===i&&styles.selectedDot]}/>)}</View>:null}
    {offersOnly&&canManage?<Pressable accessibilityRole="button" style={styles.action} onPress={openManagement}><Text style={styles.actionText}>إدارة العروض</Text></Pressable>:null}
  </View>;
}
