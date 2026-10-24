"use client";

import type { Notification } from "@bthwani/dsh";
import { OrderAlertCursor } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { operationNotificationHref } from "../notifications/notification-operation-link";
import { parseOperatorNotificationList } from "../notifications/notification-readback";

const LEVEL_KEY = "bthwani:operations-alert-volume:v1";

// Browser sound requires a user gesture. Notifications remain visible when muted.
export function OperationsAlertMonitor() {
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(65);
  const [alert, setAlert] = useState<Notification | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const cursor = useRef(new OrderAlertCursor());
  const pending = useRef(false);
  const enabledRef = useRef(false);
  const volumeRef = useRef(65);

  useEffect(() => {
    try {
      const level = Number(window.localStorage.getItem(LEVEL_KEY));
      if (Number.isFinite(level) && level >= 0 && level <= 100) {
        setVolume(level);
        volumeRef.current = level;
      }
    } catch { /* Storage may be blocked. */ }
    return () => { void audio.current?.close(); audio.current = null; };
  }, []);

  const play = useCallback(() => {
    if (!enabledRef.current || !audio.current || audio.current.state !== "running") return;
    const ctx = audio.current;
    const start = ctx.currentTime;
    for (const [offset, frequency] of [[0, 720], [0.19, 940]] as const) {
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
      if (disposed || pending.current || document.visibilityState !== "visible") return;
      pending.current = true;
      try {
        const result = await fetch("/api/notifications?limit=40", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!result.ok) return;
        const list = parseOperatorNotificationList(await result.json()).notifications;
        if (disposed) return;
        const incoming = cursor.current.receive("operator", "operator", list);
        // Recovery takes precedence over a stale failure in the returned page.
        const latestOrderEvent = new Map<string, string>();
        for (const item of list) if (item.orderId && !latestOrderEvent.has(item.orderId)) latestOrderEvent.set(item.orderId, item.kind);
        const active = incoming.filter(item => latestOrderEvent.get(item.orderId) === "DELIVERY_FAILED");
        if (!active.length) {
          setAlert(current => current && latestOrderEvent.get(current.orderId) !== "DELIVERY_FAILED" ? null : current);
          return;
        }
        const newest = active.at(-1)!;
        setAlert(newest);
        play();
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
  }, [play]);

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
    try { window.localStorage.setItem(LEVEL_KEY, String(next)); } catch { /* Storage blocked */ }
  }

  const orderHref = alert ? operationNotificationHref(alert.orderId) : null;
  return (
    <div className="ops-alert-monitor" aria-label="تنبيهات العمليات" style={{ display:"flex", flexWrap:"wrap", alignItems:"center", gap:12, marginBlock: "0 12px" }}>
      <button className="button button-secondary" type="button" aria-pressed={enabled} onClick={() => void toggleSound()}>
        {enabled ? "كتم صوت العمليات" : "تفعيل صوت العمليات"}
      </button>
      {enabled ? <label style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
        مستوى الصوت
        <input type="range" min="0" max="100" step="5" value={volume} onChange={e => changeVolume(Number(e.target.value))} aria-label="مستوى صوت تنبيهات العمليات" />
        <span>{volume}%</span>
      </label> : null}
      {alert ? <div role="alert" style={{ display:"inline-flex", flexWrap:"wrap", alignItems:"center", gap:8 }}>
        <strong>تعذر توصيل طلب ويحتاج تدخلاً</strong>
        {orderHref ? <Link href={orderHref} className="button button-secondary">فتح الطلب</Link> : null}
        <button className="button button-secondary" type="button" onClick={() => setAlert(null)}>إخفاء</button>
      </div> : <span className="muted">الأحداث العادية صامتة</span>}
    </div>
  );
}
