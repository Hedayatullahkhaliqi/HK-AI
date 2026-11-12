# HK.AI API security setup

The Pages Functions middleware adds API origin checks, OPTIONS preflight handling, POST/JSON enforcement, declared request-size limits, and security response headers.

## Configure rate limiting in Cloudflare

Rate limiting is **not active until these bindings are configured**:

1. Open Cloudflare Dashboard → Workers & Pages → HK-AI → Settings → Functions → Bindings (labels may vary).
2. Add a Rate Limiting binding named `HK_API_LIMITER`, with an unused numeric namespace ID (example `81001`), limit 30 requests, period 60 seconds.
3. Add another Rate Limiting binding named `HK_IMAGE_LIMITER`, with a different unused numeric namespace ID (example `81002`), limit 5 requests, period 60 seconds.
4. Save and redeploy the Pages project.

These limits are per client IP. The middleware deliberately fails open if a binding is missing, to avoid unexpectedly taking the app offline. Verify the bindings and deployment before treating rate limiting as enabled.

## Notes

- CORS/origin checks are browser protections, not authentication. Requests without an Origin header can still reach the API.
- Keep Gemini, Firecrawl, and all provider keys in Cloudflare secrets, never in client code or the repository.
- Test chat, image generation/editing, transcription, and speech generation after deployment.
