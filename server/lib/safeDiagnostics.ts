/**
 * CP5.3 — Safe diagnostic logging helpers.
 *
 * These helpers NEVER serialize Error objects, error causes, request configs,
 * or payloads into strings. They only emit fixed metadata tokens (an operation
 * name + a diagnostic code) and, when genuinely useful, an error class name
 * drawn from a small allowlist. Raw `err.message`, `err.stack`, and
 * `err.cause` are intentionally never passed to any console call in the
 * analyze / agent / fetch / upload paths.
 *
 * Policy (no raw exception logging):
 *   - never `console.error(err)` / `console.error("...", err)`;
 *   - never print `err.message`, `err.stack`, or `err.cause`;
 *   - never JSON.stringify an Error / request / fetch init;
 *   - never print request payloads, internal URLs, keys, or tokens.
 */

const ALLOWED_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
]);

export type SafeLogLevel = "info" | "warn" | "error";

/**
 * Returns a fixed token for an error's class name, restricted to the allowlist.
 * Anything unknown (including errors whose `name` is attacker-controlled)
 * becomes the constant "UnknownError". Never reads message/stack/cause.
 */
export function safeErrorClass(err: unknown): string {
  if (err instanceof Error && ALLOWED_ERROR_NAMES.has(err.name)) {
    return err.name;
  }
  return "UnknownError";
}

/** True when the error is an AbortError (matched by name only). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Emits a safe diagnostic line: `[<operation>] code=<code> [key=value ...]`.
 * Every value in `extra` must be a scalar produced by the caller (never a
 * derived-from-Error string). No serialization of arbitrary objects.
 */
export function safeLog(
  level: SafeLogLevel,
  operation: string,
  code: string,
  extra?: Record<string, string | number | boolean>,
): void {
  const base = `[${operation}] code=${code}`;
  const detail = extra
    ? " " +
      Object.entries(extra)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")
    : "";
  const line = base + detail;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
