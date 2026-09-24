import assert from "node:assert/strict";
import test from "node:test";

import { fetchOfficialHtml } from "./official-http.ts";

test("Given a transient timeout, when official HTML is fetched, then one retry succeeds", async () => {
  let attempt = 0;
  const fetcher = async () => {
    attempt += 1;
    if (attempt === 1) throw new DOMException("timed out", "TimeoutError");
    return new Response("<html>ok</html>", { status: 200 });
  };

  const result = await fetchOfficialHtml("https://example.invalid/menu", fetcher);

  assert.equal(attempt, 2);
  assert.equal(result.text, "<html>ok</html>");
  assert.equal(result.finalUrl, "https://example.invalid/menu");
});

test("Given repeated timeouts, when official HTML is fetched, then the source URL is reported", async () => {
  const fetcher = async () => {
    throw new DOMException("timed out", "TimeoutError");
  };

  await assert.rejects(
    fetchOfficialHtml("https://example.invalid/menu", fetcher),
    /보건복지부 자료 요청 실패.*example\.invalid\/menu/,
  );
});
