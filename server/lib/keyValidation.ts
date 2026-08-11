/**
 * CP5.2 — Single, centralized BYOK Gemini key validator.
 *
 * Used by THREE call sites so behavior cannot drift:
 *   1. POST /api/key-check       (format-only UX hint, offline)
 *   2. POST /api/analyze middleware (rejects before fingerprint / catalog / network)
 *   3. POST /api/analyze handler    (defense in depth, same rule)
 *
 * Accepted format (the ONLY definition of "valid" — no prefix such as "AIza"
 * is required, because no published contract guarantees every supported key
 * uses one):
 *   - a single string header value (arrays / non-strings rejected);
 *   - non-empty after trim;
 *   - printable ASCII 0x21-0x7E only — this rejects ALL control characters
 *     (CR/LF/NUL/ESC/TAB), whitespace, DEL, and any Unicode/multi-byte input;
 *   - UTF-8 length <= BYOK_KEY_MAX_BYTES (1024 bytes) — a conservative bound
 *     so extreme inputs fail fast without any 500.
 *
 * Validation is cheap and allocation-bounded. It NEVER logs, stores, or
 * returns the key value itself — only a `valid` boolean / failure reason.
 */

export const BYOK_KEY_MAX_BYTES = 1024;

export type KeyValidationFailureReason =
  | "MISSING"
  | "MULTIPLE_VALUES"
  | "NOT_STRING"
  | "BLANK"
  | "INVALID_CHARS"
  | "TOO_LONG";

export type KeyValidationResult =
  | { valid: true; reason: null }
  | { valid: false; reason: KeyValidationFailureReason };

/** Printable ASCII (no space, no control chars, no Unicode). */
const PRINTABLE_ASCII = /^[\x21-\x7E]+$/;

export function validateApiKey(raw: unknown): KeyValidationResult {
  if (raw === undefined || raw === null) {
    return { valid: false, reason: "MISSING" };
  }
  if (Array.isArray(raw)) {
    // Multiple `x-gemini-api-key` headers → ambiguous, reject.
    return { valid: false, reason: "MULTIPLE_VALUES" };
  }
  if (typeof raw !== "string") {
    return { valid: false, reason: "NOT_STRING" };
  }
  if (raw.trim() === "") {
    return { valid: false, reason: "BLANK" };
  }
  // Byte-length check first (cheap, handles extreme Unicode inputs).
  if (Buffer.byteLength(raw, "utf8") > BYOK_KEY_MAX_BYTES) {
    return { valid: false, reason: "TOO_LONG" };
  }
  if (!PRINTABLE_ASCII.test(raw)) {
    return { valid: false, reason: "INVALID_CHARS" };
  }
  return { valid: true, reason: null };
}
