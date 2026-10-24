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

export function operationalStageAttention(state: string, stageStartedAt: string | null | undefined, now: number, preparationMinutes?: number | null): { needsReview: boolean; label: string } | null {
  if (!["CREATED", "PARTNER_ACCEPTED", "PREPARING"].includes(state)) return null;
  if (!stageStartedAt || !Number.isFinite(now)) return { needsReview: true, label: "بداية المرحلة غير موثقة؛ تحتاج مراجعة" };
  const startedAt = Date.parse(stageStartedAt);
  if (!Number.isFinite(startedAt) || startedAt > now + 60_000) return { needsReview: true, label: "تعذر التحقق من وقت المرحلة" };
  const configuredPreparation = state === "PREPARING" && Number.isInteger(preparationMinutes)
    && typeof preparationMinutes === "number" && preparationMinutes >= 1 && preparationMinutes <= 1440;
  // 30 minutes is an operational attention fallback, not a contractual SLA.
  const targetMinutes = configuredPreparation ? preparationMinutes : 30;
  const elapsed = now - startedAt;
  const target = targetMinutes * 60_000;
  const needsReview = elapsed >= target;
  const remaining = Math.max(1, Math.ceil((target - elapsed) / 60_000));
  const overdue = Math.floor((elapsed - target) / 60_000);
  const source = configuredPreparation ? "مدة التجهيز المحددة" : "حد المتابعة التشغيلي التقريبي";
  return {
    needsReview,
    label: needsReview
      ? `تجاوز ${source} (${targetMinutes} د) بـ ${overdue.toLocaleString("ar-YE")} د`
      : `بقي ${remaining.toLocaleString("ar-YE")} د حتى ${source}`,
  };
}


// Contractual deadline display only when DSH provides an approved stage-effective policy.
export function operationalSlaAttention(item: Readonly<{
  slaStatus?: string | null;
  slaDeadlineAt?: string | null;
  slaPolicyVersion?: number | null;
}>, now: number): { needsReview: boolean; label: string } | null {
  if (item.slaStatus === "MISSING_EVENT") return { needsReview: true, label: "لا يمكن حساب مهلة SLA: بداية المرحلة غير موثقة" };
  if (!["ON_TRACK", "AT_RISK", "OVERDUE"].includes(item.slaStatus ?? "")) return null;
  if (!item.slaDeadlineAt || !Number.isSafeInteger(item.slaPolicyVersion) || (item.slaPolicyVersion ?? 0) < 1) {
    return { needsReview: true, label: "تعذر التحقق من مهلة SLA المعتمدة" };
  }
  const deadline = Date.parse(item.slaDeadlineAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return { needsReview: true, label: "تعذر قراءة توقيت SLA" };
  const elapsed = now - deadline;
  if (elapsed >= 0) return { needsReview: true, label: "SLA متأخر " + Math.floor(elapsed / 60000).toLocaleString("ar-YE") + " دقيقة" };
  const remaining = Math.max(1, Math.ceil(-elapsed / 60000));
  const prefix = item.slaStatus === "AT_RISK" ? "SLA يقترب من التأخر" : "SLA ضمن المهلة";
  return { needsReview: item.slaStatus === "AT_RISK", label: prefix + " · متبقٍ " + remaining.toLocaleString("ar-YE") + " دقيقة" };
}
