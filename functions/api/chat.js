
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const messages = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Messages are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = {
      role: "system",
      content: `You are HK, a helpful multilingual AI assistant.
Your default language is English.
You support English, Dari, Persian and Uzbek.
Understand the user's language and reply in that language.
Be friendly, accurate and helpful.`
    };

    const result = await env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct",
      {
        messages: [systemPrompt, ...messages]
      }
    );

    return new Response(
      JSON.stringify({ reply: result.response }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "HK AI service error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
