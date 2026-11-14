# HK.AI API security setup

## API middleware

The Pages Functions middleware protects every `/api/*` route. It enforces the configured browser-origin policy when an Origin header is present, handles OPTIONS preflight requests, requires POST with JSON, enforces per-route body limits against both Content-Length and the actual streamed bytes, adds security response headers, and requires a rate-limit decision before calling an API handler.

**Origin/CORS checks are not authentication.** Requests without an Origin header can still reach the API. The rate limiter is an abuse-control layer, not proof that a caller is an authorized user. A future authenticated session or challenge may still be needed.

## Durable Object rate limiter

The API uses the `HK_RATE_LIMITER` Durable Object binding instead of a KV read/modify/write counter.

- Chat, transcription, and speech routes: 30 requests per rolling 60-second window per IP and route.
- Image generation/editing: 5 requests per rolling 60-second window per IP and route.
- Each IP/route pair maps to a deterministic Durable Object ID derived from a SHA-256 digest. Raw IP addresses are not written into Durable Object storage.
- Request timestamps are updated inside a Durable Object storage transaction. Concurrent requests are serialized, avoiding the lost-update race in KV counters.
- Durable Object Alarms remove expired timestamps even when no later request arrives. The alarm is rescheduled for the next timestamp expiry and is safe to run more than once.
- If the binding or storage is unavailable, the middleware fails closed with HTTP 503. It never silently skips rate limiting.
- Requests over the limit receive HTTP 429 and a `Retry-After` header.
- The Durable Object Worker does not expose a public HTTP decision API; Pages calls it through its binding.

## Deployment order — do not skip

Cloudflare Pages deploys automatically when changes are merged into the production branch. The external Durable Object Worker must exist before the Pages deployment that uses its binding. Otherwise API calls will fail closed with HTTP 503.

### First deployment (before merging this PR)

1. Configure a Cloudflare API token and account ID on a trusted machine. The token needs permission to deploy Workers and manage Durable Objects in the target account.
2. From the repository root, deploy the Worker from this feature branch **before merging the PR**:

   ```sh
   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler@4 deploy --config rate-limiter/wrangler.jsonc
   ```

   On PowerShell, set the two environment variables with `$env:CLOUDFLARE_API_TOKEN` and `$env:CLOUDFLARE_ACCOUNT_ID` before running the command.
3. Confirm the Worker name is exactly `hk-ai-rate-limiter` and that its first deployment applies migration `v1` for the SQLite-backed `RateLimiter` class.
4. Only after the Worker exists, merge this PR. The Pages production deployment can then bind `HK_RATE_LIMITER` to the already-deployed `RateLimiter` class.
5. Wait for the Pages deployment to finish, then run the live checks below.

### Later Worker deployments

The **Deploy HK.AI rate limiter** GitHub Actions workflow is manual and restricted to `main). It becomes available after this workflow file reaches the default branch. It uses the `cloudflare-production` GitHub environment and requires the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Do not merge this PR until the first Worker deployment has been completed. Do not run the production deployment workflow from a feature branch.

## Verification checklist

- Normal API routes: 30 requests per rolling 60-second window per IP and route; the next request should receive HTTP 429.
- Image route: 5 requests per rolling 60-second window per IP; the next request should receive HTTP 429.
- Missing or unavailable Durable Object binding: HTTP 503 (fail closed).
- Invalid Durable Object response: HTTP 503 (fail closed).
- Requests with missing or understated Content-Length: actual streamed bytes are still checked against the route's body limit.
- Chat, image generation/editing, transcription, and speech generation must all be smoke-tested after Pages deployment.
- Test concurrent requests and rolling-window expiry against the deployed Worker, not only the in-memory unit-test mock.

The old `HK_RATE_LIMITS` KV binding is no longer used by the middleware and can be detached from the Pages project after the Durable Object rollout is confirmed. Do not delete the KV namespace until its other uses, if any, have been checked.

## Secrets and remaining security work

- Keep Gemini, Firecrawl, and provider keys in Cloudflare secrets, never in client code or the repository.
- CORS/origin checks and rate limiting do not authenticate callers. Protecting API usage with authenticated sessions or an abuse challenge remains separate work.
- The automated tests validate the Durable Object logic and Pages middleware with mocks. They do not replace live Cloudflare integration tests.
- Do not treat a successful curl process exit or an HTTP 400 validation response as proof that rate limiting works.
