"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { operationNotificationHref } from "../notifications/notification-operation-link";
import { useSession } from "../../session/session-provider";

const LEVEL_KEY = "bthwani:operations-alert-volume:v1";

// Browser sound requires a user gesture. Notifications remain visible when muted.
export function OperationsAlertMonitor() {
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(65);
  const [tone, setTone] = useState<"classic" | "soft" | "urgent">("classic");
  const { state } = useSession();
  const actorID = state.kind === "authenticated" && state.identity.role === "operator"
    ? state.identity.subject.trim() : "";
  const [caseAlert, setCaseAlert] = useState<{ id: number; orderId: string; reason: string } | null>(null);
  const seenCases = useRef<Set<string>>(new Set());
  const casesPrimed = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const pending = useRef(false);
  const enabledRef = useRef(false);
  const volumeRef = useRef(65);
  const toneRef = useRef<"classic" | "soft" | "urgent">("classic");

  useEffect(() => {
    seenCases.current.clear();
    casesPrimed.current = false;
    setCaseAlert(null);
  }, [actorID]);

  useEffect(() => {
    enabledRef.current = false;
    setEnabled(false);
    const suffix = actorID ? ":" + actorID : "";
    let nextVolume = 65;
    let nextTone: "classic" | "soft" | "urgent" = "classic";
    try {
      const raw = window.localStorage.getItem(LEVEL_KEY + suffix);
      if (raw !== null) {
        const level = Number(raw);
        if (Number.isFinite(level) && level >= 0 && level <= 100) nextVolume = level;
      }
      const storedTone = window.localStorage.getItem("bthwani:operations-alert-tone:v1" + suffix);
      if (storedTone === "classic" || storedTone === "soft" || storedTone === "urgent") nextTone = storedTone;
    } catch { /* Storage may be blocked. */ }
    volumeRef.current = nextVolume;
    toneRef.current = nextTone;
    setVolume(nextVolume);
    setTone(nextTone);
  }, [actorID]);
  useEffect(() => () => { void audio.current?.close(); audio.current = null; }, []);

  const play = useCallback(() => {
    if (!enabledRef.current || !audio.current || audio.current.state !== "running") return;
    const ctx = audio.current;
    const start = ctx.currentTime;
    const pattern = toneRef.current === "soft"
      ? [[0, 590]] as const
      : toneRef.current === "urgent"
        ? [[0, 880], [0.18, 1030], [0.36, 880]] as const
        : [[0, 720], [0.19, 940]] as const;
    for (const [offset, frequency] of pattern) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volumeRef.current / 100 * 0.11), start + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.16);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const check = async () => {
      if (disposed || !actorID || pending.current || document.visibilityState !== "visible") return;
      pending.current = true;
      try {
        // Existing operations cases already own SLA and escalation. Sound only
        // for cases assigned to THIS operator, never for every global order.
        const mine = await fetch("/api/operations/cases?limit=20&scope=mine", {
          cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        if (mine.ok) {
          const data = await mine.json() as { items?: Array<{ id: number; orderId: string; reason: string; priority: string; state: string }> };
          if (Array.isArray(data.items) && !disposed) {
            const activeCases = data.items.filter(item => Number.isSafeInteger(item.id) && item.id>0
              && typeof item.orderId === "string" && item.orderId.length>0
              && typeof item.priority === "string" && typeof item.state === "string"
              && item.state.toLowerCase() !== "resolved");
            const unseen = activeCases.filter(item => !seenCases.current.has(`${item.id}:${item.priority}`));
            for (const item of activeCases) seenCases.current.add(`${item.id}:${item.priority}`);
            if (casesPrimed.current && unseen.length) {
              const latest = unseen.at(0)!;
              setCaseAlert({ id: latest.id, orderId: latest.orderId, reason: latest.reason });
              play();
            }
            if (casesPrimed.current) setCaseAlert(current =>
              current && !activeCases.some(item => item.id===current.id) ? null : current);
            casesPrimed.current = true;
          }
        }
      } catch {
        // Network failure should not invent or repeat an alert.
      } finally {
        pending.current = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 10_000);
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [play, actorID]);

  async function toggleSound() {
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      if (audio.current.state !== "running") return;
      enabledRef.current = true;
      setEnabled(true);
      play();
    } catch { /* Silent visual fallback is always available. */ }
  }

  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(100, value));
    volumeRef.current = next;
    setVolume(next);
    try { window.localStorage.setItem(LEVEL_KEY + ":" + actorID, String(next)); } catch { /* Storage blocked */ }
  }

  function changeTone(value: string) {
    if (value !== "classic" && value !== "soft" && value !== "urgent") return;
    toneRef.current = value;
    setTone(value);
    try { window.localStorage.setItem("bthwani:operations-alert-tone:v1:" + actorID, value); }
    catch { /* Browser storage unavailable; current session selection remains. */ }
  }

  const orderHref = caseAlert ? operationNotificationHref(caseAlert.orderId) : null;
  return (
    <div className="ops-alert-monitor" aria-label="تنبيهات العمليات" style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:12, marginBlock: "0 12px" }}>
      <button className="button button-secondary" type="button" aria-pressed={enabled} onClick={() => void toggleSound()}>
        {enabled ? "كتم صوت العمليات" : "تفعيل صوت العمليات"}
      </button>
      {enabled ? <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
        النغمة
        <select aria-label="اختيار نغمة العمليات" value={tone} onChange={event => changeTone(event.target.value)}>
          <option value="classic">الأساسية</option>
          <option value="soft">الهادئة</option>
          <option value="urgent">العاجلة</option>
        </select>
      </label> : null}
      {enabled ? <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
        مستوى الصوت
        <input type="range" min="0" max="100" step="5" value={volume} onChange={e => changeVolume(Number(e.target.value))} aria-label="مستوى صوت تنبيهات العمليات" />
        <span>{volume}%</span>
      </label> : null}
      {caseAlert ? <div role="alert" style={{ display:"inline-flex", flexWrap:"wrap", alignItems:"center", gap:8 }}>
        <strong>{"حالة تشغيلية مسندة إليك وتحتاج تدخلاً"}</strong>
        {orderHref ? <Link href={orderHref} className="button button-secondary">فتح الطلب</Link> : null}
        <button className="button button-secondary" type="button" onClick={() => { setCaseAlert(null); }}>إخفاء</button>
      </div> : <span className="muted">الأحداث العادية صامتة</span>}
    </div>
  );
}
