import test from "node:test";
import assert from "node:assert/strict";
import { generateWithGemini } from "./gemini.js";

test("requires a Gemini API key", async () => {
  await assert.rejects(
    generateWithGemini({
      systemPrompt: "You are HK.AI.",
      messages: [{ role: "user", content: "سلام" }],
      env: {}
    }),
    /GEMINI_API_KEY/
  );
});

test("sends system instruction, maps assistant history, and reads Gemini text", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;

  globalThis.fetch = async (url, options) => {
    capturedUrl = String(url);
    capturedOptions = options;
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: "سلام! " }, { text: "چطور کمک کنم؟" }]
        }
      }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const reply = await generateWithGemini({
      systemPrompt: "HK.AI system instructions",
      messages: [
        { role: "user", content: "سلام" },
        { role: "assistant", content: "سلام، خوش آمدی." },
        { role: "user", content: "حالت چطور است؟" }
      ],
      env: { GEMINI_API_KEY: "test-secret" }
    });

    assert.equal(reply, "سلام! چطور کمک کنم؟");
    assert.match(capturedUrl, /gemini-2\.5-flash:generateContent$/);
    assert.equal(capturedOptions.headers["x-goog-api-key"], "test-secret");

    const payload = JSON.parse(capturedOptions.body);
    assert.equal(payload.systemInstruction.parts[0].text, "HK.AI system instructions");
    assert.deepEqual(payload.contents.map(item => item.role), ["user", "model", "user"]);
    assert.equal(payload.generationConfig.temperature, 0.3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not expose provider response details in thrown errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: "private provider detail" } }),
    { status: 429 }
  );

  try {
    await assert.rejects(
      generateWithGemini({
        systemPrompt: "System",
        messages: [{ role: "user", content: "Test" }],
        env: { GEMINI_API_KEY: "test-secret" }
      }),
      error => {
        assert.match(error.message, /HTTP 429/);
        assert.doesNotMatch(error.message, /private provider detail|test-secret/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
