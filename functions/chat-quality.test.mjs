import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./api/chat.js";

function makeRequest(message) {
  return new Request("https://hk-ai.pages.dev/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
      language: "Dari"
    })
  });
}

function makeEnv(aiResponse) {
  const calls = [];
  return {
    calls,
    env: {
      AI: {
        async run(model, options) {
          calls.push({ model, options });
          return aiResponse;
        }
      }
    }
  };
}

test("system prompt explicitly rejects false premises and contradictions", async () => {
  const { env, calls } = makeEnv({
    response: "خیر. زمین به دور خورشید می‌چرخد."
  });

  const response = await onRequestPost({
    request: makeRequest("آیا خورشید به دور زمین می‌چرخد؟"),
    env
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const systemPrompt = calls[0].options.messages[0].content;
  assert.match(systemPrompt, /Never begin with "yes", "correct"/);
  assert.match(systemPrompt, /Keep the direct answer consistent/);
  assert.match(systemPrompt, /Check units, quantities/);
});

test("removes consecutive duplicate lines and exact duplicate paragraphs", async () => {
  const repeatedParagraph = "فشار جو مریخ بسیار پایین است.";
  const { env } = makeEnv({
    response: [
      "خیر، انسان بدون لباس فضایی در مریخ زنده نمی‌ماند.",
      "",
      repeatedParagraph,
      "",
      repeatedParagraph,
      "",
      "دمای مریخ نیز بسیار پایین است.",
      "دمای مریخ نیز بسیار پایین است."
    ].join("\n")
  });

  const response = await onRequestPost({
    request: makeRequest("آیا انسان بدون لباس فضایی در مریخ زنده می‌ماند؟"),
    env
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(
    body.reply,
    [
      "خیر، انسان بدون لباس فضایی در مریخ زنده نمی‌ماند.",
      "",
      repeatedParagraph,
      "",
      "دمای مریخ نیز بسیار پایین است."
    ].join("\n")
  );
});

test("returns a gateway error instead of an empty malformed model response", async () => {
  const { env } = makeEnv({ unexpected: true });

  const response = await onRequestPost({
    request: makeRequest("یک پرسش آزمایشی"),
    env
  });

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "No valid AI response received");
});
