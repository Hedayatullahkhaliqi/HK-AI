import { readFile } from "node:fs/promises";
import { scoreScienceAnswer } from "../science-evaluation/scoring.mjs";

const datasetUrl = new URL("../science-evaluation/cases.json", import.meta.url);
const dataset = JSON.parse(await readFile(datasetUrl, "utf8"));
const endpoint = process.env.HK_AI_EVAL_URL;

if (!endpoint) {
  console.error("Missing HK_AI_EVAL_URL. Set it to a staging or local HK.AI /api/chat endpoint.");
  process.exit(2);
}

let parsedEndpoint;
try {
  parsedEndpoint = new URL(endpoint);
} catch {
  console.error("HK_AI_EVAL_URL must be a valid absolute URL.");
  process.exit(2);
}
if (parsedEndpoint.protocol !== "https:" && parsedEndpoint.hostname !== "localhost" && parsedEndpoint.hostname !== "127.0.0.1") {
  console.error("Use HTTPS for remote evaluation endpoints.");
  process.exit(2);
}
if (parsedEndpoint.hostname === "hk-ai.pages.dev") {
  console.error("Refusing to send the evaluation set to the production hk-ai.pages.dev host. Use a staging preview or local endpoint.");
  process.exit(2);
}

const timeoutMs = Number(process.env.HK_AI_EVAL_TIMEOUT_MS || 45000);
const results = [];

for (const item of dataset.cases) {
  let reply = "";
  let error = "";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        messages: [{ role: "user", content: item.question }],
        language: dataset.language
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload.error || "request failed"}`);
    if (typeof payload.reply !== "string" || !payload.reply.trim()) throw new Error("API returned no reply text");
    reply = payload.reply;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  const score = scoreScienceAnswer(item, reply, dataset.scoring.minimum_case_score, error);
  results.push({
    id: item.id,
    category: item.category,
    ...score,
    error: error || undefined,
    reply: reply || undefined,
    reference_answer: item.reference_answer,
    common_misconception: item.common_misconception,
    sources: item.sources
  });
}

const average = results.reduce((sum, item) => sum + item.score, 0) / results.length;
const passedCount = results.filter(item => item.passed).length;
const report = {
  dataset_version: dataset.schema_version,
  endpoint: `${parsedEndpoint.origin}${parsedEndpoint.pathname}`,
  total: results.length,
  passed: passedCount,
  failed: results.length - passedCount,
  average_score: Number(average.toFixed(2)),
  minimum_suite_average: dataset.scoring.minimum_suite_average,
  results
};

console.log(JSON.stringify(report, null, 2));
if (average < dataset.scoring.minimum_suite_average || passedCount !== results.length) process.exit(1);
