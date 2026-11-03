import { type DiscoveryContentView, type OperatorDiscoveryContentRegistryResponse } from "@bthwani/dsh";
import { radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Image as ExpoImage } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type Banner = DiscoveryContentView;
type Target = Readonly<{ targetType: "PRODUCT" | "PROMOTION"; targetId: string; label: string }>;
type TargetType = "STORE" | "PRODUCT" | "PROMOTION";
type Attempt = Readonly<{ fingerprint: string; contentId: string; idempotencyKey: string; correlationId: string; startsAt: string }>;
const maxImageBytes = 10 * 1024 * 1024;
const labels: Record<TargetType, string> = { STORE: "المتجر", PRODUCT: "منتج", PROMOTION: "عرض" };
function endpoint(storeId: string): string {
  const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim().replace(/\/$/, "");
  if (!base || !/^https?:\/\//.test(base)) throw new Error("DSH_BASE_URL_REQUIRED");
  return `${base}/dsh/partner/stores/${encodeURIComponent(storeId)}`;
}
function isoInput(value: string): string | null {
  const date = new Date(value);
  return value.trim() && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function status(value: Banner): string {
  if (value.state === "DRAFT") return "بانتظار اعتماد التسويق";
  if (value.state === "PAUSED") return "أوقفته إدارة بثواني";
  if (!value.partnerEnabled) return "أوقفته أنت";
  if (new Date(value.startsAt).getTime() > Date.now()) return "مجدول";
  if (value.endsAt && new Date(value.endsAt).getTime() <= Date.now()) return "انتهى";
  return "منشور";
}

export function PartnerStoreBanners({ storeId, storeName }: Readonly<{ storeId: string; storeName: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    root: { gap: spacing[3] },
    panel: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderWidth: 1, borderRadius: radius.lg, padding: spacing[3], gap: spacing[3] },
    title: { ...typography.titleSm, color: theme.color, textAlign: "right" },
    body: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    label: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    input: { minHeight: 48, paddingHorizontal: spacing[3], borderColor: theme.borderColorStrong, borderWidth: 1, borderRadius: radius.md, color: theme.color, backgroundColor: theme.surfaceInset, textAlign: "right" },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    chip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], minHeight: 44, borderWidth: 1, borderRadius: radius.md, borderColor: theme.borderColor, justifyContent: "center" },
    selected: { backgroundColor: theme.actionSoft, borderColor: theme.interactiveText },
    chipText: { ...typography.bodySm, color: theme.color },
    tile: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
    image: { width: 130, height: 75, backgroundColor: theme.surfaceInset, borderRadius: radius.sm },
    column: { flex: 1, minWidth: 0, gap: spacing[1] },
    error: { ...typography.bodySm, color: theme.danger, textAlign: "right" },
    checkbox: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[2] },
  }), [theme]);
  const [items,setItems] = useState<ReadonlyArray<Banner>>([]);
  const [targets,setTargets] = useState<ReadonlyArray<Target>>([]);
  const [file,setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title,setTitle] = useState("");
  const [targetType,setTargetType] = useState<TargetType>("STORE");
  const [targetId,setTargetId] = useState(storeId);
  const [priority,setPriority] = useState("0");
  const [startsAt,setStartsAt] = useState("");
  const [endsAt,setEndsAt] = useState("");
  const [rights,setRights] = useState(false);
  const [busy,setBusy] = useState(false);
  const [pendingID,setPendingID] = useState("");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [loading,setLoading] = useState(true);
  const submitAttempt = useRef<Attempt | null>(null);
  const toggleAttempt = useRef<{ id: string; enabled: boolean; version: number; idempotencyKey: string; correlationId: string } | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const token = await getUsableIdentityAccessToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      const base = endpoint(storeId);
      const [banners, destinations] = await Promise.all([
        fetch(base + "/banners", { headers }),
        fetch(base + "/discovery-targets", { headers }),
      ]);
      if (!banners.ok || !destinations.ok) throw new Error("STORE_BANNERS_READ_FAILED");
      const result = await banners.json() as OperatorDiscoveryContentRegistryResponse;
      const selection = await destinations.json() as { targets: ReadonlyArray<Target> };
      if (request.current === current) { setItems(result.items); setTargets(selection.targets); setError(""); }
    } catch {
      if (request.current === current) setError("تعذر تحميل بنرات المتجر. تحقق من اتصالك وصلاحية التسويق ثم أعد المحاولة.");
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    setItems([]);setTargets([]);setFile(null);setTitle("");setTargetType("STORE");setTargetId(storeId);
    setPriority("0");setStartsAt("");setEndsAt("");setRights(false);setNotice("");setError("");
    submitAttempt.current = null;toggleAttempt.current = null;
    void refresh();
    return () => {request.current++};
  }, [refresh,storeId]);

  const choose = async () => {
    setError("");
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg","image/png"], copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets[0]) return;
      const next = picked.assets[0];
      if (!next.size || next.size > maxImageBytes || !["image/jpeg","image/png"].includes(next.mimeType ?? "")) {
        setError("اختر صورة JPEG أو PNG بحجم لا يتجاوز 10 ميجابايت.");return;
      }
      setFile(next);submitAttempt.current=null;
    } catch {setError("تعذر اختيار الصورة. أعد المحاولة.");}
  };
  const create = async () => {
    if (busy || !file || !rights || title.trim().length < 2 || !targetId) return;
    const ordinal = Number(priority.trim());
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 1000) {setError("ترتيب العرض يجب أن يكون عددًا بين 0 و1000.");return;}
    const first = startsAt.trim() ? isoInput(startsAt) : (submitAttempt.current?.startsAt ?? new Date().toISOString());
    const last = endsAt.trim() ? isoInput(endsAt) : null;
    if (!first || (endsAt.trim() && !last) || (last && new Date(last).getTime() <= new Date(first).getTime())) {
      setError("حدد موعد بداية ونهاية صحيحين، على أن تكون النهاية بعد البداية.");return;
    }
    setBusy(true);setNotice("");setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const fingerprint = [storeId,file.uri,file.size,title.trim(),targetType,targetId,ordinal,first,last].join("|");
      if (!submitAttempt.current || submitAttempt.current.fingerprint !== fingerprint) {
        submitAttempt.current = {fingerprint,contentId:"content-"+Crypto.randomUUID(),idempotencyKey:Crypto.randomUUID(),correlationId:Crypto.randomUUID(),startsAt:first};
      }
      const attempt=submitAttempt.current;
      const form = new FormData();
      for (const [key,value] of Object.entries({
        id:attempt.contentId,kind:"BANNER",titleAr:title.trim(),targetType,targetId,startsAt:attempt.startsAt,
        endsAt:last??"",ordinal:String(ordinal),creator:storeName,sourceDescription:"صورة بنر رفعها الشريك من متجره في بثواني",
        rightsStatement:"أقر بامتلاكي حقوق الصورة وبسماح استخدامها للإعلان داخل متجري في بثواني.",rightsAttested:"true",
      })) form.append(key,value);
      if (Platform.OS === "web") {
        const blob=await fetch(file.uri).then(r=>r.blob());
        form.append("file",blob,file.name);
      } else {
        form.append("file",{uri:file.uri,name:file.name,type:file.mimeType??"image/jpeg"} as unknown as Blob);
      }
      const response=await fetch(endpoint(storeId)+"/discovery-content",{
        method:"POST",headers:{Authorization:`Bearer ${token}`,"Idempotency-Key":attempt.idempotencyKey,"X-Correlation-ID":attempt.correlationId},body:form,
      });
      if (!response.ok) throw new Error("STORE_BANNER_CREATE_FAILED");
      submitAttempt.current=null;setFile(null);setTitle("");setRights(false);setStartsAt("");setEndsAt("");setPriority("0");
      await refresh();setNotice("تم استلام البنر للمراجعة. سيظهر بعد موافقة تسويق بثواني وخلال فترة عرضه.");
    } catch {setError("تعذر تأكيد رفع البنر. أعد المحاولة دون تغيير المدخلات للتحقق من نتيجة الطلب.");}
    finally {setBusy(false);}
  };

  const setVisibility = async (item: Banner, enabled: boolean) => {
    if (pendingID || busy) return;
    setPendingID(item.id);setError("");setNotice("");
    try {
      const token=await getUsableIdentityAccessToken();
      if (!toggleAttempt.current || toggleAttempt.current.id !== item.id || toggleAttempt.current.enabled!==enabled || toggleAttempt.current.version!==item.version) {
        toggleAttempt.current={id:item.id,enabled,version:item.version,idempotencyKey:Crypto.randomUUID(),correlationId:Crypto.randomUUID()};
      }
      const attempt=toggleAttempt.current;
      const response=await fetch(endpoint(storeId)+"/banners/"+encodeURIComponent(item.id)+"/visibility",{
        method:"POST",headers:{Authorization:`Bearer ${token}`,Accept:"application/json","Content-Type":"application/json","Idempotency-Key":attempt.idempotencyKey,"X-Correlation-ID":attempt.correlationId},
        body:JSON.stringify({enabled,expectedVersion:attempt.version}),
      });
      if (!response.ok) throw new Error("STORE_BANNER_VISIBILITY_FAILED");
      toggleAttempt.current=null;
      await refresh();setNotice(enabled?"تم السماح بعرض البنر المعتمد.":"تم إخفاء البنر عن عملاء المتجر.");
    } catch {setError("تعذر تأكيد تغيير عرض البنر. أعد المحاولة أو حدّث القائمة عند حدوث تعارض.");}
    finally {setPendingID("");}
  };
  const available=targets.filter(x=>x.targetType===targetType).slice(0,30);
  return <View style={styles.root} accessibilityLabel="إدارة بنرات المتجر">
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>بنرات متجرك</Text>
      <Text style={styles.body}>اختر صورة لعرض متحرك داخل صفحة متجرك فقط. البنر الرئيسي لتطبيق بثواني تتحكم به إدارة التسويق. مراجعة النشر مطلوبة قبل العرض.</Text>
      <BthwaniButton label={file ? "تغيير الصورة: "+file.name : "اختيار صورة بنر JPEG أو PNG"} onPress={() => void choose()} disabled={busy} variant="secondary"/>
      {file ? <ExpoImage source={{uri:file.uri}} style={{width:"100%",height:150,borderRadius:radius.md}} contentFit="contain" accessibilityLabel="معاينة صورة البنر المحددة"/>:null}
      <TextInput style={styles.input} accessibilityLabel="عنوان البنر" placeholder="عنوان البنر" value={title} onChangeText={value=>{setTitle(value);submitAttempt.current=null;}} maxLength={160} editable={!busy}/>
      <Text style={styles.label}>عند الضغط على البنر</Text>
      <View style={styles.buttons}>{(["STORE","PRODUCT","PROMOTION"] as const).map(kind=><Pressable key={kind} accessibilityRole="radio" accessibilityState={{checked:kind===targetType}} onPress={()=>{setTargetType(kind);setTargetId(kind==="STORE"?storeId:"");submitAttempt.current=null;}} style={[styles.chip,targetType===kind&&styles.selected]}><Text style={styles.chipText}>{labels[kind]}</Text></Pressable>)}</View>
      {targetType!=="STORE"?<View style={styles.buttons}>{available.map(t=><Pressable key={t.targetType+t.targetId} accessibilityRole="radio" accessibilityLabel={t.label} accessibilityState={{checked:targetId===t.targetId}} onPress={()=>{setTargetId(t.targetId);submitAttempt.current=null;}} style={[styles.chip,targetId===t.targetId&&styles.selected]}><Text style={styles.chipText} numberOfLines={2}>{t.label}</Text></Pressable>)}{available.length===0?<Text style={styles.body}>لا توجد وجهات مؤهلة في هذا المتجر.</Text>:null}</View>:null}
      <Text style={styles.body}>أولوية الترتيب: الأصغر يظهر أولًا. المواعيد اختيارية بصيغة 2026-11-03T12:00.</Text>
      <TextInput style={styles.input} accessibilityLabel="ترتيب البنر" placeholder="ترتيب العرض (0 أولًا)" value={priority} onChangeText={value=>{setPriority(value);submitAttempt.current=null;}} keyboardType="numeric"/>
      <TextInput style={styles.input} accessibilityLabel="بداية عرض البنر" placeholder="بداية العرض (اختياري)" value={startsAt} onChangeText={value=>{setStartsAt(value);submitAttempt.current=null;}}/>
      <TextInput style={styles.input} accessibilityLabel="نهاية عرض البنر" placeholder="نهاية العرض (اختياري)" value={endsAt} onChangeText={value=>{setEndsAt(value);submitAttempt.current=null;}}/>
      <Pressable style={styles.checkbox} accessibilityRole="checkbox" accessibilityState={{checked:rights}} onPress={()=>setRights(value=>!value)}>
        <Text style={styles.label}>{rights?"☑":"☐"} أملك حقوق استخدام هذه الصورة في متجري</Text>
      </Pressable>
      <BthwaniButton label={busy?"جارٍ إرسال البنر...":"إرسال البنر للمراجعة"} onPress={()=>void create()} disabled={busy||!file||!rights||!targetId||title.trim().length<2}/>
      {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
      {notice?<Text accessibilityLiveRegion="polite" style={styles.label}>{notice}</Text>:null}
    </View>
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>البنرات المسجلة</Text>
      <BthwaniButton label="تحديث البنرات" onPress={()=>void refresh()} variant="secondary" disabled={loading||busy||Boolean(pendingID)}/>
      {loading?<Text style={styles.body}>جارٍ قراءة حالة البنرات...</Text>:null}
      {!loading&&items.length===0?<Text style={styles.body}>لم يُرسل متجرك أي بنرات بعد.</Text>:null}
      {items.map(item=><View key={item.id} style={styles.panel}>
        <View style={styles.tile}>
          {item.mediaUri?<ExpoImage source={{uri:item.mediaUri}} style={styles.image} contentFit="cover" accessibilityLabel={"بنر "+item.titleAr}/>:null}
          <View style={styles.column}><Text style={styles.label} numberOfLines={2}>{item.titleAr}</Text>
            <Text style={styles.body}>{status(item)} · ترتيب {item.ordinal}</Text>
            <Text style={styles.body} numberOfLines={2}>{item.startsAt.slice(0,16)}{item.endsAt?" — "+item.endsAt.slice(0,16):""}</Text>
          </View>
        </View>
        <BthwaniButton label={item.partnerEnabled?"إخفاء البنر عن العملاء":"إظهار البنر بعد الاعتماد"} onPress={()=>void setVisibility(item,!item.partnerEnabled)} disabled={Boolean(pendingID)||busy} variant="secondary"/>
      </View>)}
    </View>
  </View>;
}
