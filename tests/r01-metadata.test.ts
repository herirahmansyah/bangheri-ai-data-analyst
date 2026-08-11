/**
 * CP6.1B — R01 metadata-fix resolver tests (node:test via tsx).
 *
 * - stubs globalThis.fetch BEFORE the resolver runs;
 * - never imports server.ts (importing it starts the listener);
 * - restores fetch safely after every test;
 * - tests run serially within this file (node:test default), so there is no
 *   cross-test race on the shared global fetch stub.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGcsToken } from "../server/lib/gcpToken.ts";

const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

type FetchImpl = (
  url: string,
  init?: RequestInit,
) => unknown;

function installFetchStub(impl: FetchImpl) {
  const original = globalThis.fetch;
  let calls = 0;
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls += 1;
    urls.push(String(url));
    inits.push(init);
    return impl(String(url), init);
  }) as typeof fetch;
  return {
    calls: () => calls,
    urls: () => urls,
    inits: () => inits,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function okResponse(jsonBody: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => jsonBody,
  } as unknown as Response;
}

function nonOkResponse() {
  return { ok: false, status: 500 } as unknown as Response;
}

test("R01-A NON-GCS: resolveGcsToken(false) -> null, zero fetch", async () => {
  const stub = installFetchStub((url) => okResponse({ access_token: "x" }));
  try {
    const result = await resolveGcsToken(false);
    assert.equal(result, null);
    assert.equal(stub.calls(), 0, "must not call fetch for non-GCS");
    assert.deepEqual(stub.urls(), [], "no fetch URL recorded");
  } finally {
    stub.restore();
  }
});

test("R01-B GCS SUCCESS: one fetch, correct URL/header, stub token used", async () => {
  const stub = installFetchStub((url) =>
    okResponse({ access_token: "stub-token" }),
  );
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, "stub-token");
    assert.equal(stub.calls(), 1, "exactly one metadata attempt");
    assert.equal(stub.urls()[0], METADATA_URL, "correct metadata URL");
    const init = stub.inits()[0];
    assert.equal(
      (init?.headers as Record<string, string>)?.["Metadata-Flavor"],
      "Google",
      "correct Metadata-Flavor header",
    );
  } finally {
    stub.restore();
  }
});

test("R01-C THROW: one fetch, result null, no retry", async () => {
  const stub = installFetchStub(() => {
    throw new Error("metadata down");
  });
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null, "failure must resolve to null");
    assert.equal(stub.calls(), 1, "no second attempt after failure");
  } finally {
    stub.restore();
  }
});

test("R01-D HTTP NON-OK: one fetch, result null", async () => {
  const stub = installFetchStub(() => nonOkResponse());
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null);
    assert.equal(stub.calls(), 1, "exactly one attempt");
  } finally {
    stub.restore();
  }
});

test("R01-E MALFORMED TOKEN: one fetch, result null", async () => {
  const stub = installFetchStub(() => okResponse({}));
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null, "missing access_token -> null");
    assert.equal(stub.calls(), 1, "exactly one attempt");
  } finally {
    stub.restore();
  }

  const stub2 = installFetchStub(() =>
    okResponse({ access_token: "not-a-real-token" }),
  );
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, "not-a-real-token", "string token passes through");
    assert.equal(stub2.calls(), 1, "exactly one attempt");
  } finally {
    stub2.restore();
  }
});

test("R01-F EMPTY TOKEN: access_token='' -> null, one fetch", async () => {
  const stub = installFetchStub(() => okResponse({ access_token: "" }));
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null, "empty token -> null");
    assert.equal(stub.calls(), 1, "exactly one attempt");
  } finally {
    stub.restore();
  }
});

test("R01-G WHITESPACE TOKEN: access_token=' \\t ' -> null, one fetch", async () => {
  const stub = installFetchStub(() =>
    okResponse({ access_token: " \t " }),
  );
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null, "whitespace token -> null");
    assert.equal(stub.calls(), 1, "exactly one attempt");
  } finally {
    stub.restore();
  }
});

test("R01-H MALFORMED JSON: res.json() throws SyntaxError -> null, one fetch, no retry", async () => {
  const stub = installFetchStub(
    () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError(
            "Unexpected token < in JSON at position 0",
          );
        },
      }) as unknown as Response,
  );
  try {
    const result = await resolveGcsToken(true);
    assert.equal(result, null, "malformed JSON body -> null");
    assert.equal(stub.calls(), 1, "exactly one attempt, no retry");
  } finally {
    stub.restore();
  }
});
