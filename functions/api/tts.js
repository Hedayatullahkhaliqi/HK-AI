const MODEL = "gemini-3.8-flash-tts";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.GEMINI_API_KEY) {
      return json({ error: "Gemini API key is not configured in Cloudflare secrets." }, 503);
    }

    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) return json({ error: "No text was provided for speech." }, 400);
    if (text.length > 1800) {
      return json({ error: "The text is too long for speech generation." }, 413);
    }

    const prompt =
      "Read the following text aloud in natural, clear English. " +
      "Use natural English pronunciation. " +
      "Speak warmly, clearly, and conversationally at a natural pace. " +
      "Do not translate, summarize, or add any words. Read only the supplied text:\n\n" +
      text;

    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        input: [{
          type: "user_input",
          content: [{
            type: "text",
            text: prompt,
            annotations: [{
              type: "speech_metadata",
              style: "Natural, warm, conversational English pronunciation. Speak clearly at a moderate pace."
            }]
          }]
        }],
        response_format: { type: "audio" },
        generation_config: {
          speech_config: [{ voice: "Kore" }]
        }
      })
    });

    const result = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message = "The speech service rejected the request (HTTP " + upstream.status + ").";
      return json({ error: message }, upstream.status >= 500 ? 502 : upstream.status);
    }

    const audioBase64 =
      result.interaction?.output_audio?.data ||
      result.output_audio?.data ||
      result.interaction?.outputAudio?.data ||
      result.outputAudio?.data;

    if (typeof audioBase64 !== "string" || !audioBase64) {
      return json({ error: "Gemini did not return an audio file. Please try again." }, 502);
    }

    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return json({
      error: "Speech generation is temporarily unavailable. Please try again later."
    }, 500);
  }
}
