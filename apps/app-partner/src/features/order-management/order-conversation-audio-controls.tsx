import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

type Phase = "starting" | "recording" | "sending" | "failed";

/** Compact, inline voice composer. Mounting starts recording; Send stops and uploads the audio. */
export default function OrderConversationAudioRecorder({
  disabled, onRecorded, onClose,
}: Readonly<{
  disabled: boolean;
  onRecorded: (uri: string, contentType: string, durationSeconds: number) => Promise<void>;
  onClose: () => void;
}>) {
  const theme = useAppearanceTheme();
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const stopped = useRef(true);
  const disposed = useRef(false);
  const sending = useRef(false);
  const savedUri = useRef<string | null>(null);
  const durationSeconds = useRef(0);

  useEffect(() => {
    disposed.current = false;
    void (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (disposed.current) return;
        if (!permission.granted) {
          setError("يرجى السماح باستخدام الميكروفون");
          setPhase("failed");
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (disposed.current) return;
        await recorder.prepareToRecordAsync();
        if (disposed.current) return;
        recorder.record();
        stopped.current = false;
        setPhase("recording");
      } catch {
        if (!disposed.current) {
          setError("تعذر تشغيل الميكروفون");
          setPhase("failed");
        }
      }
    })();
    return () => {
      disposed.current = true;
      if (!stopped.current) {
        stopped.current = true;
        void recorder.stop().catch(() => {});
      }
    };
  }, [recorder]);

  async function stop() {
    if (stopped.current) return;
    stopped.current = true;
    durationSeconds.current = Math.max(1, Math.round(recorder.getStatus().durationMillis / 1000));
    await recorder.stop();
    savedUri.current = recorder.uri;
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  }

  async function cancel() {
    if (sending.current) return;
    disposed.current = true;
    try { await stop(); } catch { /* Leaving the composer still cancels the recording. */ }
    onClose();
  }

  async function send() {
    if (sending.current || disabled || phase === "starting" || (phase === "failed" && !savedUri.current)) return;
    sending.current = true;
    setPhase("sending");
    setError("");
    try {
      await stop();
      if (!savedUri.current) throw new Error("AUDIO_RECORDING_MISSING");
      await onRecorded(savedUri.current, Platform.OS === "ios" ? "audio/mp4" : "audio/3gpp", durationSeconds.current);
      onClose();
    } catch {
      setError("تعذر إرسال الصوت، حاول مجددًا");
      setPhase("failed");
      sending.current = false;
    }
  }

  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const time = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  const active = phase === "recording";
  return <View style={styles.row} accessibilityLabel="تسجيل رسالة صوتية">
    <Pressable accessibilityRole="button" accessibilityLabel="إلغاء التسجيل" disabled={phase === "sending"}
      onPress={() => void cancel()} style={styles.control}>
      <BthwaniIcon name="close" color={theme.colorMuted} size={23}/>
    </Pressable>
    <View style={styles.status}>
      {active ? <View style={[styles.dot, { backgroundColor: theme.warning }]}/> : null}
      <Text numberOfLines={1} style={[styles.statusText, {color: phase === "failed" ? theme.warning : theme.color}]}>
        {phase === "starting" ? "جارٍ بدء التسجيل…" : phase === "sending" ? "جارٍ الإرسال…" : phase === "failed" ? error : time}
      </Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={phase === "failed" && !savedUri.current ? "إغلاق التسجيل" : "إرسال التسجيل الصوتي"}
      accessibilityState={{ disabled: disabled || phase === "sending" || phase === "starting" }}
      disabled={disabled || phase === "sending" || phase === "starting"}
      onPress={phase === "failed" && !savedUri.current ? () => void cancel() : () => void send()}
      style={[styles.send, { backgroundColor: theme.brandAction, opacity: disabled ? 0.5 : 1 }]}>
      <BthwaniIcon name={phase === "failed" && !savedUri.current ? "close" : "send"} color={theme.onAction} size={22}/>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flex: 1 },
  status: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1, minWidth: 0 },
  statusText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  control: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
