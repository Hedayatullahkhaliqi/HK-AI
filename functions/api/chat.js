
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
      content: "You are HK AI, a helpful multilingual assistant. Reply in the same language as the user. Support Dari, Persian, English and Uzbek. Be friendly and accurate."
    };

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        messages: [systemPrompt, ...messages],
        max_completion_tokens: 1024,
        reasoning_effort: "low"
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
