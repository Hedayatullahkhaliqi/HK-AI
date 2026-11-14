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
      const decision = await this.ctx.storage.transaction(async transaction => {
        const stored = await transaction.get(STORAGE_KEY);
        const previous = stored && Array.isArray(stored.timestamps)
          ? stored.timestamps
          : [];
        const timestamps = previous
          .filter(timestamp => Number.isSafeInteger(timestamp) && timestamp > now - windowMs)
          .sort((a, b) => a - b);

        let allowed = true;
        let retryAfter = 0;
        if (timestamps.length >= limit) {
          allowed = false;
          retryAfter = Math.max(
            1,
            Math.ceil((timestamps[0] + windowMs - now) / 1000)
          );
        } else {
          timestamps.push(now);
        }

        if (timestamps.length) {
          await transaction.put(STORAGE_KEY, { windowMs, timestamps });
          await transaction.setAlarm(timestamps[0] + windowMs);
        } else {
          await transaction.delete(STORAGE_KEY);
          await transaction.deleteAlarm();
        }

        return {
          allowed,
          remaining: Math.max(0, limit - timestamps.length),
          retryAfter,
          resetAt: timestamps.length ? timestamps[0] + windowMs : now
        };
      });

      return json(decision);
    } catch (error) {
      console.error("HK rate limiter storage transaction failed");
      return json({ error: "Rate limiter storage unavailable" }, 503);
    }
  }

  async alarm() {
    const now = Date.now();

    try {
      await this.ctx.storage.transaction(async transaction => {
        const stored = await transaction.get(STORAGE_KEY);
        if (!stored || !Array.isArray(stored.timestamps) ||
            !Number.isSafeInteger(stored.windowMs) ||
            stored.windowMs < MIN_WINDOW_MS ||
            stored.windowMs > MAX_WINDOW_MS) {
          await transaction.delete(STORAGE_KEY);
          await transaction.deleteAlarm();
          return;
        }

        const timestamps = stored.timestamps
          .filter(timestamp => Number.isSafeInteger(timestamp) && timestamp > now - stored.windowMs)
          .sort((a, b) => a - b);

        if (!timestamps.length) {
          await transaction.delete(STORAGE_KEY);
          await transaction.deleteAlarm();
          return;
        }

        await transaction.put(STORAGE_KEY, {
          windowMs: stored.windowMs,
          timestamps
        });
        await transaction.setAlarm(timestamps[0] + stored.windowMs);
      });
    } catch (error) {
      console.error("HK rate limiter cleanup alarm failed");
      // Let Cloudflare retry the alarm. The next API request also repairs the
      // schedule, so a transient cleanup failure does not disable rate checks.
      throw error;
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
