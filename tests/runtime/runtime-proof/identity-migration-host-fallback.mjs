const hostPostgresFallbackPatterns = [
  /\bpostgres(?:ql)?:\/\/(?:[^@\s]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|[?\s"'`]|$)/i,
  /\bhost\s*=\s*(?:localhost|127\.0\.0\.1|::1|\[::1\])\b/i,
  /(?:localhost|127\.0\.0\.1|\[::1\]):55432\b/i,
];

export function containsHostPostgresFallback(source) {
  return hostPostgresFallbackPatterns.some((pattern) => pattern.test(source));
}
