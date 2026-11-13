const ALLOWED_RATINGS = new Set(["positive", "negative"]);
const ALLOWED_CATEGORIES = new Set(["overall", "accuracy", "language", "incomplete", "other"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.HK_RATE_LIMITS) {
    return json({ error: "Feedback storage is unavailable." }, 503);
  }

  try {
    const body = await request.json();
    const rating = body?.rating;
    const category = body?.category;

    if (!ALLOWED_RATINGS.has(rating) || !ALLOWED_CATEGORIES.has(category)) {
      return json({ error: "Invalid feedback." }, 400);
    }

    // Store aggregate counters only. Never store prompts, replies, IPs,
    // account identifiers, or other conversation content.
    const day = new Date().toISOString().slice(0, 10);
    const key = `improve:v1:${day}:${category}:${rating}`;
    const stored = await env.HK_RATE_LIMITS.get(key);
    const current = stored === null ? 0 : Number(stored);

    if (!Number.isSafeInteger(current) || current < 0 || current >= 1000000) {
      return json({ error: "Feedback counter is unavailable." }, 503);
    }

    await env.HK_RATE_LIMITS.put(key, String(current + 1), {
      expirationTtl: 60 * 60 * 24 * 90
    });

    return json({ success: true });
  } catch {
    return json({ error: "Could not save feedback." }, 503);
  }
}
