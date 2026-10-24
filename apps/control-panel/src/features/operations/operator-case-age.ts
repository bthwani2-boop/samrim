// Case age is operational elapsed time, never a contractual SLA deadline.
export function formatOperatorCaseAge(openedAt: string, clock: number | null): string {
 if (clock === null || !Number.isFinite(clock)) return "";
 const started = Date.parse(openedAt);
 if (!Number.isFinite(started) || started > clock + 60_000) return "المدة غير مؤكدة";
 const elapsed = Math.max(0, clock - started);
 const minutes = Math.floor(elapsed / 60_000);
 if (minutes < 1) return "الآن";
 if (minutes < 60) return `منذ ${minutes} د`;
 const hours = Math.floor(minutes / 60);
 if (hours < 24) return `منذ ${hours} س`;
 return `منذ ${Math.floor(hours / 24)} يوم`;
}
