import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
    for (const pattern of [...item.required, ...item.forbidden]) {
      assert.doesNotThrow(() => new RegExp(pattern.slice(1, pattern.lastIndexOf("/")), pattern.slice(pattern.lastIndexOf("/") + 1)), item.id);
    }
  }
});

test("evaluation covers multiple scientific disciplines", () => {
  const categories = new Set(data.cases.map(item => item.category));
  for (const category of ["astronomy", "physics", "biology", "earth-science", "mathematics"]) {
    assert.ok(categories.has(category), `missing category: ${category}`);
  }
});
