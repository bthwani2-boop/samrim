const PLACEHOLDERS = new Set(["رسالة صوتية", "تسجيل صوتي", "voice message"]);

/** Voice messages without an author-provided transcript remain explicitly uncaptioned. */
export function audioMessageTranscript(body: string): string | null {
  const normalized = body.replace(/\s+/gu, " ").trim();
  if (!normalized || PLACEHOLDERS.has(normalized.toLowerCase())) return null;
  return normalized;
}

/** VTT remains entirely in-memory in the operator's browser, never in a public media URL. */
export function audioMessageCaptionUrl(body: string): string | null {
  const transcript = audioMessageTranscript(body);
  if (!transcript) return null;
  const escaped = transcript.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const vtt = `WEBVTT

00:00:00.000 --> 01:00:00.000
${escaped}
`;
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(vtt)}`;
}
