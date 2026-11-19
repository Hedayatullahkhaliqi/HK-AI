const ALLOWED_ORIGINS = new Set([
  "https://hk-ai.pages.dev",
  "capacitor://localhost"
]);

const BODY_LIMITS = {
  "/api/chat": 11 * 1024 * 1024,
  "/api/image": 11 * 1024 * 1024,
  "/api/transcribe": 16 * 1024 * 1024,
  "/api/tts": 64 * 1024
};

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json";
}

function isAllowedOrigin(origin, requestUrl) {
  // Explicitly trusted production and native-app origins are allowed.
  if (ALLOWED_ORIGINS.has(origin)) return true;

  // Local development is allowed only when the request is same-origin.
  // A localhost page must never be trusted when calling the Production API.
  if (
    origin === requestUrl.origin &&
    (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1")
  ) {
    return requestUrl.protocol === "http:" || requestUrl.protocol === "https:";
  }

  // A Pages preview may call only its own same-origin API.
  return (
    origin === requestUrl.origin &&
    requestUrl.protocol === "https:" &&
    requestUrl.hostname.endsWith(".hk-ai.pages.dev") &&
    requestUrl.hostname !== "hk-ai.pages.dev"
  );
}

function secure(headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), payment=()");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function reply(data, status, cors) {
  const headers = new Headers(cors);
  headers.set("Content-Type", "application/json; charset=utf-8");
  secure(headers);
  return new Response(JSON.stringify(data), { status, headers });
}

