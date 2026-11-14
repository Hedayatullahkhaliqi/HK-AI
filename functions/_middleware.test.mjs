import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "./_middleware.js";

function makeRequest({
  path = "/api/chat",
  body = JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  origin = "https://hk-ai.pages.dev",
  ip = "203.0.113.10",
  contentLength
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  if (ip) headers.set("CF-Connecting-IP", ip);
  if (contentLength !== undefined) headers.set("Content-Length", String(contentLength));
  return new Request(`https://hk-ai.pages.dev${path}`, {
    method: "POST",
    headers,
    body
  });
}

function makeEnv({ allowed = true, status = 200, malformed = false } = {}) {
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
  return { env: { HK_RATE_LIMITER: binding }, calls };
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
  assert.equal(calls.length, 0);
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
