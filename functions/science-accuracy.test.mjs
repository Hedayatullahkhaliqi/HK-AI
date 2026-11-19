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

async function captureSystemPrompt(question) {
  let systemPrompt = "";
  const response = await onRequestPost({
    request: makeRequest(question),
    env: {
      AI: {
        async run(_model, options) {
          systemPrompt = options.messages[0].content;
          return { response: "پاسخ آزمایشی." };
        }
      }
    }
  });

  assert.equal(response.status, 200);
  assert.ok(systemPrompt.length > 0);
  return systemPrompt;
}

test("science answers must check false premises before agreeing", async () => {
  const prompt = await captureSystemPrompt("آیا خورشید به دور زمین می‌چرخد؟");

  assert.match(prompt, /FACT-CHECKING AND FALSE PREMISES/);
  assert.match(prompt, /Evaluate the factual claim in the user's question before agreeing/);
  assert.match(prompt, /Never begin with "yes", "correct"/);
  assert.match(prompt, /Keep the direct answer consistent/);
});

test("science answers must use correct units and disclose uncertainty", async () => {
  const prompt = await captureSystemPrompt("فشار جو مریخ چند است؟");

  assert.match(prompt, /Check units, quantities, and comparisons/);
  assert.match(prompt, /If the evidence is insufficient, say what is uncertain/);
  assert.match(prompt, /If unsure about a precise measurement, use an approximate value with its correct unit/);
});

test("science answers must distinguish facts from guesses and avoid invented specifics", async () => {
  const prompt = await captureSystemPrompt("این ستاره‌ای که در آسمان دیدم کدام است؟");

  assert.match(prompt, /FACTUAL ACCURACY AND UNCERTAINTY/);
  assert.match(prompt, /Never turn a vague description into a confident identification/);
  assert.match(prompt, /Keep separate what the user explicitly said, what is generally known, and what is only a possibility/);
  assert.match(prompt, /A short honest answer is better than a confident false one/);
});

test("geographic and historical details require verification when precise", async () => {
  const prompt = await captureSystemPrompt("ارتفاع دقیق این کوه چقدر است؟");

  assert.match(prompt, /For precise geographic claims, verify the named place and its location/);
  assert.match(prompt, /If reliable verification is unavailable, omit the precise claim/);
});

test("mathematical answers must respect decimal values and parentheses", async () => {
  const prompt = await captureSystemPrompt("حاصل محاسبهٔ 12.5 × (4 + 2) چیست؟");

  assert.match(prompt, /MATHEMATICS:/);
  assert.match(prompt, /Check calculations carefully/);
  assert.match(prompt, /Respect decimal numbers and parentheses/);
});

test("the prompt must not invent current scientific facts or sources", async () => {
  const prompt = await captureSystemPrompt("آخرین کشف علمی امروز چیست؟");

  assert.match(prompt, /Never invent facts or sources/);
  assert.match(prompt, /If the user's question depends on current or highly specific facts/);
  assert.match(prompt, /WEB INFORMATION:/);
});
