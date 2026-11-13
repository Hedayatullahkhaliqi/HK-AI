// Read JSON request bodies with a hard byte limit, even when Content-Length is absent
// or inaccurate. This prevents request.json() from buffering an oversized payload.
export async function readJsonBody(request, maxBytes) {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "A JSON request body is required." };

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        return { ok: false, status: 413, error: "Request body too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Could not read the request body." };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, status: 400, error: "The JSON request body must be an object." };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON request body." };
  }
}