async function bodyExceedsLimit(request, maxBytes) {
  if (!request.body) return false;

  const reader = request.clone().body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      total += value.byteLength;
      if (total > maxBytes) {
        // Do not await cancellation: clone() tees the stream, and cancellation
        // can wait for the original request branch that Pages will consume later.
        reader.cancel().catch(() => {});
        return true;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function rateLimitIdentity(ip, pathname) {
  const input = new TextEncoder().encode(`${pathname}\n${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return next();

  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin, url)) {
    return reply({ error: "Origin not allowed" }, 403);
  }

  const cors = new Headers();
  if (origin) {
    cors.set("Access-Control-Allow-Origin", origin);
    cors.set("Vary", "Origin");
  }
  cors.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  cors.set("Access-Control-Allow-Headers", "Content-Type, CF-Turnstile-Response");
  cors.set("Access-Control-Max-Age", "86400");

  if (request.method === "OPTIONS") {
    secure(cors);
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    cors.set("Allow", "POST, OPTIONS");
    return reply({ error: "Method not allowed" }, 405, cors);
  }

  const maxBodySize = BODY_LIMITS[url.pathname];
  if (!maxBodySize) return reply({ error: "Not found" }, 404, cors);

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return reply({ error: "Invalid Content-Length header" }, 400, cors);
    }
    if (Number(contentLength) > maxBodySize) {
      return reply({ error: "Request body too large" }, 413, cors);
    }
  }

  if (!isJsonContentType(request.headers.get("Content-Type"))) {
    return reply({ error: "Content-Type must be application/json" }, 415, cors);
  }

  // Origin checks are not authentication. Rate limiting is therefore enforced
  // for every API request, including requests without an Origin header.
  if (!env.HK_RATE_LIMITER) {
    console.error("HK rate limit: Durable Object binding missing");
    return reply({
      error: "The rate limiter is not configured.",
      code: "RATE_LIMITER_BINDING_MISSING"
    }, 503, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 128) {
    return reply({
      error: "The request could not be security-validated.",
      code: "CLIENT_IP_UNAVAILABLE"
    }, 503, cors);
  }

  const isImage = url.pathname === "/api/image";
  const limit = isImage ? 5 : 30;

  try {
    const identity = await rateLimitIdentity(ip, url.pathname);
    const id = env.HK_RATE_LIMITER.idFromName(identity);
    const limiter = env.HK_RATE_LIMITER.get(id);
    const decisionResponse = await limiter.fetch("https://rate-limiter.internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit, windowMs: 60_000 })
    });

    if (!decisionResponse.ok) {
      console.error("HK rate limit: Durable Object returned an error");
      return reply({
        error: "The rate limiter is temporarily unavailable.",
        code: "RATE_LIMITER_UNAVAILABLE"
      }, 503, cors);
    }

    const decision = await decisionResponse.json();
    if (
      typeof decision.allowed !== "boolean" ||
      !Number.isSafeInteger(decision.remaining) ||
      decision.remaining < 0 ||
      decision.remaining > limit ||
      !Number.isSafeInteger(decision.retryAfter) ||
      decision.retryAfter < 0 ||
      !Number.isSafeInteger(decision.resetAt) ||
      decision.resetAt < 0
    ) {
      console.error("HK rate limit: invalid Durable Object response");
      return reply({
        error: "The rate limiter returned an invalid response.",
        code: "RATE_LIMITER_INVALID_RESPONSE"
      }, 503, cors);
    }

    cors.set("X-RateLimit-Limit", String(limit));
    cors.set("X-RateLimit-Remaining", String(decision.remaining));
    cors.set("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      const retryAfter = Math.max(1, decision.retryAfter);
      cors.set("Retry-After", String(retryAfter));
      return reply({
        error: "Too many requests. Please try again later.",
        code: "RATE_LIMITED",
        retryAfter
      }, 429, cors);
    }
  } catch (error) {
    console.error("HK rate limit: Durable Object check failed");
    return reply({
      error: "The rate limiter is temporarily unavailable.",
      code: "RATE_LIMITER_UNAVAILABLE"
    }, 503, cors);
  }

  // Require a fresh Turnstile token for every API request. Rate limiting runs
  // first so abusive traffic cannot freely consume Siteverify requests.
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  const turnstileToken = request.headers.get("CF-Turnstile-Response");
  if (!turnstileSecret) {
    console.error("HK Turnstile: secret binding missing");
    return reply({
      error: "Security verification is not configured.",
      code: "TURNSTILE_NOT_CONFIGURED"
    }, 503, cors);
  }
  if (!turnstileToken || turnstileToken.length > 2048) {
    return reply({
      error: "Please complete the security check and try again.",
      code: "TURNSTILE_TOKEN_REQUIRED"
    }, 403, cors);
  }

  let expectedHostname = url.hostname;
  if (origin) {
    try {
      expectedHostname = new URL(origin).hostname;
    } catch {
      return reply({ error: "Origin not allowed" }, 403, cors);
    }
    if (origin === "capacitor://localhost") expectedHostname = "localhost";
  }

  try {
    const verificationResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: turnstileToken,
          remoteip: ip
        }),
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!verificationResponse.ok) {
      throw new Error("Turnstile Siteverify returned a non-success status");
    }

    const verification = await verificationResponse.json();
    if (
      verification?.success !== true ||
      verification.action !== "api" ||
      verification.hostname !== expectedHostname
    ) {
      return reply({
        error: "Security verification failed. Please try again.",
        code: "TURNSTILE_VERIFICATION_FAILED"
      }, 403, cors);
    }
  } catch (error) {
    console.error("HK Turnstile: verification service unavailable");
    return reply({
      error: "Security verification is temporarily unavailable. Please try again.",
      code: "TURNSTILE_UNAVAILABLE"
    }, 503, cors);
  }

  // Enforce the limit on the actual streamed bytes as well as Content-Length.
  // This covers chunked requests and callers that omit or understate the header.
  try {
    if (await bodyExceedsLimit(request, maxBodySize)) {
      return reply({ error: "Request body too large" }, 413, cors);
    }
  } catch (error) {
    console.error("HK API middleware: request body could not be validated");
    return reply({ error: "Request body could not be validated." }, 400, cors);
  }

  const response = await next();
  const headers = new Headers(response.headers);
  for (const [key, value] of cors) headers.set(key, value);
  secure(headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
