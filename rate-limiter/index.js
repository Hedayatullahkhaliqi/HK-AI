const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// One Durable Object instance is selected per client IP + API route.
// Its transactional storage makes each counter increment atomic.
export class RateLimiter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/check") {
      return json({ error: "Not found." }, 404);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid limiter request." }, 400);
    }

    const limit = input?.limit;
    const windowMs = input?.windowMs;
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 3600000) {
      return json({ error: "Invalid limiter settings." }, 400);
    }

    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;

    try {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const previous = await txn.get("counter");
        const count = previous?.windowStart === windowStart &&
          Number.isSafeInteger(previous?.count) && previous.count >= 0
          ? previous.count
          : 0;

        if (count >= limit) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(1, windowStart + windowMs - now)
          };
        }

        const nextCount = count + 1;
        await txn.put("counter", { windowStart, count: nextCount });
        return {
          allowed: true,
          remaining: Math.max(0, limit - nextCount),
          retryAfterMs: 0
        };
      });

      // Keep the small per-client counter from accumulating indefinitely.
      await this.ctx.storage.setAlarm(Date.now() + 120000);
      return json(result);
    } catch {
      // Callers must fail closed if the strict limiter cannot operate.
      return json({ error: "Rate limiter storage unavailable." }, 503);
    }
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch() {
    // The limiter is accessed through a service binding from the Pages app.
    return new Response("Not found", { status: 404 });
  }
};
