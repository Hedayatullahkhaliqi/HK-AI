
export async function onRequestGet({ env }) {
  try {
    const result = await env.AI.run(
      "@cf/meta/llama-3.2-11b-vision-instruct",
      { prompt: "agree" }
    );

    return Response.json({
      success: true,
      message: "Vision model license agreement submitted.",
      result
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
