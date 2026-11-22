import type { MerchantRegistrationChoice, MerchantRegistrationOptions, MerchantStoreRegistration } from "@bthwani/dsh";
import { DshPublicError } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { createMerchantStore, readMerchantStoreRegistrationOptions } from "../access/admission-transport";

const optionKey = (choice: MerchantRegistrationChoice) => `${choice.cityId}:${choice.relation}`;
const relationLabel = (relation: string) =>
  relation === "MARKETPLACE" ? "داخل سوق بثواني" : "متجر مباشر";

export default function MerchantStoreRegistrationForm({ actorId, onCreated }: Readonly<{
  actorId: string;
  onCreated: () => void;
}>) {
  const { theme } = useMobileAppearance();
  const [options, setOptions] = useState<MerchantRegistrationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [choiceKey, setChoiceKey] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<{ signature: string; operationId: string } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The explicit reload revision requests a fresh DSH policy read.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOptions(null);
    setMessage("");
    void readMerchantStoreRegistrationOptions(actorId, controller.signal).then(value => {
      if (!controller.signal.aborted) setOptions(value);
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("تعذّر قراءة خيارات تسجيل المتجر من DSH.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [actorId, reload]);

  const choice = options?.choices.find(item => optionKey(item) === choiceKey);
  const locked = busy || unknown || done;
  const button = (text: string, action: () => void, disabled = false, selected = false) => (
    <Pressable key={text} accessibilityRole="button" accessibilityLabel={text}
      disabled={disabled} onPress={action} style={{
        minHeight: 44, padding: 12, borderWidth: 1, borderRadius: 10,
        borderColor: theme.borderColor, backgroundColor: selected ? theme.actionSoft : theme.surface,
        opacity: disabled ? 0.5 : 1, justifyContent: "center",
      }}>
      <Text style={{ color: theme.interactiveText, textAlign: "center" }}>{text}</Text>
    </Pressable>
  );
  const field = (label: string, value: string, onChange: (value: string) => void,
    keyboardType: "default" | "decimal-pad" = "default") => (
    <View style={{ gap: 5 }}>
      <Text style={{ color: theme.color }}>{label}</Text>
      <TextInput value={value} onChangeText={value => {
        if (locked) return;
        setMessage("");
        onChange(value);
      }} editable={!locked} keyboardType={keyboardType} accessibilityLabel={label}
        style={{ minHeight: 46, padding: 10, borderWidth: 1, borderRadius: 8,
          borderColor: theme.borderColor, color: theme.color }} />
    </View>
  );

  function submit() {
    if (busy || done || !choice || !verticalId || !name.trim() ||
      !latitude.trim() || !longitude.trim() || !accepted) return;
    const lat = Number(latitude.trim());
    const lon = Number(longitude.trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setMessage("أدخل إحداثيات موقع المتجر الصحيحة قبل التسجيل.");
      return;
    }
    const signature = JSON.stringify([actorId, choiceKey, verticalId, name.trim(), lat, lon,
      choice.policyVersion, choice.termsVersion]);
    if (attempt.current && attempt.current.signature !== signature) {
      // Never reuse an idempotency key for another business command.
      if (unknown) {
        setMessage("تحقق من نتيجة العملية السابقة قبل تغيير بيانات المتجر.");
        return;
      }
      attempt.current = null;
    }
    if (!attempt.current) {
      attempt.current = { signature, operationId: Crypto.randomUUID() };
    }
    const input: MerchantStoreRegistration = {
      operationId: attempt.current.operationId, cityId: choice.cityId,
      verticalId, relation: choice.relation, name: name.trim(), latitude: lat,
      longitude: lon, policyVersion: choice.policyVersion, termsVersion: choice.termsVersion,
      acceptedTerms: true,
    };
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage("");
    void createMerchantStore(actorId, input, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.store.published) {
        setUnknown(true);
        setMessage("الاستجابة تخالف شرط إنشاء متجر غير منشور. تحقق من DSH قبل المتابعة.");
        return;
      }
      setDone(true);
      setUnknown(false);
      setMessage("حُفظ المتجر غير المنشور في DSH. جارٍ تحديث متاجرك.");
      onCreated();
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof DshPublicError &&
        ["OPERATION_RESULT_UNKNOWN", "OWNER_UNAVAILABLE"].includes(error.code)) {
        setUnknown(true);
        setMessage("نتيجة إنشاء المتجر غير مؤكدة. لا تنشئ طلبًا ثانيًا؛ أعد نفس العملية أو تحقق من متاجرك.");
      } else if (error instanceof DshPublicError && error.code === "STORE_REGISTRATION_POLICY_CHANGED") {
        setMessage("تغيّرت سياسة التسجيل. أعد تحميل الخيارات قبل المحاولة مرة أخرى.");
        attempt.current = null;
      } else if (error instanceof DshPublicError && error.code === "STORE_REGISTRATION_CLOSED") {
        setMessage("أوقف DSH استقبال المتاجر لهذه المدينة وطريقة العمل.");
        attempt.current = null;
      } else {
        setMessage("لم يقبل DSH طلب التسجيل. تحقق من البيانات أو الصلاحيات.");
        attempt.current = null;
      }
    }).finally(() => {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    });
  }

  return (
    <View testID="merchant-dsh-store-registration" style={{
      padding: 18, gap: 12, backgroundColor: theme.surface, borderRadius: 14,
      borderWidth: 1, borderColor: theme.borderColor,
    }}>
      <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 20, fontWeight: "700" }}>
        إنشاء متجر في بثواني
      </Text>
      <Text style={{ color: theme.colorSecondary }}>
        الحساب موثّق عبر Identity. يُنشئ DSH المتجر مستقلًا عن الحساب، غير منشور ولا يقبل طلبات قبل الاعتماد.
      </Text>
      {loading ? <Text style={{ color: theme.colorSecondary }}>جارٍ قراءة سياسة التسجيل…</Text> : null}
      {!loading && !options ? button("إعادة التحقق من إتاحة التسجيل", () => setReload(n => n + 1)) : null}
      {!loading && options?.choices.length === 0 ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          تسجيل المتاجر مغلق حاليًا لدى DSH؛ يجب اعتماد سياسة المدينة وطريقة عمل المتجر أولًا.
        </Text>
      ) : null}
      {options && options.choices.length > 0 ? (
        <>
          <Text style={{ color: theme.color, fontWeight: "700" }}>المدينة وطريقة عمل المتجر</Text>
          <View style={{ gap: 6 }}>
            {options.choices.map(item => (
              <Pressable key={optionKey(item)} accessibilityRole="radio"
                accessibilityState={{ checked: choiceKey === optionKey(item) }}
                disabled={locked} onPress={() => { setChoiceKey(optionKey(item)); setAccepted(false); setMessage(""); }}
                style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, padding: 12,
                  borderColor: theme.borderColor, backgroundColor: choiceKey === optionKey(item) ?
                    theme.actionSoft : theme.surface }}>
                <Text style={{ color: theme.color }}>
                  {item.cityId} — {relationLabel(item.relation)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: theme.color, fontWeight: "700" }}>النشاط التجاري</Text>
          {options.verticals.map(id => (
            <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: verticalId === id }}
              disabled={locked} onPress={() => { setVerticalId(id); setMessage(""); }}
              style={{ padding: 10, minHeight: 44, borderRadius: 8, borderWidth: 1,
                borderColor: theme.borderColor, backgroundColor: id === verticalId ? theme.actionSoft : theme.surface }}>
              <Text style={{ color: theme.color }}>{id}</Text>
            </Pressable>
          ))}
          {field("الاسم التجاري للمتجر", name, setName)}
          {field("خط عرض موقع المتجر", latitude, setLatitude, "decimal-pad")}
          {field("خط طول موقع المتجر", longitude, setLongitude, "decimal-pad")}
          {choice ? (
            <>
              <Text style={{ color: theme.color, fontWeight: "700" }}>
                شروط التسجيل — الإصدار {choice.termsVersion}
              </Text>
              <Text selectable style={{ color: theme.colorSecondary }}>{choice.termsText}</Text>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}
                disabled={locked} onPress={() => setAccepted(v => !v)}
                style={{ minHeight: 44, padding: 10 }}>
                <Text style={{ color: theme.color }}>
                  {accepted ? "☑" : "□"} قرأت الشروط الموضحة وأوافق على تسجيل هذا المتجر وفق إصدارها.
                </Text>
              </Pressable>
            </>
          ) : null}
          {button(busy ? "جارٍ حفظ المتجر…" : unknown ? "إعادة نفس العملية دون تكرار" :
            done ? "تم الحفظ" : "إنشاء متجر غير منشور", submit,
            busy || done || !choice || !verticalId || !name.trim() ||
            !latitude.trim() || !longitude.trim() || !accepted)}
        </>
      ) : null}
      {unknown ? button("تحديث قائمة متاجري للتحقق من النتيجة", onCreated, busy) : null}
      {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
    </View>
  );
}
