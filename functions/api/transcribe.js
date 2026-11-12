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
      return json({ error: "کلید Gemini در تنظیمات امن Cloudflare تنظیم نشده است." }, 503);
    }

    const body = await request.json();
    const audio = typeof body.audio === "string" ? body.audio : "";
    const rawMime = typeof body.mimeType === "string" ? body.mimeType : "";
    const detectedMime = rawMime.split(";")[0].trim().toLowerCase();
    const mimeType = detectedMime === "audio/mp4" ? "audio/m4a" : detectedMime;

    if (!audio) return json({ error: "صدایی دریافت نشد. دوباره ضبط کن." }, 400);
    if (audio.length > 12 * 1024 * 1024) {
      return json({ error: "صدای ضبط‌شده بیش از حد بزرگ است؛ کوتاه‌تر صحبت کن." }, 413);
    }

    const supported = new Set([
      "audio/m4a", "audio/aac", "audio/webm",
      "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp3"
    ]);
    if (!supported.has(mimeType)) {
      return json({ error: "قالب صدای این مرورگر پشتیبانی نمی‌شود: " + (mimeType || "نامشخص") }, 415);
    }

    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input: [
          {
            type: "text",
            text: "Transcribe the spoken audio exactly as heard. The speaker is likely speaking Afghan Dari (Persian as spoken in Afghanistan). Preserve Afghan Dari wording and vocabulary. Do not translate, summarize, explain, or answer the speaker. Return only the transcription text. If the speech is unclear, transcribe the clear words without inventing."
          },
          {
            type: "audio",
            data: audio,
            mime_type: mimeType
          }
        ]
      })
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = result.error?.message || "Gemini نتوانست صدا را تشخیص بدهد.";
      return json({ error: message.slice(0, 500) }, upstream.status >= 500 ? 502 : upstream.status);
    }

    const transcript =
      result.interaction?.output_text ||
      result.output_text ||
      result.interaction?.outputs?.map(item => item.text || "").join("\n") ||
      "";

    if (typeof transcript !== "string" || !transcript.trim()) {
      return json({ error: "متن گفتار از Gemini دریافت نشد؛ دوباره کوشش کن." }, 502);
    }

    return json({ transcript: transcript.trim() });
  } catch (error) {
    return json({ error: error?.message || "در تبدیل صدا به متن خطایی رخ داد." }, 500);
  }
}
