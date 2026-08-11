/**
 * CP6.3C — CP6-R27 GCS fail-closed helper tests (node:test via tsx).
 *
 * - pure unit tests for getGcsAvailabilityFailure: no network, no metadata
 *   service, no server.ts import, no provider call;
 * - only covers the DECISION the helper makes;
 * - the early-return position before createInteraction is proven by source
 *   inspection (documented in the CP6.3C evidence report), not at runtime.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getGcsAvailabilityFailure,
  gcsUnavailableMessage,
} from "../server/lib/gcsAvailability.ts";

test("T1 GCS + null token -> 503 failure with fixed public message", () => {
  const result = getGcsAvailabilityFailure(true, null);
  assert.ok(result, "must reject when GCS files lack a token");
  assert.equal(result.status, 503);
  assert.equal(result.message, gcsUnavailableMessage());
  assert.equal(Object.isFrozen(result), true, "failure descriptor must be frozen");
});

test("T2 GCS + undefined token -> 503 failure", () => {
  const result = getGcsAvailabilityFailure(true, undefined);
  assert.ok(result, "undefined token must be treated as missing");
  assert.equal(result.status, 503);
});

test("T3 GCS + empty string token -> 503 failure", () => {
  const result = getGcsAvailabilityFailure(true, "");
  assert.ok(result, "empty token must be treated as missing");
  assert.equal(result.status, 503);
});

test("T4 GCS + valid token -> continue (null)", () => {
  assert.equal(getGcsAvailabilityFailure(true, "token-abc"), null);
});

test("T5 non-GCS + null token -> continue (null)", () => {
  assert.equal(getGcsAvailabilityFailure(false, null), null);
});

test("T6 non-GCS + valid token -> continue (null)", () => {
  assert.equal(getGcsAvailabilityFailure(false, "token-abc"), null);
});

test("T7 mixed inline/GCS (hasGcsFiles true) + null token -> 503", () => {
  const result = getGcsAvailabilityFailure(true, null);
  assert.ok(result);
  assert.equal(result.status, 503);
  assert.equal(result.message, gcsUnavailableMessage());
});

test("T8 response descriptor leaks no token, gsUri, hostname, stack, or err.message", () => {
  const result = getGcsAvailabilityFailure(true, null);
  assert.ok(result);
  const serialized = JSON.stringify({ error: result.message });
  const leakMarkers = [
    "token",
    "gsUri",
    "gs://",
    "metadata.google.internal",
    "stack",
    "SyntaxError",
    "at ",
    "err.message",
    "GCS access token present",
    "createInteraction",
  ];
  for (const marker of leakMarkers) {
    assert.ok(
      !serialized.includes(marker),
      `failure message must not contain "${marker}"`,
    );
  }
  assert.deepEqual(JSON.parse(serialized), {
    error: gcsUnavailableMessage(),
  });
});
