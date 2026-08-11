/**
 * CP6.1B — Single, centralized GCS access-token resolver.
 *
 * R01 fix: the GCP metadata endpoint is only consulted when the analysis
 * actually needs it (hasGcsFiles === true), and at most ONE attempt is made.
 * The previous unconditional `if (!gcsToken)` fallback in server.ts was
 * removed — it caused a second metadata attempt when the first failed and an
 * unnecessary metadata call on every non-GCS request.
 *
 * Guarantees:
 *   - resolveGcsToken(false) -> null, ZERO fetch calls;
 *   - resolveGcsToken(true)  -> exactly ONE metadata attempt;
 *   - success        -> access token string;
 *   - non-string / empty / whitespace-only token -> null;
 *   - throw / non-OK / malformed response -> null (no retry);
 *   - never logs/prints the token or any raw sensitive response.
 */

import {
  safeErrorClass,
  safeLog,
} from "./safeDiagnostics.ts";

export async function resolveGcsToken(
  hasGcsFiles: boolean,
): Promise<string | null> {
  if (!hasGcsFiles) {
    return null;
  }
  return getGcpAccessToken();
}

async function getGcpAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
      },
    );
    if (res.ok) {
      const data: any = await res.json();
      const token = data.access_token;
      return typeof token === "string" && token.trim().length > 0
        ? token
        : null;
    }
  } catch (err) {
    safeLog("warn", "gcp-token", "METADATA_FETCH_FAILED", {
      error_class: safeErrorClass(err),
    });
  }
  return null;
}
