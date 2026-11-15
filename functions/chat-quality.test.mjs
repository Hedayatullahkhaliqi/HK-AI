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
  assert.match(systemPrompt, /MARS SURFACE SURVIVAL FACTS/);
  assert.match(systemPrompt, /600 pascals \(0\.6 kilopascals\)/);
  assert.match(systemPrompt, /Mars has a very thin atmosphere, not no atmosphere/);
  assert.match(systemPrompt, /solar energy received per unit area is lower than at Earth/);
  assert.match(systemPrompt, /do not say sunlight is stronger there/);
  assert.match(systemPrompt, /Do not claim that oxygen simply "leaves the blood"/);
  assert.match(systemPrompt, /Avoid repeating the same hazard under different names/);
  assert.doesNotMatch(systemPrompt, /^ss they have/m);
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

test("rejects leaked internal reasoning markers instead of exposing them", async () => {
  const { env } = makeEnv({
    response: "initial thought: this answer is inconsistent. Let's refine.\n</think>خیر، انسان بدون لباس فضایی در مریخ زنده نمی‌ماند."
  });

  const response = await onRequestPost({
    request: makeRequest("آیا انسان بدون لباس فضایی در مریخ زنده می‌ماند؟"),
    env
  });

  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /initial thought|think|Let's refine/i);
});

test("rejects directly conflicting yes/no Mars survival claims", async () => {
  const { env } = makeEnv({
    response: "بله، انسان‌ها می‌توانند بدون لباس فضایی در مریخ زنده بمانند.\n\nخیر، انسان‌ها نمی‌توانند بدون لباس فضایی در مریخ زنده بمانند."
  });

  const response = await onRequestPost({
    request: makeRequest("آیا انسان بدون لباس فضایی در مریخ زنده می‌ماند؟"),
    env
  });

  assert.equal(response.status, 502);
});

test("rejects conflicting English Mars survival claims in either word order", async () => {
  const { env } = makeEnv({
    response: [
      "Humans can survive on Mars without a spacesuit.",
      "Without a spacesuit, humans cannot survive on Mars."
    ].join(String.fromCharCode(10, 10))
  });

  const response = await onRequestPost({
    request: makeRequest("Can humans survive on Mars without a spacesuit?"),
    env
  });

  assert.equal(response.status, 502);
});

test("rejects conflicting Dari Mars survival claims", async () => {
  const { env } = makeEnv({
    response: [
      "انسان‌ها می‌توانند بدون لباس فضایی در مریخ زنده بمانند.",
      "انسان‌ها بدون لباس فضایی نمی‌توانند در مریخ زنده بمانند."
    ].join(String.fromCharCode(10, 10))
  });

  const response = await onRequestPost({
    request: makeRequest("آیا انسان بدون لباس فضایی در مریخ زنده می‌ماند؟"),
    env
  });

  assert.equal(response.status, 502);
});

test("does not reject a consistent English or Dari negative answer", async () => {
  for (const message of [
    "Humans cannot survive on Mars without a spacesuit.",
    "انسان‌ها بدون لباس فضایی در مریخ نمی‌توانند زنده بمانند."
  ]) {
    const { env } = makeEnv({ response: message });
    const response = await onRequestPost({
      request: makeRequest("آیا انسان بدون لباس فضایی در مریخ زنده می‌ماند؟"),
      env
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, message);
  }
});

test("keeps the language instructions and fact-checking section separated", async () => {
  const { env, calls } = makeEnv({ response: "پاسخ آزمایشی." });

  const response = await onRequestPost({
    request: makeRequest("یک پرسش آزمایشی"),
    env
  });

  assert.equal(response.status, 200);
  const systemPrompt = calls[0].options.messages[0].content;
  assert.match(systemPrompt, /switch with them unless they have explicitly requested/);
  assert.doesNotMatch(systemPrompt, /unleFACT-CHECKING/);
  assert.match(systemPrompt, /FACT-CHECKING AND FALSE PREMISES/);
});
