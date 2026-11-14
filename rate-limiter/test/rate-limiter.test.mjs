import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/index.mjs";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
    this.alarmAt = null;
  }

  async transaction(callback) {
    const operation = this.tail.then(async () => {
      const staged = new Map(this.values);
      let stagedAlarm = this.alarmAt;
      const transaction = {
        get: async key => staged.get(key),
        put: async (key, value) => staged.set(key, structuredClone(value)),
        delete: async key => staged.delete(key),
        getAlarm: async () => stagedAlarm,
        setAlarm: async timestamp => { stagedAlarm = timestamp; },
        deleteAlarm: async () => { stagedAlarm = null; }
      };
      const result = await callback(transaction);
      this.values = staged;
      this.alarmAt = stagedAlarm;
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

test("allows requests below the configured limit and schedules cleanup", async () => {
  const { limiter, storage } = createLimiter();
  const response = await limiter.fetch(request({ limit: 2, windowMs: 60_000 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.allowed, true);
  assert.equal(body.remaining, 1);
  assert.equal(body.retryAfter, 0);
  assert.ok(body.resetAt >= Date.now() + 59_000);
  assert.ok(body.resetAt <= Date.now() + 60_000);
  assert.equal(storage.alarmAt, body.resetAt);
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

test("alarm removes expired timestamps and clears its schedule", async () => {
  const { limiter, storage } = createLimiter();
  const originalNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;

  try {
    await limiter.fetch(request({ limit: 2, windowMs: 10_000 }));
    assert.ok(storage.values.has("request-timestamps"));
    assert.equal(storage.alarmAt, now + 10_000);

    now += 10_001;
    await limiter.alarm();
    assert.equal(storage.values.has("request-timestamps"), false);
    assert.equal(storage.alarmAt, null);
  } finally {
    Date.now = originalNow;
  }
});

test("alarm keeps later active timestamps and reschedules cleanup", async () => {
  const { limiter, storage } = createLimiter();
  const originalNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;

  try {
    await limiter.fetch(request({ limit: 3, windowMs: 10_000 }));
    now += 5_000;
    await limiter.fetch(request({ limit: 3, windowMs: 10_000 }));
    now += 5_001;
    await limiter.alarm();

    const stored = storage.values.get("request-timestamps");
    assert.deepEqual(stored.timestamps, [3_005_000]);
    assert.equal(storage.alarmAt, 3_015_000);
  } finally {
    Date.now = originalNow;
  }
});

test("concurrent cleanup and a new request keep the new alarm scheduled", async () => {
  const { limiter, storage } = createLimiter();
  const originalNow = Date.now;
  let now = 4_000_000;
  Date.now = () => now;

  try {
    await limiter.fetch(request({ limit: 2, windowMs: 10_000 }));
    now += 10_001;

    await Promise.all([
      limiter.alarm(),
      limiter.fetch(request({ limit: 2, windowMs: 10_000 }))
    ]);

    const stored = storage.values.get("request-timestamps");
    assert.deepEqual(stored.timestamps, [now]);
    assert.equal(storage.alarmAt, now + 10_000);
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

test("fails closed when Durable Object storage fails", async () => {
  const storage = {
    transaction: async () => { throw new Error("storage unavailable"); }
  };
  const limiter = new RateLimiter({ storage });
  const response = await limiter.fetch(request({ limit: 1, windowMs: 60_000 }));
  assert.equal(response.status, 503);
});

test("does not expose the Worker as a public HTTP API", async () => {
  const { default: worker } = await import("../src/index.mjs");
  const response = await worker.fetch(new Request("https://example.workers.dev/"));
  assert.equal(response.status, 404);
});
