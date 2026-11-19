import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compilePattern, scoreScienceAnswer } from "../science-evaluation/scoring.mjs";

const data = JSON.parse(await readFile(new URL("../science-evaluation/cases.json", import.meta.url), "utf8"));

test("science evaluation dataset has unique IDs and complete source-backed cases", () => {
  assert.equal(data.schema_version, 1);
  assert.equal(data.language, "Dari");
  assert.ok(data.cases.length >= 10);
  assert.ok(data.scoring.minimum_case_score > 0 && data.scoring.minimum_case_score <= 1);
  assert.ok(data.scoring.minimum_suite_average > 0 && data.scoring.minimum_suite_average <= 1);

  const ids = new Set();
  for (const item of data.cases) {
    assert.ok(item.id && !ids.has(item.id), `duplicate or missing id: ${item.id}`);
    ids.add(item.id);
    assert.ok(item.question.trim().length > 10, item.id);
    assert.ok(["astronomy", "physics", "biology", "earth-science", "mathematics"].includes(item.category), item.id);
    assert.ok(item.required.length > 0, item.id);
    assert.ok(item.reference_answer.trim().length > 20, item.id);
    assert.ok(item.common_misconception.trim().length > 5, item.id);
    assert.ok(item.sources.length > 0, item.id);
    for (const source of item.sources) assert.match(source, /^https:\/\//);
    for (const pattern of [...item.required, ...item.forbidden]) assert.doesNotThrow(() => compilePattern(pattern), item.id);
  }
});

test("evaluation covers multiple scientific disciplines", () => {
  const categories = new Set(data.cases.map(item => item.category));
  for (const category of ["astronomy", "physics", "biology", "earth-science", "mathematics"]) {
    assert.ok(categories.has(category), `missing category: ${category}`);
  }
});

test("each expert reference answer satisfies all required concept checks", () => {
  for (const item of data.cases) {
    const result = scoreScienceAnswer(item, item.reference_answer, data.scoring.minimum_case_score);
    assert.equal(result.required_passed, result.required, `reference answer misses required concepts: ${item.id}`);
    assert.equal(result.forbidden_passed, result.forbidden, `reference answer triggers a forbidden misconception: ${item.id}`);
    assert.equal(result.passed, true, `reference answer does not pass: ${item.id}`);
  }
});

test("each documented common misconception is caught by at least one forbidden pattern", () => {
  for (const item of data.cases) {
    assert.ok(item.forbidden.length > 0, `missing forbidden checks: ${item.id}`);
    const caught = item.forbidden.some(source => compilePattern(source).test(item.common_misconception));
    assert.equal(caught, true, `misconception is not caught by the rubric: ${item.id}`);
  }
});

test("scoring fails an answer that repeats a forbidden misconception", () => {
  const item = data.cases.find(entry => entry.id === "astro-earth-orbit");
  const result = scoreScienceAnswer(item, item.common_misconception, data.scoring.minimum_case_score);
  assert.equal(result.passed, false);
  assert.equal(result.forbidden_passed, 0);
});
