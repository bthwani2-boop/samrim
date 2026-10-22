import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { BthwaniButton } from "@bthwani/design-system/native";

export default function OrderConversationAudioRecorder({ disabled, onRecorded }: Readonly<{ disabled: boolean; onRecorded: (uri: string, contentType: string) => Promise<void> }>) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const [recording,setRecording]=useState(false);
  const [error,setError]=useState("");
  async function toggle() {
    setError("");
    try {
      if (recording) {
        await recorder.stop();
        setRecording(false);
        if (recorder.uri) await onRecorded(recorder.uri,Platform.OS==="ios"?"audio/mp4":"audio/3gpp");
        return;
      }
      const permission=await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {setError("يجب السماح باستخدام الميكروفون.");return;}
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {setRecording(false);setError("تعذر تسجيل الصوت.");}
  }
  return <View style={{gap:6}}>
    <BthwaniButton label={recording?"إيقاف وإرسال الصوت":"تسجيل صوتي"} variant="secondary" disabled={disabled && !recording} onPress={()=>void toggle()}/>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
