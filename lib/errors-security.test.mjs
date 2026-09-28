import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { errorResponse, redactLogText } from "./errors.ts";

test("public errors expose a stable code and request id but not exception details", async () => {
  const originalConsoleError = console.error;
  let logLine = "";
  console.error = (value) => { logLine = String(value); };
  let response;
  try {
    response = errorResponse(
      new Error("SQLITE_ERROR users table at C:\\secret\\database.sqlite API_KEY=abc123"),
      { code: "DATA_EXPORT_FAILED", message: "파일을 생성하지 못했습니다.", status: 500, path: "/api/dataset/export" },
    );
  } finally {
    console.error = originalConsoleError;
  }
  const text = await response.text();
  const payload = JSON.parse(text);
  const log = JSON.parse(logLine);

  assert.equal(payload.error, "DATA_EXPORT_FAILED");
  assert.equal(payload.message, "파일을 생성하지 못했습니다.");
  assert.match(payload.requestId, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(text, /SQLITE|secret|abc123|database\.sqlite/i);
  assert.equal(log.code, "DATA_EXPORT_FAILED");
  assert.equal(log.requestId, payload.requestId);
  assert.doesNotMatch(logLine, /abc123/);
});

test("server log redaction masks credentials and personal identifiers", () => {
  const redacted = redactLogText(
    "Authorization: Bearer token-value\nCookie: session=abc; csrf=VERYSECRET\nAPI_KEY=xyz mail=a@example.com mobile=010-1234-5678 phone=02-123-4567 ipv4=203.0.113.42 ipv6=2001:db8::1 loopback=::1 unspecified=:: linklocal=fe80:: rrn=900101-1234567 time=16:18:28",
  );
  assert.doesNotMatch(redacted, /token-value|session=abc|VERYSECRET|xyz|a@example\.com|010-1234-5678|02-123-4567|203\.0\.113\.42|2001:db8::1|::1|fe80::|900101-1234567/);
  assert.match(redacted, /time=16:18:28/);
});

test("default server error paths use the structured logger", async () => {
  const source = await readFile(new URL("./wiki-handler.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.warn/);
  assert.match(source, /logServerError/);
});
