import { createDshMobileClient } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import type { AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { BthwaniButton } from "@bthwani/design-system/native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

function PrivateVideo({uri}:{uri:string}){
  const player=useVideoPlayer({uri,useCaching:false});
  return <VideoView player={player} nativeControls contentFit="contain"
    surfaceType="textureView" style={{width:230,height:175,borderRadius:12}}/>;
}

export function OrderConversationMediaMessage({ orderId, messageId, mediaKind }: Readonly<{orderId: string; messageId: string; mediaKind?: string | undefined}>) {
  const [imageUri,setImageUri] = useState("");
  const [videoUri,setVideoUri] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const player=useRef<AudioPlayer | null>(null);
  const local = useRef<File | null>(null);
  useEffect(() => () => {
    try {local.current?.delete();} catch {}
    try {player.current?.release();} catch {}
  },[]);
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
      } else if (result.mediaKind==="video") {
        if(!["video/mp4","video/webm"].includes(result.contentType))throw new Error("UNSUPPORTED_VIDEO");
        const file=new File(Paths.cache,"order-video-"+Crypto.randomUUID()+(result.contentType==="video/webm"?".webm":".mp4"));
        file.create();file.write(result.dataBase64,{encoding:"base64"});
        local.current?.delete();local.current=file;
        setVideoUri(file.uri);
      } else if(result.mediaKind==="audio") {
        const file=new File(Paths.cache,"order-audio-"+Crypto.randomUUID()+(result.contentType==="audio/webm"?".webm":".m4a"));
        file.create();file.write(result.dataBase64,{encoding:"base64"});
        local.current?.delete();local.current=file;
        const audio=await import("expo-audio");
        const instance=audio.createAudioPlayer({uri:file.uri});
        player.current?.release();player.current=instance;
        instance.play();
      } else throw new Error("INVALID_MEDIA");
    } catch (cause) {
      console.error("Order private media playback failed",cause);
      setError("تعذر فتح المرفق. تحقق من الاتصال أو نوع الملف.");
    } finally {setBusy(false);}
  }
  return <View style={{gap:6}}>
    <BthwaniButton variant="secondary" disabled={busy}
      label={mediaKind==="image"?"عرض الصورة":mediaKind==="video"?"عرض الفيديو":"تشغيل الصوت"}
      onPress={()=>void open()}/>
    {imageUri?<Image source={{uri:imageUri}} resizeMode="contain" style={{width:210,height:180,borderRadius:10}}/>:null}
    {videoUri?<PrivateVideo uri={videoUri}/>:null}
    {error?<Text accessibilityRole="alert">{error}</Text>:null}
  </View>;
}
