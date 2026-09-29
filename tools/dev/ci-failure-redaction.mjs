const bearerPattern = /(\bBearer\s+)[\w.~+/-]{8,}={0,2}/gi;
const tokenPattern = /\b(?:gh[pousr]_\w{20,}|github_pat_\w{20,}|sk-[\w-]{20,})\b/g;
const jwtPattern = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g;
const urlCredentialPattern = /(https?:\/\/[^\s/:]+:)[^\s/@]+(@)/gi;
const jsonSecretPattern = /("(?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)"\s*:\s*)"[^"\r\n]*"/gi;
const doubleQuotedSecretPattern = /((?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[=:]\s*)"[^"\s,&;}\]]+"/gi;
const singleQuotedSecretPattern = /((?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[=:]\s*)'[^'\s,&;}\]]+'/gi;
const unquotedSecretPattern = /((?:password|secret|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[=:]\s*)[^\s,"'&;}\]]+/gi;

export function redactFailureArtifact(value, sensitiveValues = new Map()) {
  let text = String(value ?? "");
  for (const [secret, name] of [...sensitiveValues].sort((left, right) => right[0].length - left[0].length)) {
    text = text.split(secret).join(`[REDACTED:${name}]`);
  }
  return text
    .replace(bearerPattern, "$1[REDACTED:bearer]")
    .replace(tokenPattern, "[REDACTED:token]")
    .replace(jwtPattern, "[REDACTED:jwt]")
    .replace(urlCredentialPattern, "$1[REDACTED:credential]$2")
    .replace(jsonSecretPattern, '$1"[REDACTED]"')
    .replace(doubleQuotedSecretPattern, '$1"[REDACTED]"')
    .replace(singleQuotedSecretPattern, "$1'[REDACTED]'")
    .replace(unquotedSecretPattern, "$1[REDACTED]");
}
