# HK.AI API security setup

The Pages Functions middleware applies:
- API origin allowlisting for the website and Capacitor app origins.
- OPTIONS preflight handling.
- POST-only and JSON content-type checks.
- Declared request-size limits for each API route.
- Security response headers.
- Generic server errors so internal exception details are not returned to clients.

## Configure Cloudflare WAF rate limiting

Rate limiting is an edge-level Cloudflare security rule, not a Pages Functions binding. Configure it in the Cloudflare dashboard:

1. Open **Cloudflare Dashboard → select the zone/domain serving hk-ai.pages.dev → Security → Security rules**.
2. Choose **Create rule → Rate limiting rules**.
3. Create an API rule matching these paths:
   `/api/chat`, `/api/image`, `/api/transcribe`, and `/api/tts`.
   If using the expression editor, use:
   `http.request.uri.path in {"/api/chat" "/api/image" "/api/transcribe" "/api/tts"}`
4. Count requests by **IP**.
5. On the Free plan, choose a supported period of **10 seconds**. Start with **10 requests per 10 seconds**, action **Block**, duration **10 seconds**.
6. Create a separate stricter image rule for `/api/image`, for example **2 requests per 10 seconds**, action **Block**, duration **10 seconds**.
7. Deploy the rules. Test normal chat and image use to ensure legitimate users are not blocked.

Cloudflare's available expression fields, periods, and actions depend on the plan. On Free, rate limiting has more limited options than on paid plans; if the dashboard does not offer a setting above, use the available controls rather than assuming the example is supported.

## Important notes

- CORS/origin checks are browser protections, not authentication. Requests without an Origin header can still reach the API.
- Keep Gemini, Firecrawl, and all provider keys in Cloudflare secrets, never in client code or the repository.
- Test chat, image generation/editing, transcription, and speech generation after deployment.
