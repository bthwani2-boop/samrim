// Display only elapsed time since a proven DSH Order transition.
// This is not an SLA target or an estimate based on updatedAt.
export function operationalStageElapsed(stageStartedAt: string | null | undefined, now: number): string | null {
  if (!stageStartedAt || !Number.isFinite(now)) return null;
  const started = Date.parse(stageStartedAt);
  if (!Number.isFinite(started) || started > now + 60_000) return null;
  const minutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (minutes < 60) return `في المرحلة منذ ${minutes.toLocaleString("ar-YE")} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `في المرحلة منذ ${hours.toLocaleString("ar-YE")} ساعة`;
  return `في المرحلة منذ ${Math.floor(hours / 24).toLocaleString("ar-YE")} يوم`;
}

export function operationalStageAttention(state: string, stageStartedAt: string | null | undefined, now: number): { needsReview: boolean; label: string } | null {
  if (!["CREATED", "PARTNER_ACCEPTED", "PREPARING"].includes(state)) return null;
  if (!stageStartedAt || !Number.isFinite(now)) return { needsReview: true, label: "بداية المرحلة غير موثقة؛ تحتاج مراجعة" };
  const startedAt = Date.parse(stageStartedAt);
  if (!Number.isFinite(startedAt) || startedAt > now + 60_000) return { needsReview: true, label: "تعذر التحقق من وقت المرحلة" };
  const needsReview = now - startedAt >= 30 * 60_000;
  return {
    needsReview,
    label: needsReview ? "المرحلة مستمرة منذ 30 دقيقة أو أكثر" : "",
  };
}
