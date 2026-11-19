import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "./_middleware.js";

function makeRequest({
  path = "/api/chat",
  body = JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  origin = "https://hk-ai.pages.dev",
  ip = "203.0.113.10",
  contentLength,
  contentType = "application/json",
  requestHost = "hk-ai.pages.dev",
  requestProtocol = "https:"
} = {}) {
  const headers = new Headers({ "Content-Type": contentType });
  if (origin) headers.set("Origin", origin);
  if (ip) headers.set("CF-Connecting-IP", ip);
  headers.set("CF-Turnstile-Response", "test-turnstile-token");
  if (contentLength !== undefined) headers.set("Content-Length", String(contentLength));
  return new Request(`${requestProtocol}//${requestHost}${path}`, {
    method: "POST",
    headers,
    body
  });
}

function makeEnv({ allowed = true, status = 200, malformed = false, hostname = "hk-ai.pages.dev" } = {}) {
  const calls = [];
  const binding = {
    idFromName(name) {
      calls.push({ id: name });
      return name;
    },
    get(id) {
      return {
        async fetch(url, init) {
          const config = JSON.parse(init.body);
          calls.push({ id, url, config });
          const decision = malformed
            ? { allowed: true, remaining: -1, retryAfter: 0, resetAt: Date.now() + 60_000 }
            : {
                allowed,
                remaining: allowed ? config.limit - 1 : 0,
                retryAfter: allowed ? 0 : 15,
                resetAt: Date.now() + 60_000
              };
          return new Response(JSON.stringify(decision), { status });
        }
      };
    }
  };
  const verificationCalls = [];
  globalThis.fetch = async (url, init) => {
    verificationCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      success: true,
      hostname,
      action: "api"
    }), { status: 200 });
  };
  return {
    env: { HK_RATE_LIMITER: binding, TURNSTILE_SECRET_KEY: "test-secret" },
    calls,
    verificationCalls
  };
}

test("allows a valid API request and applies security headers", async () => {
  const { env, calls } = makeEnv();
  let nextCalled = false;
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => {
      nextCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(nextCalled, true);
  assert.equal(calls.length, 2);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://hk-ai.pages.dev");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "30");
});

test("rejects API requests without a Turnstile token", async () => {
  const { env } = makeEnv();
  const request = makeRequest();
  request.headers.delete("CF-Turnstile-Response");
  const response = await onRequest({
    request,
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "TURNSTILE_TOKEN_REQUIRED");
});

test("fails closed when the Turnstile secret is missing", async () => {
  const { env } = makeEnv();
  delete env.TURNSTILE_SECRET_KEY;
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TURNSTILE_NOT_CONFIGURED");
});

test("validates each token with Cloudflare Siteverify and forwards only valid requests", async () => {
  const { env, verificationCalls } = makeEnv();
  let nextCalled = false;
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => {
      nextCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
  });
  assert.equal(response.status, 200);
  assert.equal(nextCalled, true);
  assert.equal(verificationCalls.length, 1);
  assert.equal(verificationCalls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(verificationCalls[0].body.secret, "test-secret");
  assert.equal(verificationCalls[0].body.response, "test-turnstile-token");
  assert.equal(verificationCalls[0].body.remoteip, "203.0.113.10");
});

test("rejects a Turnstile token issued for a different hostname", async () => {
  const { env } = makeEnv();
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    hostname: "attacker.example"
  }), { status: 200 });
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "TURNSTILE_VERIFICATION_FAILED");
});

test("rejects a valid token with the wrong Turnstile action", async () => {
  const { env } = makeEnv();
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    hostname: "hk-ai.pages.dev",
    action: "login"
  }), { status: 200 });
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "TURNSTILE_VERIFICATION_FAILED");
});

test("fails closed when Cloudflare Siteverify is unavailable", async () => {
  const { env } = makeEnv();
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TURNSTILE_UNAVAILABLE");
});

