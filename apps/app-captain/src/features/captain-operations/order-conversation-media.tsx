import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import type { AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { BthwaniButton } from "@bthwani/design-system/native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

export function OrderConversationMediaMessage({ orderId, messageId, mediaKind }: Readonly<{orderId: string; messageId: string; mediaKind?: string | undefined}>) {
  const [imageUri,setImageUri] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const player=useRef<AudioPlayer | null>(null);
  const local = useRef<File | null>(null);
  useEffect(() => () => {
    try {local.current?.delete();} catch {}
    try {player.current?.release();} catch {}
  },[player]);
  if (!mediaKind) return null;

  async function open() {
    if (busy) return;
    setBusy(true);setError("");
    try {
      const base=process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
      if (!base) throw new Error("DSH_BASE_URL_REQUIRED");
      const token=await getUsableIdentityAccessToken();
      const api=createDshMobileClient(base,{cryptoRandomUUID:()=>Crypto.randomUUID()});
      const result=await api.readOrderConversationMedia(token,orderId,messageId);
      if (result.mediaKind!==mediaKind || !result.dataBase64) throw new Error("INVALID_MEDIA");
      if (result.mediaKind==="image") {
        setImageUri("data:"+result.contentType+";base64,"+result.dataBase64);
      } else {
        const file=new File(Paths.cache,"order-audio-"+Crypto.randomUUID()+(result.contentType==="audio/webm"?".webm":".m4a"));
        file.create();
        file.write(result.dataBase64,{encoding:"base64"});
        local.current?.delete();
        local.current=file;
        const audio=await import("expo-audio");
        const instance=audio.createAudioPlayer({uri:file.uri});
        player.current?.release();
        player.current=instance;
        instance.play();
      }
    } catch {
      setError("تعذر فتح المرفق. تحقق من الاتصال وصلاحية الوصول.");
    } finally {setBusy(false);}
  }
  return <View style={{gap:6}}>
    <BthwaniButton variant="secondary" disabled={busy} label={mediaKind==="image"?"عرض الصورة":"تشغيل التسجيل الصوتي"} onPress={()=>void open()} />
    {imageUri ? <Image source={{uri:imageUri}} resizeMode="contain" style={{width:210,height:180,borderRadius:10}} /> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
