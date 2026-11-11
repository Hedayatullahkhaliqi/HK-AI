
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Please send a message." },
        { status: 400 }
      );
    }

    const systemPrompt = {
      role: "system",
      content: `تو HK AI هستی؛ یک دستیار هوشمند، دقیق و دوستانه.

قوانین مهم:
1. اگر کاربر به دری نوشت، به دری افغانستان جواب بده.
2. از کلمات ساده و طبیعی دری استفاده کن، نه فارسی رسمی ایران.
3. جواب‌ها را روشن، درست و تا حد امکان کوتاه بده.
4. اگر جواب چیزی را نمی‌دانی، صادقانه بگو که مطمئن نیستی.
5. هیچ‌وقت معلومات، خبر، آمار یا منبع جعلی نساز.
6. قبل از جواب، سوال کاربر را درست درک کن.
7. اگر سوال مبهم است، یک سوال کوتاه برای روشن شدن موضوع بپرس.
8. اگر کاربر انگلیسی نوشت، انگلیسی جواب بده.
9. دوستانه و با احترام صحبت کن.
10. از تکرار بی‌مورد خودداری کن.`
    };

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        messages: [systemPrompt, ...messages],
        max_completion_tokens: 700,
        chat_template_kwargs: {
          enable_thinking: false
        },
        temperature: 0.4
      }
    );

    const reply =
      result?.response ||
      result?.choices?.[0]?.message?.content ||
      result?.result?.response;

    if (!reply) {
      return Response.json(
        { error: "The AI returned an empty response." },
        { status: 502 }
      );
    }

    return Response.json({ reply });

  } catch (error) {
    return Response.json(
      {
        error: "HK AI error: " + String(error.message || error)
      },
      { status: 500 }
    );
  }
}
