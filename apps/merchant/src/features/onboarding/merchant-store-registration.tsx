import type { MerchantRegistrationChoice, MerchantRegistrationOptions, MerchantStoreRegistration } from "@bthwani/dsh";
import { DshPublicError, type PendingRegistration } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { withMutationRecoveryLock } from "../mutation-recovery/recovery-lock";
import {
  parseStoredMerchantRegistration,
  type StoredMerchantRegistration,
  sameRegistrationGeneration,
} from "./merchant-registration-attempt";
import { createMerchantStore, readMerchantStoreRegistrationOptions } from "./store-registration-transport";
import StoreRelationChoice from "./store-relation-choice";

const optionKey = (choice: MerchantRegistrationChoice) => `${choice.cityId}:${choice.relation}`;

// Normalize localized decimal input before computing the stable registration fingerprint.
// Do not accept hexadecimal, exponent or grouping syntax as geographic coordinates.
function coordinateNumber(value: string, limit: number): number | null {
  const normalized = value.trim()
    .replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15))
    .replace(/٫/g, ".")
    .replace(/−/g, "-");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

const attemptStoragePrefix = "bthwani.merchant.store-registration.pending.v1.";
const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
async function attemptStorageKey(actorId: string) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, actorId);
  return attemptStoragePrefix + digest;
}
type RegistrationScope = Readonly<{ actorId: string; revision: number; key: string; record: StoredMerchantRegistration | null }>;

async function readStoredAttempt(key: string): Promise<StoredMerchantRegistration | null> {
  const raw = Platform.OS === "web"
    ? window.localStorage.getItem(key)
    : await SecureStore.getItemAsync(key, secureOptions);
  return parseStoredMerchantRegistration(raw);
}

async function writeStoredAttempt(key: string, record: StoredMerchantRegistration) {
  const value = JSON.stringify(record);
  if (Platform.OS === "web") window.localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value, secureOptions);
}

