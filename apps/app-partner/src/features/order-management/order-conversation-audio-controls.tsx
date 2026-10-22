import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { BthwaniButton } from "@bthwani/design-system/native";

type RecordedAudio = Readonly<{ uri: string; contentType: string }>;

export default function OrderConversationAudioRecorder({
  disabled, onRecorded,
}: Readonly<{
  disabled: boolean;
  onRecorded: (uri: string, contentType: string, transcript: string) => Promise<void>;
}>) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<RecordedAudio | null>(null);
  const [transcript, setTranscript] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (pending || sending) return;
    setError("");
    try {
      if (recording) {
        await recorder.stop();
        setRecording(false);
        if (!recorder.uri) throw new Error("AUDIO_RECORDING_MISSING");
        setPending({
          uri: recorder.uri,
          contentType: Platform.OS === "ios" ? "audio/mp4" : "audio/3gpp",
        });
        return;
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("يجب السماح باستخدام الميكروفون.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setRecording(false);
      setError("تعذر تسجيل الصوت.");
    }
  }

  async function send() {
    const text = transcript.trim();
    if (!pending || sending || disabled || !text || text.length > 2000) return;
    setSending(true);
    setError("");
    try {
      await onRecorded(pending.uri, pending.contentType, text);
      setPending(null);
      setTranscript("");
    } catch {
      setError("تعذر إرسال التسجيل مع نصه. أعد المحاولة.");
    } finally {
      setSending(false);
    }
  }

  return <View style={{ gap: 8 }}>
    {!pending ? <BthwaniButton
      label={recording ? "إيقاف التسجيل" : "تسجيل صوتي"}
      variant="secondary"
      disabled={(disabled && !recording) || sending}
      onPress={() => void toggle()}
    /> : <>
      <Text>اكتب ما قلته في التسجيل ليتمكن الجميع من قراءته.</Text>
      <TextInput
        accessibilityLabel="تفريغ نصي للتسجيل الصوتي"
        editable={!disabled && !sending}
        maxLength={2000}
        multiline
        onChangeText={setTranscript}
        placeholder="نص التسجيل الصوتي"
        style={{ borderWidth: 1, borderColor: "#9AA5B1", borderRadius: 8, padding: 10, minHeight: 56, textAlign: "right" }}
        value={transcript}
      />
      <BthwaniButton label="إرسال التسجيل مع نصه" disabled={disabled || sending || !transcript.trim()} onPress={() => void send()} />
      <BthwaniButton label="إلغاء التسجيل" variant="secondary" disabled={sending} onPress={() => { setPending(null); setTranscript(""); setError(""); }} />
    </>}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
