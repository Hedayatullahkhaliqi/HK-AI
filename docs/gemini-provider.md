# Optional Gemini provider

HK.AI can use Google Gemini for text-only requests while keeping the existing Cloudflare AI provider as the default.

## Cloudflare Pages configuration

Add these as server-side environment variables/secrets in the Pages project:

- `HK_AI_PROVIDER`: set to `gemini` to select Gemini. If unset or set to any other value, HK.AI keeps using the existing Cloudflare AI text provider.
- `GEMINI_API_KEY`: required secret when Gemini is selected.
- `GEMINI_MODEL`: optional model override. Defaults to `gemini-2.5-flash`.

Never put the API key in source code, frontend JavaScript, a committed `.env` file, or a URL. Store it as a Cloudflare secret.

## Current scope

- Text requests use Gemini when `HK_AI_PROVIDER=gemini`.
- Image requests continue using the existing Cloudflare vision model.
- The existing system prompt, language preference, document context, web context, reply cleanup, and consistency checks remain in the shared HK.AI request handler.
- The default provider is unchanged unless the environment variable is deliberately set.

## Test

Run:

```sh
npm run test:gemini
```

This test suite mocks the Gemini HTTP endpoint. It does not require a real API key and does not verify live model quality or account quota.
