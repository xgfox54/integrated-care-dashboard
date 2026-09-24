import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const HOOK_URL = new URL("./use-wiki-dataset.ts", import.meta.url);
const DETAILS_URL = new URL("../components/wiki/service-details.tsx", import.meta.url);
const BROWSER_URL = new URL("../components/wiki/wiki-browser.tsx", import.meta.url);

test("wiki selected-first modules exist independently of the full dataset hook", () => {
  assert.equal(existsSync(HOOK_URL), true);
  assert.equal(existsSync(DETAILS_URL), true);
});

test("wiki requests the selected service before a paginated background catalog", () => {
  const hook = existsSync(HOOK_URL) ? readFileSync(HOOK_URL, "utf8") : "";
  const browser = readFileSync(BROWSER_URL, "utf8");

  assert.match(hook, /\/api\/dataset\/service/);
  assert.match(hook, /\/api\/dataset\/search/);
  assert.doesNotMatch(hook, /fetch\([^\n]*\/api\/dataset["'`]/);
  assert.match(hook, /CATALOG_DELAY_MS/);
  assert.doesNotMatch(browser, /useFullDataset/);
  assert.match(browser, /ServiceDetails/);
});
