// Cookies are shared by tabs at this origin. Hold the browser's exclusive
// lock until the request has completed, including its Set-Cookie processing.
// Never fall back to a competing credential rotation on unsupported browsers.
export async function withOperatorBrowserSession<T>(action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("تعذر تنسيق جلسة المشغّل بين تبويبات المتصفح.");
  return navigator.locks.request("bthwani-operator-session", { mode: "exclusive", signal: AbortSignal.timeout(20_000) }, action);
}

const channelName = "bthwani-operator-session";
export function notifyOperatorSessionChanged(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(channelName);
    try { channel.postMessage("changed"); } finally { channel.close(); }
  } catch { /* Visibility and periodic owner verification remain authoritative. */ }
}

export function subscribeOperatorSessionChanged(onChange: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  try {
    const channel = new BroadcastChannel(channelName);
    channel.onmessage = event => { if (event.data === "changed") onChange(); };
    return () => channel.close();
  } catch { return () => {}; }
}
