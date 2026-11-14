import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/index.mjs";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
  }

  async transaction(callback) {
    const operation = this.tail.then(async () => {
      const staged = new Map(this.values);
      const transaction = {
        get: async key => staged.get(key),
        put: async (key, value) => staged.set(key, structuredClone(value))
      };
      const result = await callback(transaction);
      this.values = staged;
      return result;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}

function createLimiter() {
  const storage = new MemoryStorage();
  const limiter = new RateLimiter({ storage });
  return { limiter, storage };
}

function request(body, method = "POST") {
  return new Request("https://rate-limiter.internal/check", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("allows requests below the configured limit", async () => {
  const { limiter } = createLimiter();
  const response = await limiter.fetch(request({ limit: 2, windowMs: 60_000 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    allowed: true,
    remaining: 1,
    retryAfter: 0,
    resetAt: Date.now() + 60_000
  });
});

test("blocks requests at the limit and returns Retry-After", async () => {
  const { limiter } = createLimiter();
  await limiter.fetch(request({ limit: 1, windowMs: 60_000 }));
  const response = await limiter.fetch(request({ limit: 1, windowMs: 60_000 }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.allowed, false);
  assert.equal(body.remaining, 0);
  assert.ok(body.retryAfter >= 1 && body.retryAfter <= 60);
});

test("serializes concurrent requests without exceeding the limit", async () => {
  const { limiter } = createLimiter();
  const responses = await Promise.all(
    Array.from({ length: 40 }, () =>
      limiter.fetch(request({ limit: 10, windowMs: 60_000 }))
    )
  );
  const decisions = await Promise.all(responses.map(response => response.json()));
  assert.equal(decisions.filter(result => result.allowed).length, 10);
  assert.equal(decisions.filter(result => !result.allowed).length, 30);
});

test("expires old timestamps outside the sliding window", async () => {
  const { limiter } = createLimiter();
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    await limiter.fetch(request({ limit: 1, windowMs: 10_000 }));
    const blocked = await limiter.fetch(request({ limit: 1, windowMs: 10_000 }));
    assert.equal((await blocked.json()).allowed, false);

    now += 10_001;
    const allowed = await limiter.fetch(request({ limit: 1, windowMs: 10_000 }));
    assert.equal((await allowed.json()).allowed, true);
  } finally {
    Date.now = originalNow;
  }
});

test("rejects invalid limits and methods", async () => {
  const { limiter } = createLimiter();
  const invalid = await limiter.fetch(request({ limit: 0, windowMs: 60_000 }));
  assert.equal(invalid.status, 400);

  const method = await limiter.fetch(request({}, "GET"));
  assert.equal(method.status, 405);
});

test("does not expose the Worker as a public HTTP API", async () => {
  const { default: worker } = await import("../src/index.mjs");
  const response = await worker.fetch(new Request("https://example.workers.dev/"));
  assert.equal(response.status, 404);
});
