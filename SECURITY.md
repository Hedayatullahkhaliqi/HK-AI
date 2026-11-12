# HK.AI API security setup

The Pages Functions middleware applies API origin checks, OPTIONS preflight handling, POST/JSON enforcement, declared request-size limits, security response headers, generic server errors, and optional per-IP request limiting backed by Cloudflare KV.

## Enable API rate limiting (required)

The code supports a Cloudflare KV namespace binding named `HK_RATE_LIMITS`. Without this binding, the application stays online but the KV rate limiter is inactive.

1. In Cloudflare Dashboard, open **Workers & Pages → KV** and create a namespace named `HK-AI-RATE-LIMITS`.
2. Open **Workers & Pages → HK-AI → Settings → Bindings**.
3. Choose **Add → KV namespace**.
4. Set the variable name to exactly `HK_RATE_LIMITS` and select the namespace `HK-AI-RATE-LIMITS`.
5. Save, then redeploy the Pages project so the binding becomes available to Functions.

Current approximate per-IP limits:
- Chat, transcription and speech endpoints: 30 requests per minute per route.
- Image generation/editing: 5 requests per minute.

This is a best-effort KV counter, not a strict atomic limiter. Concurrent requests may occasionally exceed the threshold because KV reads and writes are not atomic. A stronger global limiter would require a dedicated rate-limiting service or Durable Object Worker.

## Important notes

- CORS/origin checks are browser protections, not authentication. Requests without an Origin header can still reach the API.
- Keep Gemini, Firecrawl, and all provider keys in Cloudflare secrets, never in client code or the repository.
- Test chat, image generation/editing, transcription, and speech generation after deployment.
