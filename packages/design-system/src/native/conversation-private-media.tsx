import type { AudioPlayer, AudioStatus } from "expo-audio";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { BthwaniConversationAudioBubble } from "./conversation-audio-bubble";
import { BthwaniButton } from "./primitives";

const PrivateVideo = lazy(async () => {
  try { return await import("./conversation-private-video"); }
  catch { return { default: (_props: {uri: string}) => <Text>تعذر تشغيل الفيديو على هذا الجهاز.</Text> }; }
});

type Props = Readonly<{
  contextKey: string;
  mediaId: string;
  actorScope: string;
  mediaKind?: string | undefined;
  mine?: boolean;
  sender?: string;
  createdAt?: string;
  readAt?: string | null;
  caption?: string;
  readPrivateMedia: (contextKey: string, mediaId: string) => Promise<{ mediaKind: string; contentType: string; dataBase64: string }>;
}>;

function durationFromCaption(caption: string): number {
  const match = /^رسالة صوتية \((\d{1,3}):(\d{2})\)$/.exec(caption);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function BthwaniConversationMedia({
  contextKey, mediaId, actorScope, mediaKind, mine = false, sender = "", createdAt = "", readAt, caption = "", readPrivateMedia,
}: Props) {
  const [imageUri, setImageUri] = useState<{ scope: string; uri: string } | null>(null);
  const [videoUri, setVideoUri] = useState<{ scope: string; uri: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationFromCaption(caption));
  const player = useRef<AudioPlayer | null>(null);
  const playerScope = useRef("");
  const audioSubscription = useRef<{remove: () => void} | null>(null);
  const local = useRef<File | null>(null);
  const alive = useRef(true);
  const loading = useRef(false);
  // An in-flight read must never populate another actor's or conversation's view.
  const scope = JSON.stringify([actorScope, contextKey, mediaId, mediaKind]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const isCurrent = (requestedScope: string) =>
    alive.current && actorScope.length > 0 && scopeRef.current === requestedScope;

  useEffect(() => {
    if (scopeRef.current !== scope) return;
    alive.current = true;
    loading.current = false;
    setImageUri(null);
    setVideoUri(null);
    setError("");
    setBusy(false);
    setPlaying(false);
    setPosition(0);
    setDuration(durationFromCaption(caption));
    return () => {
      alive.current = false;
      audioSubscription.current?.remove();
      audioSubscription.current = null;
      try {player.current?.release();} catch {}
      player.current = null;
      playerScope.current = "";
      try {local.current?.delete();} catch {}
      local.current = null;
    };
  }, [scope, caption]);

  function updateAudio(status: AudioStatus) {
    if (!isCurrent(scope)) return;
    setPlaying(status.playing && !status.didJustFinish);
    if (Number.isFinite(status.duration) && status.duration > 0) setDuration(status.duration);
    setPosition(status.didJustFinish ? 0 : Math.max(0, status.currentTime));
    if (status.error) setError("تعذر تشغيل الصوت");
  }


  async function readCheckedMedia() {
    const result = await readPrivateMedia(contextKey, mediaId);
    if (!isCurrent(scope)) throw new Error("STALE_PRIVATE_MEDIA");
    if (result.mediaKind !== mediaKind || !result.dataBase64) throw new Error("INVALID_MEDIA");
    return result;
  }

  async function toggleAudio() {
    if (loading.current || !isCurrent(scope)) return;
    setError("");
    if (player.current && playerScope.current !== scope) {
      audioSubscription.current?.remove();
      audioSubscription.current = null;
      try {player.current.release();} catch {}
      player.current = null;
      playerScope.current = "";
    }
    if (player.current) {
      try {
        if (playing) player.current.pause();
        else {
          if (duration > 0 && position >= duration - 0.1) await player.current.seekTo(0);
          player.current.play();
        }
      } catch {if (isCurrent(scope)) setError("تعذر تشغيل الصوت");}
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
      if (!isCurrent(scope)) return;
      const file = new File(Paths.cache, "conversation-audio-" + Crypto.randomUUID() + extension);
      try {
        file.create();
        file.write(result.dataBase64, {encoding: "base64"});
      } catch {
        try {file.delete();} catch {}
        throw new Error("PRIVATE_MEDIA_CACHE_WRITE_FAILED");
      }
      if (!isCurrent(scope)) {file.delete(); return;}
      local.current = file;
      const audio = await import("expo-audio");
      if (!isCurrent(scope)) return;
      const instance = audio.createAudioPlayer({uri: file.uri}, {updateInterval: 250});
      player.current = instance;
      playerScope.current = scope;
      audioSubscription.current = instance.addListener("playbackStatusUpdate", updateAudio);
      instance.play();
    } catch {
      if (isCurrent(scope)) setError("تعذر تشغيل الصوت، أعد المحاولة");
    } finally {
      if (isCurrent(scope)) {
        loading.current = false;
        setBusy(false);
      }
    }
  }

  async function seek(progress: number) {
    if (!player.current || duration <= 0) return;
    try {
      await player.current.seekTo(Math.min(duration, Math.max(0, duration * progress)));
    } catch {if (isCurrent(scope)) setError("تعذر الانتقال داخل التسجيل");}
  }

  async function openOther() {
    if (loading.current || !isCurrent(scope)) return;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await readCheckedMedia();
      if (!isCurrent(scope)) return;
      if (result.mediaKind === "image") {
        if (!["image/jpeg", "image/png", "image/webp"].includes(result.contentType)) throw new Error("UNSUPPORTED_IMAGE");
        setImageUri({scope, uri: "data:" + result.contentType + ";base64," + result.dataBase64});
      } else if (result.mediaKind === "video") {
        if (!["video/mp4", "video/webm"].includes(result.contentType)) throw new Error("UNSUPPORTED_VIDEO");
        const file = new File(Paths.cache, "conversation-video-" + Crypto.randomUUID() + (result.contentType === "video/webm" ? ".webm" : ".mp4"));
        try {
          file.create();
          file.write(result.dataBase64, {encoding: "base64"});
        } catch {
          try {file.delete();} catch {}
          throw new Error("PRIVATE_MEDIA_CACHE_WRITE_FAILED");
        }
        if (!isCurrent(scope)) {file.delete(); return;}
        local.current?.delete();
        local.current = file;
        setVideoUri({scope, uri: file.uri});
      } else throw new Error("INVALID_MEDIA");
    } catch {
      if (isCurrent(scope)) setError("تعذر عرض المرفق، تحقق من الاتصال");
    } finally {
      if (isCurrent(scope)) {
        loading.current = false;
        setBusy(false);
      }
    }
  }

  if (!mediaKind || !actorScope) return null;
  if (mediaKind === "audio") {
    const hasCaption = Boolean(caption.trim()) && !/^رسالة صوتية(?: \(\d{1,3}:\d{2}\))?$/.test(caption.trim());
    return <View style={{alignSelf: mine ? "flex-end" : "flex-start", width: "86%", maxWidth: 320, gap: 4}}>
      <BthwaniConversationAudioBubble
        mine={mine} sender={sender} sentAt={createdAt} read={Boolean(readAt)}
        playing={playing} loading={busy} durationSeconds={duration} positionSeconds={position}
        onPlayPause={() => void toggleAudio()} onSeek={value => void seek(value)} error={error}/>
      {hasCaption ? <Text style={{fontSize: 12}}>{caption}</Text> : null}
    </View>;
  }
  return <View style={{gap: 6}}>
    <BthwaniButton variant="secondary" disabled={busy} label={mediaKind === "image" ? "عرض الصورة" : "عرض الفيديو"} onPress={() => void openOther()}/>
    {imageUri?.scope === scope ? <Image source={{uri: imageUri.uri}} resizeMode="contain" style={{width: 210, height: 180, borderRadius: 10}}/> : null}
    {videoUri?.scope === scope ? <Suspense fallback={<Text>جارٍ تحميل الفيديو…</Text>}><PrivateVideo uri={videoUri.uri}/></Suspense> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