async function settleStoredAttempt(key: string, pending: PendingRegistration): Promise<StoredMerchantRegistration> {
  return withMutationRecoveryLock(Platform.OS, key, async () => {
    const current = await readStoredAttempt(key);
    const settled = { ...pending, settled: true as const };
    if (sameRegistrationGeneration(current, settled)) return settled;
    if (!sameRegistrationGeneration(current, pending)) throw new Error("REGISTRATION_GENERATION_CHANGED");
    await writeStoredAttempt(key, settled);
    return settled;
  });
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
  const attempt = useRef<RegistrationScope | null>(null);

  useEffect(() => {
    let current = true;
    attempt.current = null;
    setAttemptReady(false);
    setRestored(false);
    setUnknown(false);
    void (async () => {
      const key = await attemptStorageKey(actorId);
      const previous = await readStoredAttempt(key);
      if (!current) return;
      attempt.current = { actorId, revision: reload, key, record: previous };
      if (previous && !previous.settled) {
        setUnknown(true);
        setRestored(true);
        setMessage("عُثر على عملية تسجيل غير مؤكدة. أدخل البيانات نفسها لإعادة المحاولة، أو حدّث قائمة متاجرك أولًا.");
      }
      setAttemptReady(true);
    })().catch(() => {
      if (current) setMessage("تعذّر قراءة سجل محاولة التسجيل السابقة بأمان. لن يُرسل طلب جديد.");
    });
    return () => { current = false; };
  }, [actorId, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The explicit reload revision requests a fresh DSH policy read.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOptions(null);
    setChoiceKey("");
    setAccepted(false);
    setMessage("");
    void readMerchantStoreRegistrationOptions(actorId, controller.signal).then(value => {
      if (!controller.signal.aborted) setOptions(value);
    }).catch(() => {
      if (!controller.signal.aborted) setMessage("تعذّر تحميل خيارات تسجيل المتجر. حاول مرة أخرى.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [actorId, reload]);

  const openedAttempt = attempt.current;
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
    if (!openedAttempt || openedAttempt.actorId !== actorId || openedAttempt.revision !== reload || attempt.current !== openedAttempt || active.current || !attemptReady || busy || done || !choice || !verticalId ||
      !options?.verticals.includes(verticalId) || !name.trim() || !latitude.trim() || !longitude.trim() || !accepted) return;
    if ([...name.trim()].length > 120 || /\p{Cc}/u.test(name)) {
      setMessage("أدخل اسمًا تجاريًا صالحًا لا يتجاوز 120 حرفًا.");
      return;
    }
    const lat = coordinateNumber(latitude, 90);
    const lon = coordinateNumber(longitude, 180);
    if (lat === null || lon === null) {
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
      let claimed: PendingRegistration | null = null;
      const { key } = openedAttempt;
      try {
        const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, signature);
        if (controller.signal.aborted) return;
        const claim = await withMutationRecoveryLock(Platform.OS, key, async () => {
          controller.signal.throwIfAborted();
          const current = await readStoredAttempt(key);
          controller.signal.throwIfAborted();
          if (!sameRegistrationGeneration(current, openedAttempt.record)) return { status: "changed" as const };
          const previous = current && !current.settled ? current : null;
          if (previous && previous.fingerprint !== fingerprint) return { status: "mismatch" as const };
          const pending = previous ?? { fingerprint, operationId: Crypto.randomUUID() };
          if (!previous) {
            // Persist the new opaque generation before any owner dispatch.
            if (!parseStoredMerchantRegistration(JSON.stringify(pending))) throw new Error("Invalid registration identity");
            await writeStoredAttempt(key, pending);
          }
          controller.signal.throwIfAborted();
          return { status: "claimed" as const, pending };
        });
        controller.signal.throwIfAborted();
        if (claim.status === "changed") {
          setAttemptReady(false);
          setMessage("تغيّر سجل التسجيل في نموذج آخر. أعد قراءة سجل الاسترداد قبل المتابعة.");
          return;
        }
        if (claim.status === "mismatch") {
          setMessage("تختلف البيانات عن عملية التسجيل السابقة. تحقق من متاجرك قبل إرسال طلب مختلف.");
          return;
        }
        const pending = claim.pending;
        claimed = pending;
        attempt.current = { actorId, revision: reload, key, record: pending };
        const input: MerchantStoreRegistration = {
          operationId: pending.operationId, cityId: choice.cityId,
          verticalId, relation: choice.relation, name: name.trim(), latitude: lat,
          longitude: lon, policyVersion: choice.policyVersion, termsVersion: choice.termsVersion,
          acceptedTerms: true,
        };
        dispatched = true;
        const result = await createMerchantStore(actorId, input, controller.signal);
        if (controller.signal.aborted) return;
        // A replay reads the current Store state. Publication may have occurred
        // after the original committed create; only a fresh create must be unpublished.
        if (!result.replay && result.store.published) {
          setUnknown(true);
          setRestored(false);
          setMessage("الاستجابة تخالف شرط إنشاء متجر غير منشور. تحقق من DSH قبل المتابعة.");
          return;
        }
        let settlementFailed = false;
        try {
          const settled = await settleStoredAttempt(key, pending);
          if (!controller.signal.aborted) attempt.current = { actorId, revision: reload, key, record: settled };
        } catch {
          // A confirmed owner result must never erase another form's newer record.
          settlementFailed = true;
        }
        if (controller.signal.aborted) return;
        setDone(true);
        setUnknown(false);
        setMessage(settlementFailed
          ? "أكد DSH تسجيل المتجر، وتعذر تحديث سجل الاسترداد. حدّث متاجرك قبل أي تسجيل جديد."
          : result.replay
            ? "تم تأكيد تسجيل المتجر السابق لدى DSH. جارٍ تحديث متاجرك."
            : "حُفظ المتجر غير المنشور في DSH. جارٍ تحديث متاجرك.");
        onCreated();
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!dispatched || !claimed) {
          setMessage(error instanceof Error && error.message === "MUTATION_RECOVERY_LOCK_UNAVAILABLE"
            ? "تعذر تأمين الاسترداد بين تبويبات المتصفح. استخدم متصفحًا يدعم Web Locks."
            : "تعذّر حفظ معرّف طلب التسجيل بأمان. لم يُرسل الطلب إلى DSH.");
          return;
        }
        if (error instanceof DshPublicError &&
          ((error.status === 409 && error.code === "STORE_REGISTRATION_POLICY_CHANGED") ||
           (error.status === 403 && error.code === "STORE_REGISTRATION_CLOSED"))) {
          // A definitive owner policy rejection has no committed Store to replay.
          try {
            const settled = await settleStoredAttempt(key, claimed);
            if (!controller.signal.aborted) attempt.current = { actorId, revision: reload, key, record: settled };
          } catch {
            if (controller.signal.aborted) return;
            // Never mint a replacement ID while the durable previous record remains.
            setUnknown(true);
            setRestored(false);
            setMessage("رفض DSH السياسة السابقة، لكن تعذّر تحديث سجل المحاولة. تحقق من متاجرك قبل المتابعة.");
            return;
          }
          if (controller.signal.aborted) return;
          setUnknown(false);
          setRestored(false);
          setOptions(null);
          setChoiceKey("");
          setAccepted(false);
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
        تم التحقق من حسابك. يمكنك إنشاء متجر مستقل، واستكمال بياناته قبل اعتماده ونشره واستقبال الطلبات.
      </Text>
      {loading ? <Text style={{ color: theme.colorSecondary }}>جارٍ قراءة سياسة التسجيل…</Text> : null}
      {!loading && (!options || options.choices.length === 0 || options.verticals.length === 0) ? button("إعادة التحقق من إتاحة التسجيل", () => setReload(n => n + 1), busy || unknown) : null}
      {!loading && options?.verticals.length === 0 ? (
        <Text testID="merchant-registration-no-activities" accessibilityRole="alert" style={{ color: theme.warningText }}>
          لا توجد أنشطة تجارية متاحة للتسجيل حاليًا. أعد التحقق عند تحديث خيارات التسجيل.
        </Text>
      ) : null}
      {!loading && options?.choices.length === 0 && options.verticals.length > 0 ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          تسجيل المتاجر غير متاح حاليًا. يجب اعتماد خيارات التسجيل للمدينة وطريقة عمل المتجر أولًا. يمكنك إعادة التحقق من الإتاحة.
        </Text>
      ) : null}
      {options && options.choices.length > 0 && options.verticals.length > 0 ? (
        <>
          <StoreRelationChoice choices={options.choices} selectedKey={choiceKey}
            disabled={locked} onSelect={key => {
              setChoiceKey(key);
              setAccepted(false);
              setMessage("");
            }} />
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
            busy || done || !attemptReady || !choice || !verticalId || !options.verticals.includes(verticalId) || !name.trim() ||
            !latitude.trim() || !longitude.trim() || !accepted)}
        </>
      ) : null}
      {!attemptReady && !loading ? button("إعادة قراءة سجل الاسترداد", () => setReload(n => n + 1), busy) : null}
      {unknown ? button("تحديث قائمة متاجري للتحقق من النتيجة", onCreated, busy) : null}
      {message ? <Text accessibilityRole="alert" style={{ color: theme.warningText }}>{message}</Text> : null}
    </View>
  );
}
