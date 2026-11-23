import type { MerchantRegistrationChoice, MerchantRegistrationOptions, MerchantStoreRegistration } from "@bthwani/dsh";
import { DshPublicError } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { createMerchantStore, readMerchantStoreRegistrationOptions } from "../access/admission-transport";
import {
  matchingPendingMerchantRegistration,
  type PendingMerchantRegistration,
  parsePendingMerchantRegistration,
} from "./merchant-registration-attempt";

const optionKey = (choice: MerchantRegistrationChoice) => `${choice.cityId}:${choice.relation}`;
const relationLabel = (relation: string) =>
  relation === "MARKETPLACE" ? "داخل سوق بثواني" : "متجر مباشر";

const attemptStoragePrefix = "bthwani.merchant.store-registration.pending.v1.";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
async function attemptStorageKey(actorId: string) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, actorId);
  return attemptStoragePrefix + digest;
}
async function readStoredAttempt(actorId: string): Promise<PendingMerchantRegistration | null> {
  const key = await attemptStorageKey(actorId);
  const raw = Platform.OS === "web"
    ? window.localStorage.getItem(key)
    : await SecureStore.getItemAsync(key, secureOptions);
  const parsed = parsePendingMerchantRegistration(raw);
  if (raw && !parsed) throw new Error("Invalid pending registration metadata");
  return parsed;
}
async function writeStoredAttempt(actorId: string, pending: PendingMerchantRegistration | null) {
  const key = await attemptStorageKey(actorId);
  if (Platform.OS === "web") {
    if (pending) window.localStorage.setItem(key, JSON.stringify(pending));
    else window.localStorage.removeItem(key);
    return;
  }
  if (pending) await SecureStore.setItemAsync(key, JSON.stringify(pending), secureOptions);
  else await SecureStore.deleteItemAsync(key, secureOptions);
}

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
  const [restored, setRestored] = useState(false);
  const [attemptReady, setAttemptReady] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<PendingMerchantRegistration | null>(null);

  useEffect(() => {
    let current = true;
    attempt.current = null;
    setAttemptReady(false);
    setRestored(false);
    setUnknown(false);
    void readStoredAttempt(actorId).then(previous => {
      if (!current) return;
      attempt.current = previous;
      if (previous) {
        setUnknown(true);
        setRestored(true);
        setMessage("عُثر على عملية تسجيل غير مؤكدة. أدخل البيانات نفسها لإعادة المحاولة، أو حدّث قائمة متاجرك أولًا.");
      }
      setAttemptReady(true);
    }).catch(() => {
      if (current) setMessage("تعذّر قراءة سجل محاولة التسجيل السابقة بأمان. لن يُرسل طلب جديد.");
    });
    return () => { current = false; };
  }, [actorId]);

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
  const locked = busy || (unknown && !restored) || done || !attemptReady;
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
    if (active.current || !attemptReady || busy || done || !choice || !verticalId ||
      !name.trim() || !latitude.trim() || !longitude.trim() || !accepted) return;
    const lat = Number(latitude.trim());
    const lon = Number(longitude.trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setMessage("أدخل إحداثيات موقع المتجر الصحيحة قبل التسجيل.");
      return;
    }
    const signature = JSON.stringify([actorId, choiceKey, verticalId, name.trim(), lat, lon,
      choice.policyVersion, choice.termsVersion]);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage("");
    void (async () => {
      let dispatched = false;
      try {
        const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, signature);
        if (controller.signal.aborted) return;
        if (!matchingPendingMerchantRegistration(attempt.current, fingerprint)) {
          setMessage("تختلف البيانات عن عملية التسجيل السابقة. تحقق من متاجرك قبل إرسال طلب مختلف.");
          return;
        }
        let pending = attempt.current;
        if (!pending) {
          pending = { fingerprint, operationId: Crypto.randomUUID() };
          // Persist BEFORE the HTTP write; a restart must reuse the same DSH operationId.
          await writeStoredAttempt(actorId, pending);
          if (controller.signal.aborted) return;
          attempt.current = pending;
        }
        const input: MerchantStoreRegistration = {
          operationId: pending.operationId, cityId: choice.cityId,
          verticalId, relation: choice.relation, name: name.trim(), latitude: lat,
          longitude: lon, policyVersion: choice.policyVersion, termsVersion: choice.termsVersion,
          acceptedTerms: true,
        };
        dispatched = true;
        const result = await createMerchantStore(actorId, input, controller.signal);
        if (controller.signal.aborted) return;
        if (result.store.published) {
          setUnknown(true);
          setRestored(false);
          setMessage("الاستجابة تخالف شرط إنشاء متجر غير منشور. تحقق من DSH قبل المتابعة.");
          return;
        }
        setDone(true);
        setUnknown(false);
        await writeStoredAttempt(actorId, null).catch(() => {
          // A leftover retry ID is safe: DSH will replay the confirmed command.
        });
        attempt.current = null;
        if (controller.signal.aborted) return;
        setMessage("حُفظ المتجر غير المنشور في DSH. جارٍ تحديث متاجرك.");
        onCreated();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!dispatched) {
          setMessage("تعذّر حفظ معرّف طلب التسجيل بأمان. لم يُرسل الطلب إلى DSH.");
          return;
        }
        if (error instanceof DshPublicError &&
          ["STORE_REGISTRATION_POLICY_CHANGED", "STORE_REGISTRATION_CLOSED"].includes(error.code)) {
          // A definitive owner policy rejection has no committed Store to replay.
          await writeStoredAttempt(actorId, null).catch(() => {});
          attempt.current = null;
          setUnknown(false);
          setMessage(error.code === "STORE_REGISTRATION_CLOSED"
            ? "أوقف DSH استقبال المتاجر لهذه المدينة وطريقة العمل."
            : "تغيّرت سياسة التسجيل. أعد تحميل الخيارات قبل المحاولة مرة أخرى.");
          return;
        }
        // An interrupted response may have committed. Never mint another operation ID.
        setUnknown(true);
        setRestored(false);
        setMessage("نتيجة إنشاء المتجر غير مؤكدة. احتُفظ بمعرّف العملية على هذا الجهاز؛ أعد نفس العملية أو تحقق من متاجرك.");
      } finally {
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
        }
      }
    })();
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
