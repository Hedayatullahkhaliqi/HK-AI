# HK.AI API security setup

## API middleware

The Pages Functions middleware protects every `/api/*` route. It enforces the configured browser-origin policy when an Origin header is present, handles OPTIONS preflight requests, requires POST with JSON, applies per-route Content-Length limits, adds security response headers, and requires a rate-limit decision before calling an API handler.

**Origin/CORS checks are not authentication.** Requests without an Origin header can still reach the API. The rate limiter is an abuse-control layer, not proof that a caller is an authorized user. A future authenticated session or challenge may still be needed.

## Durable Object rate limiter

The API now uses the `HK_RATE_LIMITER` Durable Object binding instead of a KV read/modify/write counter.

- Chat, transcription, and speech routes: 30 requests per rolling 60-second window per IP and route.
- Image generation/editing: 5 requests per rolling 60-second window per IP and route.
- Each IP/route pair maps to a deterministic Durable Object ID derived from a SHA-256 digest. Raw IP addresses are not written into Durable Object storage.
- Request timestamps are updated inside a Durable Object storage transaction. Concurrent requests are serialized, avoiding the lost-update race in KV counters.
- If the binding or storage is unavailable, the middleware fails closed with HTTP 503. It never silently skips rate limiting.
- Requests over the limit receive HTTP 429 and a `Retry-After` header.
- The Durable Object Worker does not expose a public HTTP decision API; Pages calls it through its binding.

### Deploy order and required setup

1. Configure GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Ensure the API token has permission to edit Workers and Durable Objects for the target account.
3. Deploy the Durable Object Worker from `rate-limiter/` using the **Deploy HK.AI rate limiter** workflow. Its first deployment creates the SQLite-backed `RateLimiter` namespace using migration `v1`.
4. Confirm the Worker name is exactly `hk-ai-rate-limiter`.
5. Deploy the Pages project after the Worker exists. The Pages Wrangler configuration binds `HK_RATE_LIMITER` to the external `RateLimiter` class for production and preview.
6. Test the API routes and verify that requests over the configured thresholds receive HTTP 429. Verify that a missing binding returns HTTP 503.

The old `HK_RATE_LIMITS` KV binding is no longer used by the middleware and can be detached from the Pages project after the Durable Object rollout is confirmed. Do not delete the KV namespace until its other uses, if any, have been checked.

## Secrets and post-deployment checks

- Keep Gemini, Firecrawl, and provider keys in Cloudflare secrets, never in client code or the repository.
- Test chat, image generation/editing, transcription, and speech generation after deployment.
- Test concurrent requests, rolling-window expiry, missing bindings, and storage failures.
- Do not treat a successful curl process exit or an HTTP 400 validation response as proof that rate limiting works.
