/**
 * CP6.3C — CP6-R27 GCS fail-closed helper.
 *
 * R27 closes the gap left open after R01: when an /api/analyze request carries
 * GCS files but the GCS access token could not be resolved, the request must
 * stop BEFORE any instruction construction, SSE response, or provider call.
 *
 * The guard is a pure function so it can be unit-tested without a server,
 * network, or metadata service. It NEVER logs or returns the token, gsUri,
 * metadata hostname, stack, or err.message.
 */

export interface GcsAvailabilityFailure {
  readonly status: 503;
  readonly message: string;
}

export function gcsUnavailableMessage(): string {
  return "GCS file access is currently unavailable. Please retry later or upload the CSV inline instead.";
}

export function getGcsAvailabilityFailure(
  hasGcsFiles: boolean,
  gcsToken: string | null | undefined,
): GcsAvailabilityFailure | null {
  if (hasGcsFiles && !gcsToken) {
    return Object.freeze({
      status: 503,
      message: gcsUnavailableMessage(),
    });
  }
  return null;
}
