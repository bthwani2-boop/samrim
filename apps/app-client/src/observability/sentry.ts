import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import { resolveSentryRuntimeConfig } from "../config/sentry-config";

const FORBIDDEN_KEY = /(authorization|cookie|token|secret|password|phone|email|operator_context|iban|account|card|wallet|ledger|message|document|latitude|longitude)/i;

function scrubRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = FORBIDDEN_KEY.test(key) ? "[Filtered]" : entry;
  }
  return sanitized;
}

function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0]?.split("#")[0];
  }
}

/**
 * Technical crash reporting only. Identity, operator context, financial and message truth
 * remain in their sovereign services and are deliberately filtered here.
 */
export function initSentry(): boolean {
  const config = resolveSentryRuntimeConfig();
  if (!config.dsn) return false;

  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const surface = typeof extra?.["appKey"] === "string" ? extra["appKey"] : "app-client";
  const appLine = typeof extra?.["appLine"] === "string" ? extra["appLine"] : "next";

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    debug: config.debug,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    // EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE is resolved only by the config layer.
    tracesSampleRate: config.tracesSampleRate,
    initialScope: {
      tags: { surface, appLine },
    },
    beforeBreadcrumb(breadcrumb) {
      const sanitized = { ...breadcrumb };
      if (FORBIDDEN_KEY.test(breadcrumb.category || "")) sanitized.message = "[Filtered]";
      const data = scrubRecord(breadcrumb.data);
      if (data) sanitized.data = data;
      else delete sanitized.data;
      return sanitized;
    },
    beforeSend(event) {
      if (event.user?.id) event.user = { id: event.user.id };
      else delete event.user;

      const extraData = scrubRecord(event.extra);
      if (extraData) event.extra = extraData;
      else delete event.extra;

      if (event.request) {
        const safeUrl = sanitizeUrl(event.request.url);
        if (safeUrl) event.request.url = safeUrl;
        else delete event.request.url;
        const request = event.request as unknown as Record<string, unknown>;
        for (const key of ["data", "cookies", "env", "headers"]) delete request[key];
      }
      return event;
    },
  });

  if (config.startupProbe) {
    Sentry.captureMessage("bthwani.mobile.sentry.startup", "info");
  }
  return true;
}
