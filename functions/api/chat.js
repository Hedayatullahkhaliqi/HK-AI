
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
        messages: [systemPrompt, ...messages]
      }
    );

    return Response.json({
      reply: result.response || "HK could not generate a response."
    });

  } catch (error) {
    return Response.json({
      reply: "HK AI error: " + String(error.message || error)
    });
  }
}
