const MAX_LIMIT = 60;
const MIN_WINDOW_MS = 1_000;
const MAX_WINDOW_MS = 5 * 60_000;
const STORAGE_KEY = "request-timestamps";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export class RateLimiter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return json({ error: "Content-Type must be application/json" }, 415);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const { limit, windowMs } = input || {};
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < MIN_WINDOW_MS ||
      windowMs > MAX_WINDOW_MS
    ) {
      return json({ error: "Invalid rate limit configuration" }, 400);
    }

    const now = Date.now();

    try {
      // Durable Object storage transactions serialize competing updates. Unlike
      // KV read/modify/write counters, concurrent requests cannot lose increments.
      const decision = await this.ctx.storage.transaction(async transaction => {
        const stored = await transaction.get(STORAGE_KEY);
        const timestamps = Array.isArray(stored)
          ? stored.filter(timestamp =>
              Number.isSafeInteger(timestamp) && timestamp > now - windowMs
            )
          : [];

        if (timestamps.length >= limit) {
          const retryAfter = Math.max(
            1,
            Math.ceil((timestamps[0] + windowMs - now) / 1000)
          );
          return {
            allowed: false,
            remaining: 0,
            retryAfter,
            resetAt: timestamps[0] + windowMs
          };
        }

        timestamps.push(now);
        await transaction.put(STORAGE_KEY, timestamps, {
          expirationTtl: Math.ceil(windowMs / 1000) * 2
        });

        return {
          allowed: true,
          remaining: Math.max(0, limit - timestamps.length),
          retryAfter: 0,
          resetAt: timestamps[0] + windowMs
        };
      });

      return json(decision);
    } catch (error) {
      console.error("HK rate limiter storage transaction failed");
      return json({ error: "Rate limiter storage unavailable" }, 503);
    }
  }
}

// The namespace is consumed through a Pages Durable Object binding. Do not
// expose a public HTTP API for rate-limit decisions on the Worker hostname.
export default {
  fetch() {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }
};
