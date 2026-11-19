const DEFAULT_MODEL = "gemini-2.5-flash";
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export async function generateWithGemini({ systemPrompt, messages, env }) {
  const apiKey = env.GEMINI_API_KEY;

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Gemini is selected but GEMINI_API_KEY is not configured.");
  }

  const model = typeof env.GEMINI_MODEL === "string" && env.GEMINI_MODEL.trim()
    ? env.GEMINI_MODEL.trim()
    : DEFAULT_MODEL;

  const contents = messages
    .filter(message =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim()
    )
    .map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));

  if (!contents.length || contents[contents.length - 1].role !== "user") {
    throw new Error("Gemini requires a conversation ending with a user message.");
  }

  const response = await fetch(
    `${API_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048
        }
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Do not return provider errors to end users: they may contain
    // account, quota, model, or configuration details.
    const status = response.status;
    throw new Error(`Gemini request failed (HTTP ${status}).`);
  }

  const candidate = data?.candidates?.[0];
  const reply = candidate?.content?.parts
    ?.filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("")
    .trim();

  if (!reply) {
    throw new Error("Gemini returned no text candidate.");
  }

  return reply;
}