test("accepts application/json with a charset parameter", async () => {
  const { env } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ contentType: "application/json; charset=utf-8" }),
    env,
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  assert.equal(response.status, 200);
});

test("rejects Content-Type values that only contain application/json as a substring", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ contentType: "application/jsonp" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 415);
  assert.equal(calls.length, 0);
});

test("fails closed when the Durable Object binding is missing", async () => {
  let nextCalled = false;
  const response = await onRequest({
    request: makeRequest(),
    env: {},
    next: async () => {
      nextCalled = true;
      return new Response("should not run");
    }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RATE_LIMITER_BINDING_MISSING");
  assert.equal(nextCalled, false);
});

test("returns 503 when the Durable Object responds with HTTP 503", async () => {
  const { env } = makeEnv({ status: 503 });
  let nextCalled = false;
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => {
      nextCalled = true;
      return new Response("should not run");
    }
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RATE_LIMITER_UNAVAILABLE");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(nextCalled, false);
});

test("returns 429 with Retry-After when the Durable Object denies a request", async () => {
  const { env } = makeEnv({ allowed: false });
  const response = await onRequest({
    request: makeRequest({ path: "/api/image" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "5");
  assert.equal((await response.json()).code, "RATE_LIMITED");
});

test("fails closed on an invalid Durable Object response", async () => {
  const { env } = makeEnv({ malformed: true });
  const response = await onRequest({
    request: makeRequest(),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RATE_LIMITER_INVALID_RESPONSE");
});

test("rejects oversized streamed bodies even without Content-Length", async () => {
  const { env, calls } = makeEnv();
  const body = JSON.stringify({ payload: "x".repeat(66 * 1024) });
  const response = await onRequest({
    request: makeRequest({ path: "/api/tts", body }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 413);
  // The request is charged against the per-IP limit before its streamed body is read.
  assert.equal(calls.length, 2);
});

test("rejects disallowed browser origins", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "https://attacker.example" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("allows a Pages preview to call only its own same-origin API", async () => {
  const previewOrigin = "https://security-early-rate-limit-re.hk-ai.pages.dev";
  const { env } = makeEnv({ hostname: "security-early-rate-limit-re.hk-ai.pages.dev" });
  const response = await onRequest({
    request: makeRequest({ origin: previewOrigin, requestHost: "security-early-rate-limit-re.hk-ai.pages.dev" }),
    env,
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), previewOrigin);
});

test("does not allow a Pages preview origin to call the Production API", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "https://security-early-rate-limit-re.hk-ai.pages.dev" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("rejects the legacy preview origin when calling the Production API", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "https://feature-chat-image-generatio.hk-ai.pages.dev" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("allows localhost only for its own same-origin local API", async () => {
  const { env } = makeEnv({ hostname: "localhost" });
  const response = await onRequest({
    request: makeRequest({
      origin: "http://localhost",
      requestHost: "localhost",
      requestProtocol: "http:"
    }),
    env,
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost");
});

test("allows Android Capacitor origin only with a production-hosted Turnstile token", async () => {
  const { env, verificationCalls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "http://localhost" }),
    env,
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  assert.equal(response.status, 200);
  assert.equal(verificationCalls[0].body.response, "test-turnstile-token");
});

test("allows iOS Capacitor origin only with a production-hosted Turnstile token", async () => {
  const { env, verificationCalls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "capacitor://localhost" }),
    env,
    next: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
  });
  assert.equal(response.status, 200);
  assert.equal(verificationCalls[0].body.response, "test-turnstile-token");
});

test("rejects arbitrary Cloudflare Pages preview origins", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ origin: "https://untrusted-preview.hk-ai.pages.dev" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test("rejects requests when Content-Length is malformed", async () => {
  const { env, calls } = makeEnv();
  const response = await onRequest({
    request: makeRequest({ contentLength: "not-a-number" }),
    env,
    next: async () => new Response("should not run")
  });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
