/**
 * Canonical client-side password input shape validator.
 * Validates Unicode length (8 to 128 characters), non-whitespace, and optional confirmation matching.
 * Full security validation (blocklists, normalization, Argon2id hashing) remains server authority.
 */
export function countUnicodeRunes(text: string): number {
  return Array.from(text).length;
}

export type PasswordShapeValidationResult = Readonly<{
  valid: boolean;
  code?: "EMPTY" | "TOO_SHORT" | "TOO_LONG" | "MISMATCH" | undefined;
  message?: string | undefined;
}>;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function validatePasswordInputShape(password: string, confirmation?: string): PasswordShapeValidationResult {
  if (!password || !password.trim()) {
    return { valid: false, code: "EMPTY", message: "كلمة المرور مطلوبة" };
  }
  const length = countUnicodeRunes(password);
  if (length < MIN_PASSWORD_LENGTH) {
    return { valid: false, code: "TOO_SHORT", message: `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} حرفاً على الأقل` };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return { valid: false, code: "TOO_LONG", message: `كلمة المرور يجب ألا تتجاوز ${MAX_PASSWORD_LENGTH} حرفاً` };
  }
  if (confirmation !== undefined && password !== confirmation) {
    return { valid: false, code: "MISMATCH", message: "كلمتا المرور غير متطابقتين" };
  }
  return { valid: true };
}
