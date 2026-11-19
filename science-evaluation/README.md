# HK.AI science answer evaluation

This is a small Dari-language screening set for recurring science-answer failure modes. It covers astronomy, physics, biology, Earth science, and arithmetic.

## Run against a staging or local HK.AI endpoint

```sh
HK_AI_EVAL_URL="https://YOUR-STAGING-HOST/api/chat" npm run eval:science
```

Optional timeout: `HK_AI_EVAL_TIMEOUT_MS=60000`.

The runner sends each question to the configured endpoint and checks for required concepts and forbidden misconceptions. It prints the answer text, per-case score, and reference links. A failing case is a prompt for human review, not proof that every part of the answer is wrong.

## Important limitations

- The current set is intentionally small and Dari-only.
- Regex checks can miss correct paraphrases and can reward a phrase without verifying the whole explanation.
- Source links are reference starting points; the runner does not crawl or independently verify them.
- A passing run is not a scientific certification. Review answers against the linked sources and expand the set with expert-reviewed cases.
- Do not point the runner at production unless you intentionally accept the requests and any model usage charges. Prefer a staging deployment with test credentials.
