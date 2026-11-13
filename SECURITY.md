# HK.AI API security setup

The Pages Functions middleware protects all `/api/*` routes before their handlers run. It enforces allowed browser origins when an Origin header is present, handles OPTIONS preflight requests, requires POST with JSON, applies per-route request-size limits, adds security response headers, and applies per-IP request limiting with Cloudflare KV.

## Required Cloudflare KV binding

The current middleware uses **fail-closed** behavior: API requests return HTTP 503 when the KV binding is missing, unavailable, or cannot be read/written. The API does not silently bypass rate limiting.

1. In Cloudflare Dashboard, open **Workers & Pages → KV** and create a namespace named `HK-AI-RATE-LIMITS`.
2. Open **Workers & Pages → HK-AI → Settings → Bindings`.
3. Choose **Add → KV namespace**.
4. Set the variable name to exactly `HK_RATE_LIMITS` and select the namespace `HK-AI-RATE-LIMITS`.
5. Save, then redeploy the Pages project so the binding becomes available to Functions.

Current approximate per-IP limits:
- Chat, transcription and speech endpoints: 30 requests per minute per route.
- Image generation/editing: 5 requests per minute.

This is a best-effort KV counter, not a strict atomic limiter. Concurrent requests may occasionally exceed the threshold because KV reads and writes are not atomic.

## Origin checks are not authentication

CORS/origin checks are browser protections, not authentication. Requests without an Origin header can still reach the API. Rate limiting reduces abuse but does not prove a caller is an authorized app user. A stronger abuse-control design may require an additional challenge or authenticated session.

## Secrets and post-deployment checks

- Keep Gemini, Firecrawl, and all provider keys in Cloudflare secrets, never in client code or the repository.
- Test chat, image generation/editing, transcription, and speech generation after deployment.
- Keep request limits and the middleware's KV binding name synchronized with the Cloudflare Pages settings.
