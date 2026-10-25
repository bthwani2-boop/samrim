import type { AudioPlayer, AudioStatus } from "expo-audio";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { BthwaniOrderChatAudioBubble } from "./order-chat-audio-bubble";
import { BthwaniButton } from "./primitives";

const PrivateVideo = lazy(async () => {
  try { return await import("./order-chat-private-video"); }
  catch { return { default: (_props: {uri: string}) => <Text>تعذر تشغيل الفيديو على هذا الجهاز.</Text> }; }
});

type Props = Readonly<{
  orderId: string;
  messageId: string;
  mediaKind?: string | undefined;
  mine?: boolean;
  sender?: string;
  createdAt?: string;
  readAt?: string | null;
  caption?: string;
  readPrivateMedia: (orderId: string, messageId: string) => Promise<{ mediaKind: string; contentType: string; dataBase64: string }>;
}>;

function durationFromCaption(caption: string): number {
  const match = /^رسالة صوتية \((\d{1,3}):(\d{2})\)$/.exec(caption);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function OrderConversationMediaMessage({
  orderId, messageId, mediaKind, mine = false, sender = "", createdAt = "", readAt, caption = "", readPrivateMedia,
}: Props) {
  const [imageUri, setImageUri] = useState("");
  const [videoUri, setVideoUri] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationFromCaption(caption));
  const player = useRef<AudioPlayer | null>(null);
  const audioSubscription = useRef<{remove: () => void} | null>(null);
  const local = useRef<File | null>(null);
  const alive = useRef(true);
  const loading = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      audioSubscription.current?.remove();
      try {player.current?.release();} catch {}
      try {local.current?.delete();} catch {}
    };
  }, []);

  function updateAudio(status: AudioStatus) {
    if (!alive.current) return;
    setPlaying(status.playing && !status.didJustFinish);
    if (Number.isFinite(status.duration) && status.duration > 0) setDuration(status.duration);
    setPosition(status.didJustFinish ? 0 : Math.max(0, status.currentTime));
    if (status.error) setError("تعذر تشغيل الصوت");
  }


  async function readCheckedMedia() {
    const result = await readPrivateMedia(orderId, messageId);
    if (result.mediaKind !== mediaKind || !result.dataBase64) throw new Error("INVALID_MEDIA");
    return result;
  }

  async function toggleAudio() {
    if (loading.current) return;
    setError("");
    if (player.current) {
      try {
        if (playing) player.current.pause();
        else {
          if (duration > 0 && position >= duration - 0.1) await player.current.seekTo(0);
          player.current.play();
        }
      } catch {if (alive.current) setError("تعذر تشغيل الصوت");}
      return;
    }
    loading.current = true;
    setBusy(true);
    try {
      const result = await readCheckedMedia();
      if (result.mediaKind !== "audio") throw new Error("INVALID_AUDIO");
      const extensions: Record<string, string> = {
        "audio/mp4": ".m4a", "audio/m4a": ".m4a", "audio/aac": ".aac",
        "audio/3gpp": ".3gp", "audio/webm": ".webm",
      };
      const extension = extensions[result.contentType];
      if (!extension) throw new Error("UNSUPPORTED_AUDIO");
      if (!alive.current) return;
      const file = new File(Paths.cache, "order-audio-" + Crypto.randomUUID() + extension);
      file.create();
      file.write(result.dataBase64, {encoding: "base64"});
      if (!alive.current) {file.delete(); return;}
      local.current = file;
      const audio = await import("expo-audio");
      if (!alive.current) return;
      const instance = audio.createAudioPlayer({uri: file.uri}, {updateInterval: 250});
      player.current = instance;
      audioSubscription.current = instance.addListener("playbackStatusUpdate", updateAudio);
      instance.play();
    } catch (cause) {
      console.error("Order private audio playback failed", cause);
      if (alive.current) setError("تعذر تشغيل الصوت، أعد المحاولة");
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function seek(progress: number) {
    if (!player.current || duration <= 0) return;
    try {
      await player.current.seekTo(Math.min(duration, Math.max(0, duration * progress)));
    } catch {if (alive.current) setError("تعذر الانتقال داخل التسجيل");}
  }

  async function openOther() {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await readCheckedMedia();
      if (!alive.current) return;
      if (result.mediaKind === "image") {
        setImageUri("data:" + result.contentType + ";base64," + result.dataBase64);
      } else if (result.mediaKind === "video") {
        if (!["video/mp4", "video/webm"].includes(result.contentType)) throw new Error("UNSUPPORTED_VIDEO");
        const file = new File(Paths.cache, "order-video-" + Crypto.randomUUID() + (result.contentType === "video/webm" ? ".webm" : ".mp4"));
        file.create();
        file.write(result.dataBase64, {encoding: "base64"});
        local.current?.delete();
        local.current = file;
        setVideoUri(file.uri);
      } else throw new Error("INVALID_MEDIA");
    } catch (cause) {
      console.error("Order private media playback failed", cause);
      if (alive.current) setError("تعذر عرض المرفق، تحقق من الاتصال");
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }

  if (!mediaKind) return null;
  if (mediaKind === "audio") {
    const hasCaption = Boolean(caption.trim()) && !/^رسالة صوتية(?: \(\d{1,3}:\d{2}\))?$/.test(caption.trim());
    return <View style={{alignSelf: mine ? "flex-end" : "flex-start", width: "86%", maxWidth: 320, gap: 4}}>
      <BthwaniOrderChatAudioBubble
        mine={mine} sender={sender} sentAt={createdAt} read={Boolean(readAt)}
        playing={playing} loading={busy} durationSeconds={duration} positionSeconds={position}
        onPlayPause={() => void toggleAudio()} onSeek={value => void seek(value)} error={error}/>
      {hasCaption ? <Text style={{fontSize: 12}}>{caption}</Text> : null}
    </View>;
  }
  return <View style={{gap: 6}}>
    <BthwaniButton variant="secondary" disabled={busy} label={mediaKind === "image" ? "عرض الصورة" : "عرض الفيديو"} onPress={() => void openOther()}/>
    {imageUri ? <Image source={{uri: imageUri}} resizeMode="contain" style={{width: 210, height: 180, borderRadius: 10}}/> : null}
    {videoUri ? <Suspense fallback={<Text>جارٍ تحميل الفيديو…</Text>}><PrivateVideo uri={videoUri}/></Suspense> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
