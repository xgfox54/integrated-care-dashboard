import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const manifest = read("data/manual-corpus/manifest.json");
const documents = new Map();
const sections = [];
for (const descriptor of manifest.batches) {
  const batch = read("data/manual-corpus/assets" + descriptor.path);
  for (const document of batch.documents) documents.set(document.document_id, document);
  sections.push(...batch.sections);
}

const amountCells = ["783,000", "1,286,600", "1,644,000", "1,994,600", "2,324,400", "2,636,700"];
const normalize = (cell) => cell.replace(/<[^>]+>/g, "").replace(/\s+/g, "").trim();

function hasHouseholdAmountTable(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 2; index++) {
    const cells = (line) => line.trim().split("|").slice(1, -1).map(normalize);
    const header = cells(lines[index]);
    if (header.length !== 7 || !/가구/.test(header[0])) continue;
    if (!header.slice(1).every((cell, offset) => cell === `${offset + 1}인`)) continue;
    if (cells(lines[index + 2]).slice(1).every((cell, offset) => cell === amountCells[offset]) &&
        cells(lines[index + 2]).length === 7) return true;
  }
  return false;
}

test("bundled emergency livelihood table keeps all six household headers aligned with their amounts", () => {
  const matches = sections.filter((section) => {
    const name = documents.get(section.document_id)?.source_name ?? "";
    return /2026/.test(name) && /긴급복지지원사업/.test(name) && hasHouseholdAmountTable(section.content);
  });
  assert.ok(matches.length > 0, "The six household amounts are flattened or missing from the bundled 2026 emergency manual");
  assert.ok(matches.some((section) => /301,000/.test(section.content)), "The table's additional-household-member note was lost");
});

test("a flattened HTML cell is rejected even when every expected amount is present", () => {
  assert.equal(hasHouseholdAmountTable("<table><tr><td>가구구성원수 1인 2인 3인 4인 5인 6인 지원금액 " + amountCells.join(" ") + "</td></tr></table>"), false);
});

test("bundled facility directory retains its index role rather than becoming a benefit manual", () => {
  const directories = [...documents.values()].filter((document) => document.source_role === "facility_directory");
  assert.equal(directories.length, 1);
  assert.equal(directories[0].authority, "index");
});
