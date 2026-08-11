/**
 * CP5.2 — Upstream (Gemini Interactions API / snapshot) error sanitization.
 *
 * The browser must NEVER receive a raw upstream response body, an upstream
 * header, a stack trace, a request payload, an environment token, or an
 * internal URL. Raw upstream bodies can echo secret material (most notably a
 * prefix of the caller's API key), so the connection is cancelled/discarded
 * WITHOUT reading the body (see server.ts: `response.body.cancel()`); the body
 * is never logged, stored, or forwarded.
 *
 * Mapping is STATUS-BASED only. Google's API returns meaningful, stable
 * status codes for the conditions that matter here:
 *   401 / 403 → the key was rejected or lacks access
 *   404       → the agent / session resource is unavailable
 *   429       → quota / provider rate limit
 *   5xx       → provider temporarily unavailable
 *   anything else → unexpected
 */

export type UpstreamErrorKind =
  | "credentials"
  | "not_found"
  | "quota"
  | "provider_unavailable"
  | "unexpected";

export function classifyUpstreamError(status: number): UpstreamErrorKind {
  if (status === 401 || status === 403) return "credentials";
  if (status === 404) return "not_found";
  if (status === 429) return "quota";
  if (status >= 500) return "provider_unavailable";
  return "unexpected";
}

/** Safe, human-readable message sent to the browser (never raw upstream text). */
export function upstreamErrorMessage(kind: UpstreamErrorKind): string {
  switch (kind) {
    case "credentials":
      return "The Gemini API key was rejected or does not have access to the analysis agent. Check the key and billing in Google AI Studio, then try again.";
    case "not_found":
      return "The analysis agent or session resource is not available. Start a fresh analysis by uploading your CSV files again.";
    case "quota":
      return "The Gemini API reported a quota or rate-limit error. Your key may have exceeded its request quota; check usage in Google AI Studio and try again later.";
    case "provider_unavailable":
      return "The analysis provider is temporarily unavailable. Please try again in a few minutes.";
    case "unexpected":
      return "The analysis provider returned an unexpected response. Please try again.";
  }
}
