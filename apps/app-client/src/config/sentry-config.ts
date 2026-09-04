import Constants from "expo-constants";

export type SentryRuntimeConfig = {
  readonly dsn: string | undefined;
  readonly environment: string;
  readonly tracesSampleRate: number;
  readonly debug: boolean;
  readonly startupProbe: boolean;
};

type ExpoSentryExtra = {
  readonly dsn?: unknown;
  readonly environment?: unknown;
  readonly tracesSampleRate?: unknown;
  readonly debug?: unknown;
  readonly startupProbe?: unknown;
};

type ExpoExtra = {
  readonly sentry?: ExpoSentryExtra;
};

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function boundedSampleRate(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function resolveSentryRuntimeConfig(): SentryRuntimeConfig {
  const extra = Constants.expoConfig?.extra as ExpoExtra | undefined;
  const sentry = extra?.sentry;
  return {
    dsn: optionalString(sentry?.dsn),
    environment: optionalString(sentry?.environment) ?? "development",
    tracesSampleRate: boundedSampleRate(sentry?.tracesSampleRate),
    debug: booleanValue(sentry?.debug),
    startupProbe: booleanValue(sentry?.startupProbe),
  };
}
